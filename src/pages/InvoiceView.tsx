import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Printer, FileDown, Image as ImageIcon, Pencil, HandCoins, PartyPopper } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { InvoiceDocument } from '../components/InvoiceDocument';
import { downloadInvoiceJpg, downloadInvoicePdf, invoiceFileName, printInvoice } from '../services/export';
import { recordPayment } from '../services/payments';
import { Button, Card, ConfirmDialog, Field, Modal, Row, Spinner, useToast } from '../components/ui';
import { formatINR, formatDate } from '../lib/format';

export function InvoiceViewPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const app = useApp();

  const invoice = useMemo(() => app.invoices.find((i) => i.id === id), [app.invoices, id]);
  // Payment records for this invoice, oldest first (each keeps its own Payment Date).
  const invoicePayments = useMemo(
    () => app.payments.filter((p) => p.invoiceId === id).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
    [app.payments, id]
  );
  const [exporting, setExporting] = useState<'pdf' | 'jpg' | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [payMethod, setPayMethod] = useState('Cash');
  const [payNote, setPayNote] = useState('');
  const [payBusy, setPayBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const printRootRef = useRef<HTMLDivElement>(null);
  const scaleWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (params.get('new') === '1') {
      toast('Invoice saved successfully', 'success');
      params.delete('new');
      setParams(params, { replace: true });
    }
  }, [params, setParams, toast]);

  if (!invoice) {
    return (
      <div className="page">
        <Spinner label="Loading invoice…" />
      </div>
    );
  }

  const el = () => printRootRef.current?.querySelector('#invoice-paper') as HTMLElement | null;

  /** Temporarily un-zoom the scale wrapper so export captures the full 794px paper. */
  const captureNode = async <T,>(fn: () => Promise<T>): Promise<T> => {
    const wrap = scaleWrapRef.current;
    const prev = wrap?.style.zoom;
    if (wrap) wrap.style.zoom = '1';
    try {
      return await fn();
    } finally {
      if (wrap) wrap.style.zoom = prev || '';
    }
  };

  const doPdf = async () => {
    const node = el();
    if (!node) return;
    setExporting('pdf');
    try {
      await captureNode(() => downloadInvoicePdf(node, invoiceFileName(invoice.number, 'pdf')));
      toast('PDF downloaded', 'success');
    } catch (e) {
      toast('PDF generation failed: ' + (e as Error).message, 'error');
    } finally {
      setExporting(null);
    }
  };

  const doJpg = async () => {
    const node = el();
    if (!node) return;
    setExporting('jpg');
    try {
      await captureNode(() => downloadInvoiceJpg(node, invoiceFileName(invoice.number, 'jpg')));
      toast('JPG downloaded', 'success');
    } catch (e) {
      toast('JPG generation failed: ' + (e as Error).message, 'error');
    } finally {
      setExporting(null);
    }
  };

  const doPayment = async () => {
    setPayBusy(true);
    try {
      await recordPayment(app.service, invoice, {
        invoiceId: invoice.id,
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

  const doDelete = async () => {
    await app.service.delete('invoices', invoice.id);
    toast('Invoice deleted', 'info');
    navigate('/invoices');
  };

  return (
    <div className="page">
      <div id="invoice-print-root" ref={printRootRef}>
        <ScaledPaper wrapRef={scaleWrapRef}>
          <InvoiceDocument invoice={invoice} business={app.business} payments={invoicePayments} />
        </ScaledPaper>
      </div>

      <div style={{ maxWidth: 794, margin: '0 auto' }}>
        <Row style={{ marginTop: 18, justifyContent: 'space-between' }}>
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
            <ArrowLeft size={16} /> Back
          </Button>
          <Row>
            <Button variant="ghost" size="sm" onClick={() => navigate(`/billing/${invoice.id}`)}>
              <Pencil size={15} /> Edit
            </Button>
            {invoice.balance > 0 && (
              <Button variant="success" size="sm" onClick={() => setPayOpen(true)}>
                <HandCoins size={15} /> Record Payment
              </Button>
            )}
          </Row>
        </Row>

        <Row style={{ margin: '14px 0' }}>
          <Button onClick={() => void doPdf()} disabled={exporting !== null}>
            {exporting === 'pdf' ? <Spinner /> : <FileDown size={17} />} Download PDF
          </Button>
          <Button variant="dark" onClick={() => void doJpg()} disabled={exporting !== null}>
            {exporting === 'jpg' ? <Spinner /> : <ImageIcon size={17} />} Download JPG
          </Button>
          <Button variant="ghost" onClick={() => printInvoice()}>
            <Printer size={17} /> Print
          </Button>
          <Button variant="ghost" style={{ color: 'var(--red)' }} onClick={() => setDeleteOpen(true)}>
            Delete
          </Button>
        </Row>
        <Card>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 14, fontSize: 14 }}>
            <div>
              <div style={{ color: 'var(--text-3)', fontSize: 12, fontWeight: 600 }}>Invoice No</div>
              <b>{invoice.number}</b>
            </div>
            <div>
              <div style={{ color: 'var(--text-3)', fontSize: 12, fontWeight: 600 }}>Bill Date</div>
              <b>{formatDate(invoice.date)}</b>
            </div>
            <div>
              <div style={{ color: 'var(--text-3)', fontSize: 12, fontWeight: 600 }}>Customer</div>
              <b>{invoice.customer.name}</b>
            </div>
            <div>
              <div style={{ color: 'var(--text-3)', fontSize: 12, fontWeight: 600 }}>Total</div>
              <b>{formatINR(invoice.total)}</b>
            </div>
            <div>
              <div style={{ color: 'var(--text-3)', fontSize: 12, fontWeight: 600 }}>Paid</div>
              <b style={{ color: 'var(--green)' }}>{formatINR(invoice.paid)}</b>
            </div>
            <div>
              <div style={{ color: 'var(--text-3)', fontSize: 12, fontWeight: 600 }}>Balance</div>
              <b style={{ color: invoice.balance > 0 ? 'var(--red)' : 'var(--green)' }}>{formatINR(invoice.balance)}</b>
            </div>
          </div>
          {invoice.balance === 0 && (
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--green)', fontWeight: 700, fontSize: 14 }}>
              <PartyPopper size={17} /> Fully paid
            </div>
          )}
        </Card>
      </div>

      {/* payment modal */}
      <Modal open={payOpen} title={`Record payment — ${invoice.number}`} onClose={() => setPayOpen(false)} width={440}>
        <Field label={`Amount (balance due ${formatINR(invoice.balance)})`}>
          <input className="input" type="number" inputMode="decimal" placeholder="0" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} autoFocus />
        </Field>
        <div className="input-row">
          <Field label="Payment Date">
            <input className="input" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
          </Field>
          <Field label="Method">
            <select className="select" value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
              <option>Cash</option>
              <option>UPI</option>
              <option>Card</option>
              <option>Bank Transfer</option>
              <option>Other</option>
            </select>
          </Field>
        </div>
        <Field label="Note (optional)">
          <input className="input" value={payNote} onChange={(e) => setPayNote(e.target.value)} placeholder="e.g. Paid via GPay" />
        </Field>
        <Button block size="lg" disabled={payBusy} onClick={() => void doPayment()}>
          {payBusy ? 'Saving…' : 'Save Payment'}
        </Button>
      </Modal>

      <ConfirmDialog
        open={deleteOpen}
        title="Delete invoice?"
        message={`Invoice ${invoice.number} (${formatINR(invoice.total)}) will be permanently removed. Customer ledger is not adjusted automatically.`}
        confirmLabel="Delete"
        onConfirm={() => void doDelete()}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  );
}

/**
 * Scales the 794px A4 paper to fit small screens using CSS `zoom`
 * (supported by Chromium on Web, Windows and Android). Export functions
 * temporarily reset zoom to 1 so PDF/JPG always capture full resolution.
 */
function ScaledPaper({ children, wrapRef }: { children: ReactNode; wrapRef: React.RefObject<HTMLDivElement> }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const measure = () => {
      const w = outerRef.current?.clientWidth || 794;
      setScale(Math.min(1, w / 794));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (outerRef.current) ro.observe(outerRef.current);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  return (
    <div ref={outerRef} style={{ width: '100%', maxWidth: 794, margin: '0 auto' }}>
      <div className="invoice-scale-wrap" ref={wrapRef} style={{ zoom: scale }}>
        {children}
      </div>
    </div>
  );
}
