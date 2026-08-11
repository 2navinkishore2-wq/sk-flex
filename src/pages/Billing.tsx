import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus, Trash2, Pencil, Save, Search, UserPlus, RotateCcw } from 'lucide-react';
import { useApp } from '../store/AppContext';
import type { Customer, InvoiceItem, ProductKey } from '../lib/types';
import { PRODUCTS, PAYMENT_METHODS } from '../lib/constants';
import {
  calcArea,
  calcCustomAmount,
  calcDimensionAmount,
  calcFrameAmount,
  emptyItemKey,
  findFramePrice,
  framePriceFor,
  frameThicknessLabel,
  FRAME_THICKNESS_COLUMNS,
  invoiceTotals,
  invoiceStatus,
  type FrameThicknessKey
} from '../lib/billing';
import { formatDate, formatINR, todayISO } from '../lib/format';
import { round2, sum } from '../lib/money';
import { createInvoice, updateInvoice } from '../services/invoices';
import { createCustomer, searchCustomers } from '../services/customers';
import { Button, Card, EmptyState, Field, Modal, Row, SearchInput, useToast } from '../components/ui';
import { sizeLabel } from '../components/InvoiceDocument';

/** "12x18" -> "12×18" (display form). */
function displayFrameSize(size: string): string {
  const [w, h] = size.split('x');
  return w && h ? `${w}×${h}` : size;
}

/** Smallest-area-first sort for size options. */
function frameSizeArea(size: string): number {
  const [w, h] = size.split('x').map(Number);
  return (Number.isFinite(w) ? w : 0) * (Number.isFinite(h) ? h : 0);
}


interface ItemForm {
  product: ProductKey;
  width: string;
  height: string;
  qty: string;
  rate: string;
  name: string;
  unit: string;
  /** FRAME product: photo size from the frame price table (e.g. "12x18"). */
  frameSize: string;
  /** FRAME product: thickness option key (beading / 1 inc / 1.5 inc / 2 inc). */
  frameThickness: FrameThicknessKey;
}

const emptyForm = (product: ProductKey): ItemForm => ({
  product,
  width: '',
  height: '',
  qty: '1',
  rate: '',
  name: '',
  unit: 'Nos.',
  frameSize: '',
  frameThickness: 'beading'
});

export function BillingPage() {
  const app = useApp();
  const { invoiceId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const editingInvoice = useMemo(
    () => (invoiceId ? app.invoices.find((i) => i.id === invoiceId) : undefined),
    [invoiceId, app.invoices]
  );

  const [customerId, setCustomerId] = useState('');
  const [customerSnap, setCustomerSnap] = useState<{ name: string; phone: string; address: string }>({ name: '', phone: '', address: '' });
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [discountType, setDiscountType] = useState<'amount' | 'percent'>('amount');
  const [discountValue, setDiscountValue] = useState('0');
  const [billDate, setBillDate] = useState(todayISO());
  const [note, setNote] = useState('');
  // Cash payments entered at billing time — each with its own Payment Date.
  const [payments, setPayments] = useState<{ key: string; amount: string; date: string; method: string }[]>([]);
  const [payForm, setPayForm] = useState({ amount: '', date: todayISO(), method: 'Cash' });
  const [payError, setPayError] = useState('');

  const [form, setForm] = useState<ItemForm>(emptyForm('FLEX'));
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [formError, setFormError] = useState('');

  // customer picker
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [custSearch, setCustSearch] = useState('');
  const [newCust, setNewCust] = useState({ name: '', phone: '', address: '', email: '' });

  const [saving, setSaving] = useState(false);

  // load invoice for edit mode
  useEffect(() => {
    if (!editingInvoice) return;
    setCustomerId(editingInvoice.customerId);
    setCustomerSnap(editingInvoice.customer);
    setItems(editingInvoice.items);
    setDiscountType(editingInvoice.discountType);
    setDiscountValue(String(editingInvoice.discountValue));
    setBillDate(editingInvoice.date || todayISO()); // legacy invoices may lack the field
    setNote(editingInvoice.note || '');
    // Rebuild the payment list from the saved payment records (each keeps its
    // own Payment Date). Only when records exist — never clobber in-progress edits.
    const loaded = app.payments
      .filter((p) => p.invoiceId === editingInvoice.id)
      .map((p) => ({ key: p.id, amount: String(p.amount), date: p.date, method: p.method }));
    if (loaded.length > 0) setPayments(loaded);
  }, [editingInvoice, app.payments]);

  const customers = searchCustomers(app.customers, custSearch);

  const selectCustomer = (c: Customer) => {
    setCustomerId(c.id);
    setCustomerSnap({ name: c.name, phone: c.phone, address: c.address });
    setShowCustomerModal(false);
    setCustSearch('');
  };

  const quickAddCustomer = async () => {
    try {
      const c = await createCustomer(app.service, newCust);
      selectCustomer(c);
      setNewCust({ name: '', phone: '', address: '', email: '' });
      toast('Customer added', 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  // ---- item builder live calculation ----
  const area = useMemo(() => {
    const w = parseFloat(form.width);
    const h = parseFloat(form.height);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return calcArea(w, h);
    return null;
  }, [form.width, form.height]);

  const defaultRate = useMemo(() => {
    switch (form.product) {
      case 'FLEX': return app.rates.flex;
      case 'VINYL': return app.rates.vinyl;
      case 'STAR': return app.rates.star;
      case 'SUNPACK': return app.rates.sunpack;
      default: return 0;
    }
  }, [form.product, app.rates]);

  const rateValue = form.rate === '' ? defaultRate : parseFloat(form.rate) || 0;

  // FRAME product: pick a photo size + thickness from the frame price table
  // (single source of truth — the same saved data the Rates screen edits).
  const frameSizes = useMemo(
    () =>
      app.frameRates
        .filter((r) => r.active)
        .sort((a, b) => frameSizeArea(a.size) - frameSizeArea(b.size) || a.size.localeCompare(b.size))
        .map((r) => r.size),
    [app.frameRates]
  );
  const frameRow = useMemo(
    () => (form.product === 'FRAME' ? findFramePrice(app.frameRates, form.frameSize) : null),
    [form.product, form.frameSize, app.frameRates]
  );
  const frameThicknessOptions = useMemo(() => {
    if (!frameRow) return [];
    return FRAME_THICKNESS_COLUMNS.filter((c) => (frameRow[c.key] ?? null) != null && frameRow[c.key]! > 0);
  }, [frameRow]);
  const framePrice = useMemo(() => {
    if (form.product !== 'FRAME') return null;
    return framePriceFor(app.frameRates, form.frameSize, form.frameThickness);
  }, [form.product, form.frameSize, form.frameThickness, app.frameRates]);

  const liveAmount = useMemo(() => {
    const qty = parseFloat(form.qty) || 1;
    if (form.product === 'CUSTOM') {
      const r = parseFloat(form.rate) || 0;
      return qty > 0 ? calcCustomAmount(r, qty) : 0;
    }
    if (form.product === 'FRAME') return framePrice != null ? calcFrameAmount(framePrice, qty) : 0;
    if (area === null) return 0;
    return calcDimensionAmount(area, 1, rateValue, qty);
  }, [form.product, area, rateValue, form.qty, form.rate, framePrice]);

  const switchProduct = (p: ProductKey) => {
    const next = emptyForm(p);
    if (p === 'FRAME') {
      const first = frameSizes[0];
      if (first) {
        next.frameSize = first;
        const row = findFramePrice(app.frameRates, first);
        const firstOpt = row ? FRAME_THICKNESS_COLUMNS.find((c) => (row[c.key] ?? null) != null && row[c.key]! > 0) : undefined;
        if (firstOpt) next.frameThickness = firstOpt.key;
      }
    }
    setForm(next);
    setFormError('');
    setEditingKey(null);
  };

  const pickFrameSize = (size: string) => {
    const row = findFramePrice(app.frameRates, size);
    const firstOpt = row ? FRAME_THICKNESS_COLUMNS.find((c) => (row[c.key] ?? null) != null && row[c.key]! > 0) : undefined;
    setForm((f) => ({ ...f, frameSize: size, frameThickness: firstOpt?.key || f.frameThickness }));
  };

  const addItem = () => {
    setFormError('');
    const qty = parseFloat(form.qty) || 1;

    if (form.product === 'CUSTOM') {
      const name = form.name.trim();
      if (!name) return setFormError('Enter the custom item name.');
      const r = parseFloat(form.rate);
      if (!Number.isFinite(r) || r < 0) return setFormError('Enter a valid rate.');
      if (qty <= 0) return setFormError('Enter a valid quantity.');
      const item: InvoiceItem = {
        key: editingKey || emptyItemKey(),
        product: 'CUSTOM',
        label: name,
        qty,
        rate: round2(r),
        unit: form.unit.trim() || 'Nos.',
        amount: calcCustomAmount(r, qty),
        note: form.unit.trim() || 'Custom item'
      };
      upsertItem(item);
      return;
    }

    // FRAME items pick a photo size + thickness from the price table (no
    // width/height entry) — handle before the dimension area check.
    if (form.product === 'FRAME') {
      if (qty <= 0) return setFormError('Enter a valid quantity.');
      if (framePrice == null) {
        setFormError('Select a frame size and thickness that has a price (add sizes in Rates → Frame Rate Table).');
        return;
      }
      const item: InvoiceItem = {
        key: editingKey || emptyItemKey(),
        product: 'FRAME',
        label: 'Frame',
        qty,
        rate: framePrice,
        unit: 'Nos.',
        amount: calcFrameAmount(framePrice, qty),
        frameSize: form.frameSize,
        frameThickness: form.frameThickness,
        note: `${displayFrameSize(form.frameSize)} in · ${frameThicknessLabel(form.frameThickness)}`
      };
      upsertItem(item);
      return;
    }

    if (area === null) return setFormError('Enter valid width and height (positive numbers).');
    if (qty <= 0) return setFormError('Enter a valid quantity.');

    const rate = parseFloat(form.rate) || defaultRate;
    if (!Number.isFinite(rate) || rate < 0) return setFormError('Enter a valid rate.');
    const product = PRODUCTS.find((p) => p.key === form.product)!;
    const item: InvoiceItem = {
      key: editingKey || emptyItemKey(),
      product: form.product,
      label: product.name,
      width: parseFloat(form.width),
      height: parseFloat(form.height),
      area,
      unit: 'sq.ft',
      qty,
      rate: round2(rate),
      amount: calcDimensionAmount(area, 1, rate, qty)
    };
    upsertItem(item);
  };

  const upsertItem = (item: InvoiceItem) => {
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.key === item.key);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = item;
        return next;
      }
      return [...prev, item];
    });
    setForm(emptyForm(form.product));
    setEditingKey(null);
    setFormError('');
  };

  const editItem = (item: InvoiceItem) => {
    setEditingKey(item.key);
    setForm({
      product: item.product,
      width: item.width != null ? String(item.width) : '',
      height: item.height != null ? String(item.height) : '',
      qty: String(item.qty),
      rate: String(item.rate),
      name: item.product === 'CUSTOM' ? item.label : '',
      unit: item.unit || 'Nos.',
      frameSize: item.frameSize || (item.product === 'FRAME' ? frameSizes[0] || '' : ''),
      frameThickness: (item.frameThickness || 'beading') as FrameThicknessKey
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const deleteItem = (key: string) => setItems((prev) => prev.filter((i) => i.key !== key));

  // ---- totals ----
  const dv = parseFloat(discountValue) || 0;
  const totals = useMemo(() => invoiceTotals(items, discountType, dv), [items, discountType, dv]);
  const paymentRows = useMemo(
    () => payments.map((p) => ({ ...p, amount: parseFloat(p.amount) || 0 })).filter((p) => p.amount > 0),
    [payments]
  );
  const paidNum = Math.min(round2(sum(paymentRows.map((p) => p.amount))), totals.total);
  const balance = round2(Math.max(0, totals.total - paidNum));
  const status = invoiceStatus(totals.total, paidNum);

  const addPayment = () => {
    const amt = parseFloat(payForm.amount);
    if (!Number.isFinite(amt) || amt <= 0) return setPayError('Enter a valid payment amount.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payForm.date)) return setPayError('Enter a valid Payment Date.');
    const remaining = round2(Math.max(0, totals.total - paidNum));
    if (amt > remaining + 0.01) return setPayError(`Payment exceeds the balance due (${formatINR(remaining)}).`);
    setPayments((prev) => [...prev, { key: emptyItemKey(), amount: payForm.amount, date: payForm.date, method: payForm.method }]);
    setPayForm({ amount: '', date: todayISO(), method: 'Cash' });
    setPayError('');
  };

  const removePayment = (key: string) => setPayments((prev) => prev.filter((p) => p.key !== key));

  const canSave = customerId !== '' && items.length > 0 && !saving;

  const save = async () => {
    if (!customerId) return toast('Select a customer first.', 'warn');
    if (items.length === 0) return toast('Add at least one item.', 'warn');
    setSaving(true);
    try {
      const draft = {
        customerId,
        customer: customerSnap,
        items,
        discountType,
        discountValue: Math.max(0, dv),
        paid: paidNum,
        date: billDate || todayISO(),
        payments: paymentRows.map((p) => ({ amount: p.amount, date: p.date, method: p.method, note: '' })),
        note: note.trim() || undefined
      };
      let id: string;
      if (editingInvoice) {
        await updateInvoice(app.service, editingInvoice, draft);
        id = editingInvoice.id;
        toast(`Invoice ${editingInvoice.number} updated`, 'success');
      } else {
        const inv = await createInvoice(app.service, draft);
        id = inv.id;
        toast(`Invoice ${inv.number} saved`, 'success');
      }
      navigate(`/invoices/${id}${editingInvoice ? '' : '?new=1'}`);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const customerLabel = customerId ? `${customerSnap.name} · ${customerSnap.phone}` : 'Select customer…';

  return (
    <div className="page">
      <h1 className="page-title">{editingInvoice ? `Edit ${editingInvoice.number}` : 'New Bill'}</h1>
      <p className="page-sub">Select customer → add items → payment → save</p>

      <div className="grid grid-main-side">
        <div>
          {/* customer + bill date */}
          <Card title="1 · Customer">
            <Row>
              <button className="btn btn-ghost" style={{ flex: 1, justifyContent: 'space-between', padding: '12px 14px' }} onClick={() => setShowCustomerModal(true)}>
                <span>{customerLabel}</span>
                <Search size={17} color="var(--text-3)" />
              </button>
              <Button variant="ghost" onClick={() => setShowCustomerModal(true)}>
                <UserPlus size={17} /> New
              </Button>
            </Row>
            <div style={{ marginTop: 12, maxWidth: 240 }}>
              <Field label="Bill Date">
                <input
                  className="input"
                  type="date"
                  value={billDate}
                  onChange={(e) => setBillDate(e.target.value)}
                  data-testid="bill-date-input"
                />
              </Field>
            </div>
          </Card>

          {/* item builder */}
          <Card title="2 · Add Item">
            <div className="chips" style={{ marginBottom: 14 }}>
              {PRODUCTS.map((p) => (
                <button key={p.key} className={`chip${form.product === p.key ? ' active' : ''}`} onClick={() => switchProduct(p.key)}>
                  {p.name}
                </button>
              ))}
            </div>

            {form.product === 'CUSTOM' ? (
              <div>
                <Field label="Item name">
                  <input className="input" placeholder="e.g. Banner Installation, Special Printing…" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </Field>
                <div className="input-row">
                  <Field label="Rate (₹)">
                    <input className="input" type="number" inputMode="decimal" placeholder="0" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} />
                  </Field>
                  <Field label="Quantity">
                    <input className="input" type="number" inputMode="numeric" placeholder="1" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
                  </Field>
                  <Field label="Unit">
                    <input className="input" placeholder="Nos." value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
                  </Field>
                </div>
              </div>
            ) : form.product === 'FRAME' ? (
              <div>
                <div className="input-row">
                  <Field label="Photo size">
                    <select className="select" value={form.frameSize} onChange={(e) => pickFrameSize(e.target.value)} data-testid="frame-size-select">
                      {frameSizes.length === 0 && <option value="">No sizes — add in Rates</option>}
                      {frameSizes.map((s) => (
                        <option key={s} value={s}>{displayFrameSize(s)} in</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Thickness">
                    <select className="select" value={form.frameThickness} onChange={(e) => setForm({ ...form, frameThickness: e.target.value as FrameThicknessKey })} data-testid="frame-thickness-select">
                      {frameThicknessOptions.map((o) => (
                        <option key={o.key} value={o.key}>{o.label}{frameRow ? ` — ${formatINR(frameRow[o.key]!)}` : ''}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Qty">
                    <input className="input" type="number" inputMode="numeric" placeholder="1" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
                  </Field>
                </div>
                <div className="input-row">
                  <div className="field" style={{ flex: 2 }}>
                    <label>&nbsp;</label>
                    <div className="calc-preview" data-testid="calc-preview">
                      {frameSizes.length === 0 ? (
                        <span style={{ color: 'var(--red)' }}>No frame sizes — add them in Rates → Frame Rate Table</span>
                      ) : framePrice != null ? (
                        <span>
                          {displayFrameSize(form.frameSize)} in · {frameThicknessLabel(form.frameThickness)} ={' '}
                          <b style={{ color: 'var(--brand-600)' }}>{formatINR(framePrice)}</b>/frame
                          {(parseFloat(form.qty) || 1) > 1 ? ` × ${form.qty} = ${formatINR(liveAmount)}` : ''}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-3)' }}>Select a size and thickness</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <div className="input-row">
                  <Field label="Width (ft)">
                    <input className="input" type="number" inputMode="decimal" placeholder="0" value={form.width} onChange={(e) => setForm({ ...form, width: e.target.value })} />
                  </Field>
                  <Field label="Height (ft)">
                    <input className="input" type="number" inputMode="decimal" placeholder="0" value={form.height} onChange={(e) => setForm({ ...form, height: e.target.value })} />
                  </Field>
                  <Field label="Qty">
                    <input className="input" type="number" inputMode="numeric" placeholder="1" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
                  </Field>
                </div>
                <div className="input-row">
                  <Field label="Rate (₹/sq.ft)">
                    <input className="input" type="number" inputMode="decimal" value={form.rate === '' ? defaultRate : form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} />
                  </Field>
                  <div className="field" style={{ flex: 2 }}>
                    <label>&nbsp;</label>
                    <div className="calc-preview" data-testid="calc-preview">
                      {area !== null ? (
                        <span>
                          {area} sq.ft × {formatINR(rateValue)} = <b style={{ color: 'var(--brand-600)' }}>{formatINR(calcDimensionAmount(area, 1, rateValue, parseFloat(form.qty) || 1))}</b>
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-3)' }}>Area will appear here</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {formError && <div className="form-error" style={{ marginBottom: 10 }}>{formError}</div>}

            <Row>
              <Button onClick={addItem} disabled={form.product === 'FRAME' && framePrice == null}>
                {editingKey ? <RotateCcw size={17} /> : <Plus size={17} />}
                {editingKey ? 'Update Item' : 'Add Item'}
                {form.product !== 'CUSTOM' && liveAmount > 0 && !editingKey && (
                  <span style={{ opacity: 0.85 }}>· {formatINR(liveAmount)}</span>
                )}
              </Button>
              {editingKey && (
                <Button variant="ghost" onClick={() => { setEditingKey(null); setForm(emptyForm(form.product)); setFormError(''); }}>
                  Cancel edit
                </Button>
              )}
            </Row>
          </Card>

          {/* items list */}
          <Card title={`3 · Items (${items.length})`}>
            {items.length === 0 ? (
              <EmptyState icon={<Plus size={24} />} title="No items yet" text="Add flex, vinyl, frame or custom items above." />
            ) : (
              <div className="table-wrap">
                <table className="tbl stack-cards">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Size</th>
                      <th className="num">Qty</th>
                      <th className="num">Rate</th>
                      <th className="num">Amount</th>
                      <th className="actions">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it) => (
                      <tr key={it.key}>
                        <td data-label="Item">
                          <div style={{ fontWeight: 700 }}>{it.label}</div>
                          {it.note && it.product !== 'CUSTOM' ? <div style={{ color: 'var(--text-3)', fontSize: 12.5 }}>{it.note}</div> : null}
                        </td>
                        <td data-label="Size">{sizeLabel(it)}</td>
                        <td className="num" data-label="Qty">{it.qty}</td>
                        <td className="num" data-label="Rate">{formatINR(it.rate)}</td>
                        <td className="num" data-label="Amount" style={{ fontWeight: 700 }}>{formatINR(it.amount)}</td>
                        <td className="actions">
                          <button className="icon-btn" style={{ marginRight: 6 }} onClick={() => editItem(it)} title="Edit"><Pencil size={15} /></button>
                          <button className="icon-btn danger" onClick={() => deleteItem(it.key)} title="Delete"><Trash2 size={15} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* discount & payment (desktop: below items; totals panel shows right side) */}
          <Card title="4 · Discount & Payment">
            <div className="grid grid-2">
              <Field label="Discount">
                <div style={{ display: 'flex', gap: 8 }}>
                  <select className="select" style={{ width: 110, flex: 'none' }} value={discountType} onChange={(e) => setDiscountType(e.target.value as 'amount' | 'percent')}>
                    <option value="amount">₹ Amount</option>
                    <option value="percent">% Percent</option>
                  </select>
                  <input className="input" type="number" inputMode="decimal" placeholder="0" value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} data-testid="discount-input" />
                </div>
              </Field>
              <Field label="Note on invoice (optional)">
                <input className="input" placeholder="e.g. Delivery on Friday" value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} />
              </Field>
            </div>

            {/* cash payment — separate from the Bill Date; each payment keeps its own date */}
            <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
              <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 14 }}>Cash Payment</div>
              {paymentRows.length === 0 ? (
                <div style={{ color: 'var(--text-3)', fontSize: 13, marginBottom: 10 }}>
                  No payment received yet — add cash/UPI received now, or record it later from the invoice.
                </div>
              ) : (
                <div className="table-wrap" style={{ marginBottom: 10 }}>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Payment Date</th>
                        <th>Method</th>
                        <th className="num">Amount</th>
                        <th className="actions">Remove</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paymentRows.map((p) => (
                        <tr key={p.key}>
                          <td data-label="Payment Date">{formatDate(p.date)}</td>
                          <td data-label="Method">{p.method}</td>
                          <td className="num" data-label="Amount" style={{ fontWeight: 700 }}>{formatINR(p.amount)}</td>
                          <td className="actions">
                            <button className="icon-btn danger" onClick={() => removePayment(p.key)} title="Remove payment">
                              <Trash2 size={15} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="input-row">
                <Field label="Amount (₹)">
                  <input
                    className="input"
                    type="number"
                    inputMode="decimal"
                    placeholder="0"
                    value={payForm.amount}
                    onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
                    data-testid="payment-amount-input"
                  />
                </Field>
                <Field label="Payment Date">
                  <input
                    className="input"
                    type="date"
                    value={payForm.date}
                    onChange={(e) => setPayForm({ ...payForm, date: e.target.value })}
                    data-testid="payment-date-input"
                  />
                </Field>
                <Field label="Method">
                  <select className="select" value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })} data-testid="payment-method-select">
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                </Field>
              </div>
              {payError && <div className="form-error" style={{ marginBottom: 8 }}>{payError}</div>}
              <Button variant="ghost" size="sm" onClick={addPayment}>
                <Plus size={15} /> Add Payment
              </Button>
            </div>
          </Card>
        </div>

        {/* totals sidebar (desktop) */}
        <div className="desktop-only" style={{ position: 'sticky', top: 22 }}>
          <Card title="Bill Summary">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14.5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-2)' }}>Subtotal</span><b>{formatINR(totals.subtotal)}</b></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-2)' }}>Discount</span><b>− {formatINR(totals.discount)}</b></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 18, fontWeight: 800, borderTop: '2px solid var(--navy-900)', paddingTop: 10 }}>
                <span>Total</span><span>{formatINR(totals.total)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-2)' }}>Paid</span><b>{formatINR(paidNum)}</b></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: balance > 0 ? 'var(--red)' : 'var(--green)', fontWeight: 800, fontSize: 16 }}>
                <span>Balance</span><span>{formatINR(balance)}</span>
              </div>
              <span className={`badge badge-${status}`} style={{ alignSelf: 'flex-start' }}>Status: {status.toUpperCase()}</span>
            </div>
            <Button block size="lg" style={{ marginTop: 16 }} disabled={!canSave} onClick={() => void save()}>
              <Save size={18} />
              {saving ? 'Saving…' : editingInvoice ? 'Update Invoice' : 'Save Invoice'}
            </Button>
          </Card>
        </div>
      </div>

      {/* mobile sticky save bar */}
      <div className="mobile-only" style={{ position: 'fixed', left: 0, right: 0, bottom: 62, zIndex: 35, padding: '8px 12px', background: 'rgba(255,255,255,0.96)', borderTop: '1px solid var(--border)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11.5, color: 'var(--text-3)', fontWeight: 600 }}>Total</div>
          <div style={{ fontWeight: 800, fontSize: 17 }}>{formatINR(totals.total)}</div>
        </div>
        <Button block size="lg" disabled={!canSave} onClick={() => void save()} style={{ flex: 1 }}>
          <Save size={17} />
          {saving ? 'Saving…' : editingInvoice ? 'Update' : 'Save Invoice'}
        </Button>
      </div>

      {/* customer picker modal */}
      <Modal open={showCustomerModal} title="Select / Add Customer" onClose={() => setShowCustomerModal(false)} width={560}>
        <SearchInput value={custSearch} onChange={setCustSearch} placeholder="Search by name or phone…" />
        <div style={{ maxHeight: 260, overflowY: 'auto', marginTop: 10 }}>
          {customers.length === 0 ? (
            <div style={{ padding: '18px 0', textAlign: 'center', color: 'var(--text-3)', fontSize: 13.5 }}>
              {custSearch ? 'No customer found — add one below.' : 'No customers yet. Add your first customer below.'}
            </div>
          ) : (
            customers.map((c) => (
              <button key={c.id} onClick={() => selectCustomer(c)} className="btn btn-ghost" style={{ width: '100%', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontWeight: 600 }}>{c.name}</span>
                <span style={{ color: 'var(--text-3)', fontSize: 13 }}>{c.phone}</span>
              </button>
            ))
          )}
        </div>
        <div style={{ borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 14 }}>Quick add customer</div>
          <div className="input-row" style={{ marginBottom: 10 }}>
            <Field label="Name *"><input className="input" value={newCust.name} onChange={(e) => setNewCust({ ...newCust, name: e.target.value })} placeholder="e.g. Ramesh" /></Field>
            <Field label="Phone *"><input className="input" inputMode="tel" value={newCust.phone} onChange={(e) => setNewCust({ ...newCust, phone: e.target.value })} placeholder="e.g. 98765 43210" /></Field>
          </div>
          <Field label="Address (optional)"><input className="input" value={newCust.address} onChange={(e) => setNewCust({ ...newCust, address: e.target.value })} /></Field>
          <Button block style={{ marginTop: 10 }} onClick={() => void quickAddCustomer()}>Add & Select</Button>
        </div>
      </Modal>
    </div>
  );
}
