import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Package,
  PackagePlus,
  ScanLine,
  Camera,
  Upload,
  Plus,
  Trash2,
  History,
  CheckCircle2,
  AlertTriangle,
  Boxes,
  Truck,
  RotateCcw,
  Ban
} from 'lucide-react';
import { useApp, useLiveCollection } from '../store/AppContext';
import { Button, Card, ConfirmDialog, EmptyState, Field, Modal, useToast } from '../components/ui';
import type {
  Material,
  MaterialType,
  RateUnit,
  StockMovement,
  SupplierBill,
  SupplierBillLine
} from '../lib/types';
import { MATERIAL_TYPES } from '../lib/types';
import {
  MATERIALS,
  STOCK_MOVEMENTS,
  SUPPLIER_BILLS,
  STOCK_STATE_LABEL,
  billDedupeKey,
  billIssues,
  confirmSupplierBill,
  computeBillTotal,
  computeMaterialsTotal,
  expectedLineAmount,
  findDuplicateBill,
  lowStockMaterials,
  markMaterialFinished,
  restockMaterial,
  stockState
} from '../services/inventory';
import { emptyBillLine, parseBillText } from '../lib/billScan';
import { isOcrSupported, recognizeBillImage } from '../lib/ocr';
import { formatINR } from '../lib/format';
import { runtimePlatform } from '../lib/platform';

interface DraftState {
  supplierName: string;
  billNumber: string;
  billDate: string;
  lines: SupplierBillLine[];
  vehicleCharge: number;
  note: string;
  /** Printed total from the bill (for mismatch checks), 0 when not provided. */
  printedTotal: number;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const RATE_UNITS: { value: RateUnit; label: string }[] = [
  { value: 'roll', label: 'per roll' },
  { value: 'foot', label: 'per foot' },
  { value: 'metre', label: 'per metre' },
  { value: 'sqft', label: 'per sq.ft' },
  { value: 'piece', label: 'per piece' }
];

export function InventoryPage() {
  const app = useApp();
  const toast = useToast();
  const materials = useLiveCollection<Material>(app.service, MATERIALS, { orderBy: { field: 'name', dir: 'asc' } });
  const movements = useLiveCollection<StockMovement>(app.service, STOCK_MOVEMENTS, {
    orderBy: { field: 'createdAt', dir: 'desc' }
  });
  const bills = useLiveCollection<SupplierBill>(app.service, SUPPLIER_BILLS);

  const [tab, setTab] = useState<'materials' | 'history'>('materials');
  const [stockInOpen, setStockInOpen] = useState(false);
  const [restock, setRestock] = useState<Material | null>(null);
  const [restockQty, setRestockQty] = useState('1');
  const [finishTarget, setFinishTarget] = useState<Material | null>(null);
  const [busy, setBusy] = useState(false);

  const low = useMemo(() => lowStockMaterials(materials), [materials]);
  const totalRolls = useMemo(() => materials.reduce((s, m) => (m.finished ? s : s + (Number(m.quantity) || 0)), 0), [materials]);

  const doRestock = async () => {
    if (!restock) return;
    setBusy(true);
    try {
      await restockMaterial(app.service, restock, Number(restockQty), todayISO(), 'Restock');
      toast(`Added ${restockQty} to ${restock.name}`, 'success');
      setRestock(null);
      setRestockQty('1');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const doFinish = async () => {
    if (!finishTarget) return;
    setBusy(true);
    try {
      await markMaterialFinished(app.service, finishTarget);
      toast(`${finishTarget.name} marked as finished`, 'success');
      setFinishTarget(null);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title">Inventory</h1>
          <p className="page-sub">Roll-wise material stock, supplier bills and stock history</p>
        </div>
        <Button onClick={() => setStockInOpen(true)} disabled={app.preview}>
          <PackagePlus size={17} /> Stock In
        </Button>
      </div>

      {low.length > 0 && (
        <div className="low-stock-banner">
          <AlertTriangle size={16} />
          {low.length} material{low.length > 1 ? 's' : ''} low or out of stock · {low.map((m) => m.name).slice(0, 3).join(', ')}
          {low.length > 3 ? '…' : ''}
        </div>
      )}

      <Card title={`Materials (${materials.filter((m) => !m.finished).length})`} right={<Boxes size={18} color="var(--text-3)" />}>
        <div className="chips" style={{ marginBottom: 14 }}>
          <button className={`chip${tab === 'materials' ? ' active' : ''}`} onClick={() => setTab('materials')}>
            <Package size={14} style={{ verticalAlign: -2, marginRight: 5 }} />
            Stock
          </button>
          <button className={`chip${tab === 'history' ? ' active' : ''}`} onClick={() => setTab('history')}>
            <History size={14} style={{ verticalAlign: -2, marginRight: 5 }} />
            History
          </button>
          <div style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--text-3)', alignSelf: 'center' }}>
            {totalRolls} roll{totalRolls === 1 ? '' : 's'} in stock
          </div>
        </div>

        {tab === 'materials' ? (
          materials.length === 0 ? (
            <EmptyState
              icon={<Package size={22} />}
              title="No materials yet"
              text="Use Stock In to scan a supplier bill or add a roll manually. Customer billing works whether or not stock is available."
              action={
                <Button onClick={() => setStockInOpen(true)} disabled={app.preview}>
                  <PackagePlus size={16} /> Stock In
                </Button>
              }
            />
          ) : (
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Material</th>
                    <th>Roll size</th>
                    <th className="num">Qty</th>
                    <th className="num">Cost</th>
                    <th>Supplier</th>
                    <th>Status</th>
                    <th className="actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {materials.map((m) => {
                    const state = stockState(m);
                    return (
                      <tr key={m.id}>
                        <td>
                          <div style={{ fontWeight: 700 }}>{m.name}</div>
                          <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{m.type}</div>
                        </td>
                        <td>{m.rollSizeFt ? `${m.rollSizeFt} ft` : '—'}</td>
                        <td className="num">
                          <b>{m.quantity}</b> {m.unit}
                        </td>
                        <td className="num">{m.cost ? formatINR(m.cost) : '—'}</td>
                        <td style={{ fontSize: 13 }}>{m.supplier || '—'}</td>
                        <td>
                          <span className={`stock-pill stock-${state}`}>{STOCK_STATE_LABEL[state]}</span>
                        </td>
                        <td className="actions">
                          <div style={{ display: 'inline-flex', gap: 6 }}>
                            <Button size="sm" variant="ghost" onClick={() => { setRestock(m); setRestockQty('1'); }} disabled={app.preview || m.finished}>
                              <RotateCcw size={14} /> Restock
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setFinishTarget(m)} disabled={app.preview || m.finished}>
                              <Ban size={14} /> Finished
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : movements.length === 0 ? (
          <EmptyState icon={<History size={22} />} title="No stock history yet" text="Every Stock In, restock and finished roll is recorded here." />
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Material</th>
                  <th>Movement</th>
                  <th className="num">Qty</th>
                  <th>Supplier</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id}>
                    <td>{m.date}</td>
                    <td>{m.materialName}</td>
                    <td style={{ textTransform: 'capitalize' }}>{m.type}</td>
                    <td className="num">{m.quantity}</td>
                    <td style={{ fontSize: 13 }}>{m.supplier || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Supplier bills" right={<Truck size={18} color="var(--text-3)" />}>
        {bills.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-3)' }}>
            No confirmed supplier bills yet. Stock In → Scan Bill creates one when you confirm.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Bill</th>
                  <th>Date</th>
                  <th>Supplier</th>
                  <th className="num">Materials</th>
                  <th className="num">Vehicle</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {[...bills].sort((a, b) => (a.billDate < b.billDate ? 1 : -1)).map((b) => (
                  <tr key={b.id}>
                    <td style={{ fontWeight: 700 }}>{b.billNumber || '—'}</td>
                    <td>{b.billDate}</td>
                    <td style={{ fontSize: 13 }}>{b.supplierName}</td>
                    <td className="num">{formatINR(b.materialsTotal)}</td>
                    <td className="num">{b.vehicleCharge ? formatINR(b.vehicleCharge) : '—'}</td>
                    <td className="num">
                      <b>{formatINR(b.total)}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <StockInModal
        open={stockInOpen}
        onClose={() => setStockInOpen(false)}
        bills={bills}
        onConfirmed={(msg) => toast(msg, 'success')}
        onError={(msg) => toast(msg, 'error')}
      />

      <Modal open={!!restock} title={`Restock ${restock?.name || ''}`} onClose={() => setRestock(null)} width={380}>
        <Field label="Rolls added">
          <input className="input" type="number" min="0.5" step="0.5" value={restockQty} onChange={(e) => setRestockQty(e.target.value)} />
        </Field>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="ghost" onClick={() => setRestock(null)}>
            Cancel
          </Button>
          <Button onClick={() => void doRestock()} disabled={busy}>
            Add stock
          </Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!finishTarget}
        title="Mark roll as finished?"
        confirmLabel="Mark finished"
        message={
          <div>
            <b>{finishTarget?.name}</b> will be removed from active stock and kept in history. Customer billing is not affected.
          </div>
        }
        onConfirm={() => void doFinish()}
        onCancel={() => setFinishTarget(null)}
      />
    </div>
  );
}

/* ============================================================
   Stock In (manual entry + Scan Bill OCR draft)
   ============================================================ */

function StockInModal({
  open,
  onClose,
  bills,
  onConfirmed,
  onError
}: {
  open: boolean;
  onClose: () => void;
  bills: SupplierBill[];
  onConfirmed: (message: string) => void;
  onError: (message: string) => void;
}) {
  const app = useApp();
  const [draft, setDraft] = useState<DraftState>(() => newDraft());
  const [scanOpen, setScanOpen] = useState(false);
  const [rawText, setRawText] = useState('');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrError, setOcrError] = useState('');
  const [cameraOn, setCameraOn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [duplicate, setDuplicate] = useState<SupplierBill | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const platform = runtimePlatform();

  useEffect(() => {
    if (open) {
      setDraft(newDraft());
      setRawText('');
      setImageUrl(null);
      setOcrError('');
      setScanOpen(false);
    } else {
      stopCamera();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const materialsTotal = useMemo(() => computeMaterialsTotal(draft.lines), [draft.lines]);
  const total = useMemo(() => computeBillTotal(draft.lines, draft.vehicleCharge), [draft.lines, draft.vehicleCharge]);
  const issues = useMemo(() => billIssues({ ...draft, total }), [draft, total]);
  const dedupeKey = billDedupeKey(draft.supplierName, draft.billNumber, draft.billDate);
  const existingDuplicate = useMemo(() => findDuplicateBill(bills, dedupeKey), [bills, dedupeKey]);

  const updateLine = (index: number, patch: Partial<SupplierBillLine>) => {
    setDraft((d) => {
      const lines = d.lines.map((l, i) => {
        if (i !== index) return l;
        const next = { ...l, ...patch };
        // Amount follows quantity × rate unless the user typed an amount.
        if (!('amount' in patch)) next.amount = expectedLineAmount(next);
        return next;
      });
      return { ...d, lines };
    });
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
  };

  useEffect(() => () => stopCamera(), []);

  const startCamera = async () => {
    setOcrError('');
    if (platform === 'android') {
      // The native camera app is the reliable path on Android.
      fileRef.current?.click();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      setCameraOn(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch {
      setOcrError('No webcam available. Upload a photo of the bill instead — that works on every PC.');
    }
  };

  const captureFromWebcam = async () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
    stopCamera();
    await runOcr(canvas.toDataURL('image/jpeg', 0.92));
  };

  const runOcr = async (source: Blob | string) => {
    setOcrBusy(true);
    setOcrProgress(0);
    setOcrError('');
    if (typeof source === 'string') setImageUrl(source);
    else setImageUrl(URL.createObjectURL(source));
    try {
      const { text } = await recognizeBillImage(source, (_m, p) => setOcrProgress(Math.round(p * 100)));
      setRawText(text);
      applyParsed(text);
    } catch (e) {
      setOcrError((e as Error).message || 'Could not read that bill. Enter it manually below.');
    } finally {
      setOcrBusy(false);
    }
  };

  const applyParsed = (text: string) => {
    const parsed = parseBillText(text);
    setDraft((d) => ({
      supplierName: parsed.supplierName || d.supplierName,
      billNumber: parsed.billNumber || d.billNumber,
      billDate: parsed.billDate || d.billDate,
      lines: parsed.lines.length ? parsed.lines : d.lines,
      vehicleCharge: parsed.vehicleCharge || d.vehicleCharge,
      note: d.note,
      printedTotal: parsed.printedTotal || d.printedTotal
    }));
  };

  const doConfirm = async (allowDuplicate = false) => {
    if (issues.length > 0 && !allowDuplicate) {
      setPendingConfirm(true);
      return;
    }
    if (existingDuplicate && !allowDuplicate) {
      setDuplicate(existingDuplicate);
      return;
    }
    setSaving(true);
    try {
      const result = await confirmSupplierBill(app.service, {
        supplierName: draft.supplierName,
        billNumber: draft.billNumber,
        billDate: draft.billDate,
        lines: draft.lines,
        vehicleCharge: draft.vehicleCharge,
        total: draft.printedTotal || total,
        note: draft.note
      });
      if (result.status === 'duplicate') {
        onConfirmed('This supplier bill was already added — stock was not changed.');
      } else {
        onConfirmed(`Stock added: ${result.movements} line${result.movements === 1 ? '' : 's'}, ${formatINR(total)} purchase`);
      }
      onClose();
    } catch (e) {
      onError((e as Error).message || 'Could not add stock');
    } finally {
      setSaving(false);
      setDuplicate(null);
      setPendingConfirm(false);
    }
  };

  return (
    <Modal open={open} title="Stock In" onClose={onClose} width={860}>
      {app.preview && (
        <div className="preview-banner" style={{ borderRadius: 10, marginBottom: 12 }}>
          Preview SK Flex is read-only — sign in with Google to add stock.
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <Button variant={scanOpen ? 'dark' : 'ghost'} onClick={() => setScanOpen((v) => !v)}>
          <ScanLine size={16} /> Scan Bill
        </Button>
        <div style={{ fontSize: 12.5, color: 'var(--text-3)', alignSelf: 'center' }}>
          Scan the bill to fill a draft — nothing is added until you press Confirm &amp; Add Stock.
        </div>
      </div>

      {scanOpen && (
        <div className="card" style={{ marginBottom: 16, padding: 14 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>
              <Upload size={15} /> {platform === 'android' ? 'Camera / Gallery' : 'Upload image'}
            </Button>
            {platform !== 'android' && (
              <Button variant="ghost" size="sm" onClick={() => void startCamera()}>
                <Camera size={15} /> Use webcam
              </Button>
            )}
            {cameraOn && (
              <Button size="sm" onClick={() => void captureFromWebcam()}>
                Capture
              </Button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              {...(platform === 'android' ? { capture: 'environment' as const } : {})}
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void runOcr(f);
                e.target.value = '';
              }}
            />
          </div>

          {!isOcrSupported() && (
            <div style={{ fontSize: 12.5, color: 'var(--amber)' }}>OCR is not available on this device — type the bill below.</div>
          )}

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              {imageUrl ? (
                <img className="scan-preview" src={imageUrl} alt="Supplier bill preview" />
              ) : (
                <div className="scan-drop">
                  <ScanLine size={22} />
                  <div style={{ fontSize: 13 }}>Photograph the supplier bill, or upload a picture.</div>
                </div>
              )}
              {cameraOn && (
                <video ref={videoRef} playsInline muted style={{ width: '100%', borderRadius: 8, marginTop: 8 }} />
              )}
            </div>
            <div style={{ flex: 1, minWidth: 240 }}>
              <Field label="Bill text (editable — paste or correct OCR)">
                <textarea
                  className="textarea"
                  rows={6}
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  placeholder={'Supplier: Sri Vinayaga Suppliers\nBill No: SVS/1042  Date: 12/11/2026\nFlex 10 ft roll x 2  2450  4900\nVinyl 8 ft roll x 1  1800  1800'}
                />
              </Field>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Button size="sm" variant="ghost" onClick={() => applyParsed(rawText)} disabled={!rawText.trim()}>
                  Read into draft
                </Button>
                {ocrBusy && (
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>Reading bill… {ocrProgress}%</div>
                    <div className="progress-track">
                      <i style={{ width: `${ocrProgress}%` }} />
                    </div>
                  </div>
                )}
              </div>
              {ocrError && <div className="form-error">{ocrError}</div>}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-2">
        <Field label="Supplier name">
          <input className="input" value={draft.supplierName} onChange={(e) => setDraft({ ...draft, supplierName: e.target.value })} placeholder="Supplier" />
        </Field>
        <div className="grid grid-2">
          <Field label="Bill number">
            <input className="input" value={draft.billNumber} onChange={(e) => setDraft({ ...draft, billNumber: e.target.value })} />
          </Field>
          <Field label="Bill date">
            <input className="input" type="date" value={draft.billDate} onChange={(e) => setDraft({ ...draft, billDate: e.target.value })} />
          </Field>
        </div>
      </div>

      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-2)', margin: '6px 0 8px' }}>Material lines</div>
      {draft.lines.map((line, index) => (
        <div className="line-grid" key={line.key}>
          <Field label="Material">
            <input
              className="input"
              value={line.description}
              onChange={(e) => updateLine(index, { description: e.target.value })}
              placeholder="e.g. Flex 10ft roll"
            />
          </Field>
          <Field label="Type">
            <select
              className="select"
              value={line.materialType}
              onChange={(e) => updateLine(index, { materialType: e.target.value as MaterialType })}
            >
              {MATERIAL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Roll size (ft)">
            <input
              className="input"
              type="number"
              min="0"
              step="0.5"
              value={line.rollSizeFt || ''}
              onChange={(e) => updateLine(index, { rollSizeFt: Number(e.target.value) })}
            />
          </Field>
          <Field label="Qty">
            <input
              className="input"
              type="number"
              min="0"
              step="0.5"
              value={line.quantity || ''}
              onChange={(e) => updateLine(index, { quantity: Number(e.target.value) })}
            />
          </Field>
          <Field label="Rate">
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              value={line.rate || ''}
              onChange={(e) => updateLine(index, { rate: Number(e.target.value) })}
            />
          </Field>
          <Field label="Unit">
            <select
              className="select"
              value={line.rateUnit}
              onChange={(e) => updateLine(index, { rateUnit: e.target.value as RateUnit })}
            >
              {RATE_UNITS.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </select>
          </Field>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
            <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>Amount</div>
            <div style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{formatINR(line.amount || expectedLineAmount(line))}</div>
            <button
              className="icon-btn danger"
              title="Remove line"
              onClick={() => setDraft((d) => ({ ...d, lines: d.lines.filter((_, i) => i !== index) }))}
            >
              <Trash2 size={15} />
            </button>
          </div>
        </div>
      ))}
      <Button variant="ghost" size="sm" onClick={() => setDraft((d) => ({ ...d, lines: [...d.lines, emptyBillLine(d.lines.length)] }))}>
        <Plus size={15} /> Add line
      </Button>

      <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
        {draft.vehicleCharge > 0 ? (
          <div className="total-line">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Truck size={15} /> Vehicle charge
              <input
                className="input"
                style={{ width: 110 }}
                type="number"
                min="0"
                step="0.01"
                value={draft.vehicleCharge}
                onChange={(e) => setDraft({ ...draft, vehicleCharge: Number(e.target.value) })}
              />
            </div>
            <button className="icon-btn danger" title="Remove vehicle charge" onClick={() => setDraft({ ...draft, vehicleCharge: 0 })}>
              <Trash2 size={14} />
            </button>
          </div>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setDraft({ ...draft, vehicleCharge: 0.01 })}>
            <Truck size={15} /> Add vehicle charge
          </Button>
        )}
        <div className="total-line">
          <span>Materials</span>
          <span>{formatINR(materialsTotal)}</span>
        </div>
        <div className="total-line grand">
          <span>Purchase total</span>
          <span>{formatINR(total)}</span>
        </div>
        {draft.printedTotal > 0 && Math.abs(draft.printedTotal - total) > 0.5 && (
          <div style={{ fontSize: 12.5, color: 'var(--amber)' }}>
            Bill prints {formatINR(draft.printedTotal)} — check the lines or vehicle charge.
          </div>
        )}
      </div>

      {issues.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--amber)', display: 'flex', gap: 6, alignItems: 'center' }}>
            <AlertTriangle size={14} /> Review before adding stock
          </div>
          <ul className="issue-list">
            {issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16, flexWrap: 'wrap' }}>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => void doConfirm(false)} disabled={saving || app.preview}>
          <CheckCircle2 size={16} /> {saving ? 'Adding…' : 'Confirm & Add Stock'}
        </Button>
      </div>

      <ConfirmDialog
        open={!!duplicate}
        title="Possible duplicate bill"
        confirmLabel="Add anyway"
        message={
          <div>
            {duplicate?.supplierName} bill <b>{duplicate?.billNumber}</b> dated {duplicate?.billDate} was already confirmed. Adding it again would duplicate stock.
          </div>
        }
        onConfirm={() => void doConfirm(true)}
        onCancel={() => setDuplicate(null)}
      />

      <ConfirmDialog
        open={pendingConfirm}
        title="Values need review"
        danger={false}
        confirmLabel="Add anyway"
        message={<div>{issues.length} issue(s) were flagged (unreadable values, ambiguous rate units or a total mismatch). Add the stock anyway?</div>}
        onConfirm={() => {
          setPendingConfirm(false);
          if (existingDuplicate) setDuplicate(existingDuplicate);
          else void doConfirm(true);
        }}
        onCancel={() => setPendingConfirm(false)}
      />
    </Modal>
  );
}

function newDraft(): DraftState {
  return {
    supplierName: '',
    billNumber: '',
    billDate: todayISO(),
    lines: [emptyBillLine(0)],
    vehicleCharge: 0,
    note: '',
    printedTotal: 0
  };
}
