import { useEffect, useState } from 'react';
import type { BusinessSettings, Invoice, Payment } from '../lib/types';
import { APP_TAGLINE, APP_NAME } from '../lib/constants';
import { formatDate, formatINR, STATUS_LABEL } from '../lib/format';
import { getLogoDataUrl } from '../lib/logo';

export function sizeLabel(item: { width?: number; height?: number; area?: number; unit?: string; qty: number }): string {
  if (item.width != null && item.height != null) {
    const qty = item.qty > 1 ? ` × ${item.qty}` : '';
    return `${item.width} × ${item.height} ft${qty}`;
  }
  return '—';
}

/**
 * Renders the complete invoice at exactly 794px (A4 @96dpi) so print,
 * PDF and JPG output are pixel-identical across Web / Windows / Android.
 */
export function InvoiceDocument({
  invoice,
  business,
  payments = []
}: {
  invoice: Invoice;
  business: BusinessSettings;
  /** Payment records for this invoice, each with its own Payment Date. */
  payments?: Payment[];
}) {
  const [logo, setLogo] = useState('');
  useEffect(() => {
    void getLogoDataUrl(128).then(setLogo);
  }, []);

  const statusClass = invoice.status === 'paid' ? '#059669' : invoice.status === 'partial' ? '#d97706' : '#dc2626';
  const discountLabel =
    invoice.discountType === 'percent' ? `${invoice.discountValue}%` : 'Discount';

  return (
    <div className="invoice-paper" id="invoice-paper">
      {/* header */}
      <div className="inv-head">
        <div className="inv-brand">
          {logo ? <img src={logo} alt={APP_NAME} /> : null}
          <div>
            <div className="inv-brand-name">{APP_NAME}</div>
            <div className="inv-brand-tag">{APP_TAGLINE}</div>
          </div>
        </div>
        <div className="inv-title">
          <h1>INVOICE</h1>
          <div className="inv-meta">
            <div><span className="k">Invoice No</span><span className="v">{invoice.number}</span></div>
            <div><span className="k">Bill Date</span><span className="v">{formatDate(invoice.date)}</span></div>
            {business.gst && (
              <div><span className="k">GSTIN</span><span className="v">{business.gst}</span></div>
            )}
          </div>
        </div>
      </div>

      {/* business + customer */}
      <div className="inv-info">
        <div className="inv-block">
          <h4>From</h4>
          <div className="strong">{APP_NAME}</div>
          {business.address && <div>{business.address}</div>}
          {business.phone && <div>Phone: {business.phone}</div>}
          {business.email && <div>Email: {business.email}</div>}
        </div>
        <div className="inv-block" style={{ textAlign: 'right' }}>
          <h4>Bill To</h4>
          <div className="strong">{invoice.customer.name}</div>
          {invoice.customer.phone && <div>Phone: {invoice.customer.phone}</div>}
          {invoice.customer.address && <div>{invoice.customer.address}</div>}
        </div>
      </div>

      {/* items */}
      <div className="inv-items">
        <table className="inv-tbl">
          <thead>
            <tr>
              <th style={{ width: 34 }}>#</th>
              <th>Item</th>
              <th>Size</th>
              <th className="num">Rate</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((it, idx) => (
              <tr key={it.key || idx}>
                <td>{idx + 1}</td>
                <td>
                  <div style={{ fontWeight: 600 }}>{it.label}</div>
                  {it.note ? <div style={{ color: '#64748b', fontSize: 11.5 }}>{it.note}</div> : null}
                </td>
                <td>{sizeLabel(it)}</td>
                <td className="num">{formatINR(it.rate)}</td>
                <td className="num" style={{ fontWeight: 600 }}>{formatINR(it.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* payment history — each payment keeps its own date, separate from the Bill Date */}
      {payments.length > 0 && (
        <div className="inv-payments">
          <h4>Payment History</h4>
          <table className="inv-tbl inv-pay-tbl">
            <thead>
              <tr>
                <th>Payment Date</th>
                <th>Method</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td>{formatDate(p.date)}</td>
                  <td>{p.method}</td>
                  <td className="num" style={{ fontWeight: 600 }}>{formatINR(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* totals */}
      <div className="inv-totals">
        <div className="inv-totals-inner">
          <div className="inv-tot-row"><span>Subtotal</span><span>{formatINR(invoice.subtotal)}</span></div>
          {invoice.discount > 0 && (
            <div className="inv-tot-row"><span>{discountLabel}</span><span>− {formatINR(invoice.discount)}</span></div>
          )}
          <div className="inv-tot-row grand"><span>Grand Total</span><span>{formatINR(invoice.total)}</span></div>
          <div className="inv-tot-row"><span>Paid</span><span>{formatINR(invoice.paid)}</span></div>
          {invoice.creditApplied != null && invoice.creditApplied > 0 && (
            <div className="inv-tot-row"><span>Advance / Credit applied</span><span>{formatINR(invoice.creditApplied)}</span></div>
          )}
          <div className="inv-tot-row balance"><span>Balance Due</span><span>{formatINR(invoice.balance)}</span></div>
        </div>
      </div>

      {/* status + notes */}
      {invoice.balance > 0 && (
        <div className="inv-paid-line" style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <span className="pill" style={{ background: '#fee2e2', color: '#dc2626' }}>
            Status: {STATUS_LABEL[invoice.status]}
          </span>
        </div>
      )}

      <div className="inv-foot">
        <div className="note" style={{ flex: 1 }}>
          {(business.paymentNote || invoice.note) && (
            <>
              {business.paymentNote && <div style={{ marginBottom: 4 }}><strong>Payment:</strong> {business.paymentNote}</div>}
              {invoice.note && <div><strong>Note:</strong> {invoice.note}</div>}
            </>
          )}
          {!business.paymentNote && !invoice.note && <div style={{ color: '#94a3b8' }}> </div>}
        </div>
        <div className="thanks">
          <div style={{ fontWeight: 800, fontSize: 14 }}>{business.footer || 'Thank you for your business!'}</div>
          <div style={{ color: '#64748b', fontWeight: 400, fontSize: 11, marginTop: 4 }}>SK Flex Billing</div>
        </div>
      </div>

      {/* status color footer accent */}
      <div style={{ height: 5, background: statusClass }} />
    </div>
  );
}
