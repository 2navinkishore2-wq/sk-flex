import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, HandCoins, IndianRupee, Wallet, AlertCircle, Plus, Users, FileDown, Image as ImageIcon } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { ledgerStats, netAdjustments, sortLedgerChronological, withRunningBalance } from '../services/ledger';
import { updateCustomer, type CustomerInput } from '../services/customers';
import { recordPayment } from '../services/payments';
import { formatDate, formatINR, todayISO } from '../lib/format';
import { buildCustomerStatement, entryBusinessDate, statementFileName } from '../lib/statement';
import { downloadStatementJpg, downloadStatementPdf } from '../services/export';
import { StatementDocument } from '../components/StatementDocument';
import { Button, Card, EmptyState, Field, Modal, Row, StatCard, StatusBadge, useToast } from '../components/ui';

export function CustomerDetailPage() {
  const { id } = useParams();
  const { customers, invoices, ledger, payments, service, business } = useApp();
  const navigate = useNavigate();
  const toast = useToast();

  const customer = customers.find((c) => c.id === id);
  const [editOpen, setEditOpen] = useState(false);
  const [editInput, setEditInput] = useState<CustomerInput>({ name: '', phone: '', address: '', email: '' });
  const [editError, setEditError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'ledger' | 'invoices' | 'statement'>('ledger');
  const [statementRange, setStatementRange] = useState<{ start: string; end: string } | null>(null);
  const [exporting, setExporting] = useState<'pdf' | 'jpg' | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [payMethod, setPayMethod] = useState('Cash');
  const [payNote, setPayNote] = useState('');
  const [payBusy, setPayBusy] = useState(false);

  const customerLedger = useMemo(() => ledger.filter((e) => e.customerId === id), [ledger, id]);
  const sortedLedger = useMemo(() => sortLedgerChronological(customerLedger), [customerLedger]);
  const stats = useMemo(() => ledgerStats(sortedLedger), [sortedLedger]);
  // Ledger rows as shown to the customer: invoice-edit adjustments folded into
  // their invoice rows (never "Invoice edited…" entries) and the running
  // balance recomputed from the (corrected) amounts.
  const displayLedger = useMemo(() => withRunningBalance(netAdjustments(sortedLedger)), [sortedLedger]);
  const customerInvoices = useMemo(
    () => invoices.filter((i) => i.customerId === id).sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1)),
    [invoices, id]
  );
  const customerPays = useMemo(
    () => payments.filter((p) => p.customerId === id).sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1)),
    [payments, id]
  );

  // Earliest business date in this customer's ledger (for the statement's
  // default start date). Invoice entries use their Bill Date; payments their
  // Payment Date — never the recording time.
  const earliestLedgerDate = useMemo(() => {
    const dates = customerLedger.map((e) => entryBusinessDate(e, invoices)).filter((d) => d !== '');
    return dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : '';
  }, [customerLedger, invoices]);

  // (Re)initialize the statement range for the selected customer once their
  // ledger data is available; never clobbers a range the user picked.
  useEffect(() => {
    setStatementRange(null);
  }, [id]);
  useEffect(() => {
    if (!earliestLedgerDate) return;
    setStatementRange((prev) => prev ?? { start: earliestLedgerDate, end: todayISO() });
  }, [earliestLedgerDate]);

  const statement = useMemo(() => {
    if (!customer || !statementRange) return null;
    const { start, end } = statementRange;
    if (start > end) return null; // invalid range — the UI shows the error
    return buildCustomerStatement(customer, ledger, invoices, payments, start, end);
  }, [customer, ledger, invoices, payments, statementRange]);

  const doStatementExport = async (kind: 'pdf' | 'jpg') => {
    const node = document.getElementById('statement-paper') as HTMLElement | null;
    if (!node || !statement || !customer) return;
    setExporting(kind);
    try {
      const filename = statementFileName(statement.startDate, statement.endDate, customer.name, kind);
      if (kind === 'pdf') await downloadStatementPdf(node, filename);
      else await downloadStatementJpg(node, filename);
      toast(`Statement ${kind.toUpperCase()} downloaded`, 'success');
    } catch (e) {
      toast(`Statement ${kind.toUpperCase()} failed: ${(e as Error).message}`, 'error');
    } finally {
      setExporting(null);
    }
  };

  if (!customer) {
    return (
      <div className="page">
        <EmptyState icon={<Users size={24} />} title="Customer not found" text="This customer may have been removed." />
      </div>
    );
  }

  const openEdit = () => {
    setEditInput({ name: customer.name, phone: customer.phone, address: customer.address, email: customer.email });
    setEditError('');
    setEditOpen(true);
  };

  const saveEdit = async () => {
    setBusy(true);
    setEditError('');
    try {
      await updateCustomer(service, customer.id, editInput);
      setEditOpen(false);
      toast('Customer updated', 'success');
    } catch (e) {
      setEditError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doPayment = async () => {
    setPayBusy(true);
    try {
      await recordPayment(service, customer.id, {
        amount: parseFloat(payAmount) || 0,
        date: payDate,
        method: payMethod,
        note: payNote
      });
      toast('Payment recorded', 'success');
      setPayOpen(false);
      setPayAmount('');
      setPayNote('');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setPayBusy(false);
    }
  };

  return (
    <div className="page">
      <Row style={{ marginBottom: 16 }}>
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft size={16} /> Back
        </Button>
        <Button variant="ghost" size="sm" onClick={openEdit}>
          <Pencil size={15} /> Edit
        </Button>
      </Row>

      <Card>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="avatar" style={{ width: 52, height: 52, fontSize: 20, background: 'var(--brand-100)', color: 'var(--brand-700)' }}>
            {customer.name.slice(0, 2).toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <h1 className="page-title" style={{ marginBottom: 2 }}>{customer.name}</h1>
            <div style={{ color: 'var(--text-2)', fontSize: 14 }}>
              {customer.phone}
              {customer.address ? ` · ${customer.address}` : ''}
              {customer.email ? ` · ${customer.email}` : ''}
            </div>
          </div>
          <Button variant="success" onClick={() => setPayOpen(true)}>
            <HandCoins size={17} /> Receive Payment
          </Button>
        </div>
      </Card>

      <div className="grid grid-4" style={{ margin: '16px 0' }}>
        <StatCard label="Total Billed" value={formatINR(stats.billed)} icon={<IndianRupee size={17} />} tone="blue" />
        <StatCard label="Total Paid" value={formatINR(stats.paid)} icon={<Wallet size={17} />} tone="green" />
        {stats.balance < 0 ? (
          <StatCard label="Advance Credit" value={formatINR(Math.abs(stats.balance))} icon={<Wallet size={17} />} tone="green" />
        ) : (
          <StatCard label="Outstanding" value={formatINR(stats.balance)} icon={<AlertCircle size={17} />} tone="red" />
        )}
        <StatCard label="Invoices" value={String(stats.invoiceCount)} icon={<Plus size={17} />} tone="navy" />
      </div>

      <div className="chips" style={{ marginBottom: 14 }}>
        <button className={`chip${tab === 'ledger' ? ' active' : ''}`} onClick={() => setTab('ledger')}>Ledger</button>
        <button className={`chip${tab === 'invoices' ? ' active' : ''}`} onClick={() => setTab('invoices')}>Invoices ({customerInvoices.length})</button>
        <button className={`chip${tab === 'statement' ? ' active' : ''}`} onClick={() => setTab('statement')}>Statement</button>
      </div>

      {tab === 'ledger' ? (
        <Card title="Account Ledger" right={<span style={{ fontWeight: 800, color: stats.balance > 0 ? 'var(--red)' : 'var(--green)' }}>{formatINR(stats.balance)}</span>}>
          {sortedLedger.length === 0 ? (
            <EmptyState icon={<Wallet size={24} />} title="No ledger transactions" text="Create an invoice or record a payment to start the ledger." />
          ) : (
            <div className="table-wrap">
              <table className="tbl stack-cards">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th className="num">Debit</th>
                    <th className="num">Credit</th>
                    <th className="num">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {displayLedger.map((e) => (
                    <tr key={e.id}>
                      <td data-label="Date" style={{ color: 'var(--text-2)', fontSize: 13 }}>{formatDate(entryBusinessDate(e, invoices))}</td>
                      <td data-label="Description">
                        <div style={{ fontWeight: 600 }}>{e.description}</div>
                        {e.invoiceNumber && <div style={{ color: 'var(--text-3)', fontSize: 12 }}>{e.invoiceNumber}</div>}
                      </td>
                      <td className="num" data-label="Debit" style={{ color: e.amount > 0 ? 'var(--red)' : 'var(--text-3)' }}>
                        {e.amount > 0 ? formatINR(e.amount) : '—'}
                      </td>
                      <td className="num" data-label="Credit" style={{ color: e.amount < 0 ? 'var(--green)' : 'var(--text-3)' }}>
                        {e.amount < 0 ? formatINR(Math.abs(e.amount)) : '—'}
                      </td>
                      <td className="num" data-label="Balance" style={{ fontWeight: 700 }}>{formatINR(e.balanceAfter)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {customerPays.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <div className="card-title" style={{ marginBottom: 8 }}>Payment History</div>
              <div className="table-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Invoice</th>
                      <th className="num">Amount</th>
                      <th>Method</th>
                      <th>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customerPays.map((p) => (
                      <tr key={p.id}>
                        <td data-label="Date" style={{ color: 'var(--text-2)', fontSize: 13 }}>{formatDate(p.date)}</td>
                        <td data-label="Invoice" style={{ fontWeight: 600 }}>{p.invoiceNumber || 'Account / advance'}</td>
                        <td className="num" data-label="Amount" style={{ color: 'var(--green)', fontWeight: 700 }}>{formatINR(p.amount)}</td>
                        <td data-label="Method">{p.method}</td>
                        <td data-label="Note" style={{ color: 'var(--text-2)' }}>{p.note || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Card>
      ) : tab === 'statement' ? (
        <Card title="Customer Statement / Ledger" right={<span style={{ fontWeight: 800, color: (statement?.closingBalance ?? 0) > 0 ? 'var(--red)' : 'var(--green)' }}>{statement ? formatINR(statement.closingBalance) : '—'}</span>}>
          <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginBottom: 14 }}>
            Full account statement for the selected period — every invoice, payment and adjustment in chronological order, with running balance. This is a customer statement export, separate from individual invoice downloads.
          </div>
          {customerLedger.length === 0 ? (
            <EmptyState icon={<Wallet size={24} />} title="No ledger transactions" text="Create an invoice or record a payment to generate a statement." />
          ) : (
            <>
              <div className="input-row" style={{ marginBottom: 14, maxWidth: 520 }}>
                <Field label="Statement start date">
                  <input className="input" type="date" value={statementRange?.start || ''} onChange={(e) => setStatementRange((r) => ({ start: e.target.value, end: r?.end || todayISO() }))} data-testid="statement-start" />
                </Field>
                <Field label="Statement end date">
                  <input className="input" type="date" value={statementRange?.end || ''} onChange={(e) => setStatementRange((r) => ({ start: r?.start || '', end: e.target.value }))} data-testid="statement-end" />
                </Field>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', paddingBottom: 13 }}>
                  <Button size="sm" onClick={() => void doStatementExport('pdf')} disabled={exporting !== null || !statement}>
                    {exporting === 'pdf' ? 'Generating…' : <><FileDown size={15} /> Statement PDF</>}
                  </Button>
                  <Button size="sm" variant="dark" onClick={() => void doStatementExport('jpg')} disabled={exporting !== null || !statement}>
                    {exporting === 'jpg' ? 'Generating…' : <><ImageIcon size={15} /> Statement JPG</>}
                  </Button>
                </div>
              </div>
              {statementRange && statementRange.start > statementRange.end && (
                <div className="form-error" style={{ marginBottom: 12 }}>Start date is after end date — choose a valid range.</div>
              )}
              <div className="invoice-scale-wrap">
                <div style={{ maxWidth: 794, margin: '0 auto' }}>
                  {statement ? (
                    <StatementDocument statement={statement} business={business} />
                  ) : null}
                </div>
              </div>
            </>
          )}
        </Card>
      ) : (
        <Card title="Invoices">
          {customerInvoices.length === 0 ? (
            <EmptyState icon={<Plus size={24} />} title="No invoices for this customer" text="Create a bill from the Billing screen." />
          ) : (
            <div className="table-wrap">
              <table className="tbl stack-cards">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Date</th>
                    <th className="num">Total</th>
                    <th className="num">Paid</th>
                    <th className="num">Balance</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {customerInvoices.map((inv) => (
                    <tr key={inv.id} className="clickable" onClick={() => navigate(`/invoices/${inv.id}`)}>
                      <td data-label="Invoice" style={{ fontWeight: 700 }}>{inv.number}</td>
                      <td data-label="Date">{formatDate(inv.date)}</td>
                      <td className="num" data-label="Total">{formatINR(inv.total)}</td>
                      <td className="num" data-label="Paid" style={{ color: 'var(--green)' }}>{formatINR(inv.paid)}</td>
                      <td className="num" data-label="Balance" style={{ color: inv.balance > 0 ? 'var(--red)' : 'var(--green)', fontWeight: 700 }}>{formatINR(inv.balance)}</td>
                      <td data-label="Status"><StatusBadge status={inv.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Modal open={editOpen} title="Edit Customer" onClose={() => setEditOpen(false)} width={460}>
        <Field label="Customer name *"><input className="input" value={editInput.name} onChange={(e) => setEditInput({ ...editInput, name: e.target.value })} /></Field>
        <Field label="Phone number *"><input className="input" inputMode="tel" value={editInput.phone} onChange={(e) => setEditInput({ ...editInput, phone: e.target.value })} /></Field>
        <Field label="Address (optional)"><textarea className="textarea" value={editInput.address} onChange={(e) => setEditInput({ ...editInput, address: e.target.value })} /></Field>
        <Field label="Email (optional)"><input className="input" type="email" value={editInput.email} onChange={(e) => setEditInput({ ...editInput, email: e.target.value })} /></Field>
        {editError && <div className="form-error" style={{ marginBottom: 10 }}>{editError}</div>}
        <Button block size="lg" disabled={busy} onClick={() => void saveEdit()}>{busy ? 'Saving…' : 'Save Changes'}</Button>
      </Modal>

      <Modal open={payOpen} title={`Receive payment from ${customer.name}`} onClose={() => setPayOpen(false)} width={440}>
        <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginBottom: 12 }}>
          Enter the full amount actually received. No invoice needs to be selected — the payment is
          applied to this customer's outstanding bills (oldest first) and anything above the balance
          due becomes advance credit for future bills.
        </div>
        <Field label="Amount (₹)">
          <input className="input" type="number" inputMode="decimal" placeholder="0" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} autoFocus />
        </Field>
        <div className="input-row">
          <Field label="Payment Date"><input className="input" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} /></Field>
          <Field label="Method">
            <select className="select" value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
              <option>Cash</option><option>UPI</option><option>Card</option><option>Bank Transfer</option><option>Other</option>
            </select>
          </Field>
        </div>
        <Field label="Note (optional)"><input className="input" value={payNote} onChange={(e) => setPayNote(e.target.value)} placeholder="e.g. Paid via GPay" /></Field>
        <Button block size="lg" disabled={payBusy} onClick={() => void doPayment()}>{payBusy ? 'Saving…' : 'Save Payment'}</Button>
      </Modal>
    </div>
  );
}
