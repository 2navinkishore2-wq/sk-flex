import { useEffect, useMemo, useState } from 'react';
import { SlidersHorizontal, Table2, Plus, Trash2, Save, Power, RotateCcw } from 'lucide-react';
import { useApp } from '../store/AppContext';
import type { FramePrice, ProductRates } from '../lib/types';
import { FRAME_THICKNESS_COLUMNS, normalizeFrameSize, type FrameThicknessKey } from '../lib/billing';
import { saveFramePrices, saveProductRates } from '../services/settings';
import { Button, Card, ConfirmDialog, Field, Row, useToast } from '../components/ui';

/** One editable row; prices are kept as strings so empty = not offered (null). */
interface EditableRow {
  id?: string;
  size: string;
  beading: string;
  oneInch: string;
  onePointFiveInch: string;
  twoInch: string;
  active: boolean;
}

function toEditable(f: FramePrice): EditableRow {
  return {
    id: f.id,
    size: f.size,
    beading: f.beading == null ? '' : String(f.beading),
    oneInch: f.oneInch == null ? '' : String(f.oneInch),
    onePointFiveInch: f.onePointFiveInch == null ? '' : String(f.onePointFiveInch),
    twoInch: f.twoInch == null ? '' : String(f.twoInch),
    active: f.active
  };
}

/** \"\" -> null (not offered); otherwise a non-negative number (or null if invalid). */
function priceNum(s: string): number | null {
  const t = s.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const blankRow = (): EditableRow => ({ size: '', beading: '', oneInch: '', onePointFiveInch: '', twoInch: '', active: true });

export function RatesPage() {
  const app = useApp();
  const toast = useToast();
  const [tab, setTab] = useState<'products' | 'frame'>('products');
  const [rates, setRates] = useState<ProductRates>(app.rates);
  const [savingRates, setSavingRates] = useState(false);

  // ---- frame price table (editable grid) ----
  const [rows, setRows] = useState<EditableRow[]>(() => app.frameRates.map(toEditable));
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [frameError, setFrameError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<EditableRow | null>(null);

  useEffect(() => setRates(app.rates), [app.rates]);

  // Keep the grid in sync with the live collection (after saves / syncs).
  // Typing never changes the collection, so mid-edit rows are preserved.
  useEffect(() => {
    setRows(app.frameRates.map(toEditable));
    setDeletedIds([]);
  }, [app.frameRates]);

  const hasChanges = useMemo(() => {
    if (deletedIds.length > 0) return true;
    const current = new Map(app.frameRates.map((f) => [f.id, toEditable(f)]));
    for (const r of rows) {
      const c = r.id ? current.get(r.id) : undefined;
      if (!c) return true; // brand-new row
      if (normalizeFrameSize(r.size) !== normalizeFrameSize(c.size) || r.active !== c.active) return true;
      for (const col of FRAME_THICKNESS_COLUMNS) {
        if (priceNum(r[col.key]) !== priceNum(c[col.key])) return true;
      }
    }
    return false;
  }, [rows, deletedIds, app.frameRates]);

  const setRow = (i: number, patch: Partial<EditableRow>) => {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };
  const setPrice = (i: number, key: FrameThicknessKey, value: string) => setRow(i, { [key]: value });

  const addRow = () => setRows((prev) => [...prev, blankRow()]);

  const confirmDelete = () => {
    if (!deleting) return;
    if (deleting.id) setDeletedIds((prev) => [...prev, deleting.id!]);
    setRows((prev) => prev.filter((r) => r !== deleting));
    setDeleting(null);
  };

  const save = async () => {
    setSaving(true);
    setFrameError('');
    try {
      await saveFramePrices(
        app.service,
        rows.map((r) => ({
          id: r.id,
          size: r.size,
          beading: priceNum(r.beading),
          oneInch: priceNum(r.oneInch),
          onePointFiveInch: priceNum(r.onePointFiveInch),
          twoInch: priceNum(r.twoInch),
          active: r.active
        })),
        deletedIds
      );
      toast('Frame prices saved — billing now uses them', 'success');
    } catch (e) {
      setFrameError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    setRows(app.frameRates.map(toEditable));
    setDeletedIds([]);
    setFrameError('');
  };

  const saveRates = async () => {
    setSavingRates(true);
    try {
      await saveProductRates(app.service, rates);
      toast('Rates saved — applies to new invoices only', 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSavingRates(false);
    }
  };

  const PRODUCT_FIELDS: { key: keyof ProductRates; label: string; hint: string }[] = [
    { key: 'flex', label: 'Flex', hint: '₹/sq.ft' },
    { key: 'vinyl', label: 'Vinyl', hint: '₹/sq.ft' },
    { key: 'star', label: 'Star', hint: '₹/sq.ft' },
    { key: 'sunpack', label: 'Sunpack', hint: '₹/sq.ft' }
  ];

  return (
    <div className="page">
      <h1 className="page-title">Rates & Pricing</h1>
      <p className="page-sub">Changing a rate never changes old invoices — each invoice keeps its own rates.</p>

      <div className="chips" style={{ marginBottom: 16 }}>
        <button className={`chip${tab === 'products' ? ' active' : ''}`} onClick={() => setTab('products')}>Product Rates</button>
        <button className={`chip${tab === 'frame' ? ' active' : ''}`} onClick={() => setTab('frame')}>Frame Rate Table</button>
      </div>

      {tab === 'products' ? (
        <Card title="Dimension product rates" right={<SlidersHorizontal size={18} color="var(--text-3)" />}>
          <div className="grid grid-2" style={{ marginBottom: 8 }}>
            {PRODUCT_FIELDS.map((f) => (
              <Field key={f.key} label={`${f.label} — rate per sq.ft (₹)`}>
                <input
                  className="input"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  value={rates[f.key]}
                  onChange={(e) => setRates({ ...rates, [f.key]: parseFloat(e.target.value) || 0 })}
                />
              </Field>
            ))}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginBottom: 14 }}>
            Calculation: Width × Height = sq.ft, then sq.ft × rate = amount. Custom items are priced per item at billing time.
          </div>
          <Button onClick={() => void saveRates()} disabled={savingRates}>{savingRates ? 'Saving…' : 'Save Product Rates'}</Button>
        </Card>
      ) : (
        <Card
          title={`Frame Rate Table (${rows.length})`}
          right={<Button size="sm" onClick={addRow}><Plus size={15} /> Add Size</Button>}
        >
          <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginBottom: 14 }}>
            One row per photo size (inches). Leave a price empty when that thickness is not offered — it is never stored as 0.
            Billing picks the price straight from this table, so saving here updates the calculator immediately.
          </div>
          {rows.length === 0 ? (
            <div className="empty-state">
              <div className="es-icon"><Table2 size={24} /></div>
              <h4>No frame sizes yet</h4>
              <p>Add the first size (e.g. "12x18") with Add Size.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="tbl stack-cards frame-price-table">
                <thead>
                  <tr>
                    <th style={{ minWidth: 90 }}>Size</th>
                    {FRAME_THICKNESS_COLUMNS.map((c) => (
                      <th key={c.key} className="num" style={{ minWidth: 92 }}>{c.label} (₹)</th>
                    ))}
                    <th>Active</th>
                    <th className="actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.id ?? `new-${i}`}>
                      <td data-label="Size">
                        <input
                          className="input"
                          style={{ width: 86 }}
                          placeholder="12x18"
                          value={r.size}
                          onChange={(e) => setRow(i, { size: e.target.value })}
                        />
                      </td>
                      {FRAME_THICKNESS_COLUMNS.map((c) => (
                        <td key={c.key} data-label={c.label} className="num">
                          <input
                            className="input"
                            style={{ width: 86 }}
                            type="number"
                            inputMode="numeric"
                            min={0}
                            placeholder="—"
                            value={r[c.key]}
                            onChange={(e) => setPrice(i, c.key, e.target.value)}
                          />
                        </td>
                      ))}
                      <td data-label="Active">
                        <button className={`badge ${r.active ? 'badge-paid' : 'badge-neutral'}`} onClick={() => setRow(i, { active: !r.active })} style={{ cursor: 'pointer' }}>
                          <Power size={12} /> {r.active ? 'Active' : 'Inactive'}
                        </button>
                      </td>
                      <td className="actions" onClick={(e) => e.stopPropagation()}>
                        <button className="icon-btn danger" onClick={() => setDeleting(r)} title="Delete size"><Trash2 size={15} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {frameError && <div className="form-error" style={{ marginTop: 12 }}>{frameError}</div>}
          <Row style={{ marginTop: 14 }}>
            <Button onClick={() => void save()} disabled={!hasChanges || saving}>
              <Save size={16} /> {saving ? 'Saving…' : hasChanges ? 'Save Changes' : 'Saved'}
            </Button>
            {hasChanges && (
              <Button variant="ghost" onClick={discard}>
                <RotateCcw size={15} /> Discard
              </Button>
            )}
          </Row>
        </Card>
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Delete frame size?"
        message={deleting ? `Size "${deleting.size || 'new row'}" will be removed from the table when you save.` : ''}
        confirmLabel="Delete"
        onConfirm={() => confirmDelete()}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
