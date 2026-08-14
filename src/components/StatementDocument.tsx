import { useEffect, useState } from 'react';
import type { BusinessSettings } from '../lib/types';
import { APP_TAGLINE, APP_NAME } from '../lib/constants';
import { formatDate, formatDateTime, formatINR } from '../lib/format';
import { getLogoDataUrl } from '../lib/logo';
import type { StatementData } from '../lib/statement';

/**
 * A4 customer statement (794px, same width/design as the invoice) showing the
 * customer's FULL transaction history for the selected date range:
 * opening balance, every invoice + payment + adjustment in chronological
 * order (invoice items included), running balance, closing balance and the
 * period identification (customer name + start/end dates) on the page and in
 * the exported filename.
 */
export function StatementDocument({
  statement,
  business
}: {
  statement: StatementData;
  business: BusinessSettings;
}) {
  const [logo, setLogo] = useState('');
  useEffect(() => {
    void getLogoDataUrl(128).then(setLogo);
  }, []);

  return (
    // width pinned to 794px (A4 @96dpi) so PDF/JPG capture is pixel-identical
    // on every platform — inline style wins over the mobile 100%-width rule.
    <div className="invoice-paper stmt-paper" id="statement-paper" style={{ width: 794 }}>
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
          <h1>STATEMENT</h1>
          <div className="inv-meta">
            <div><span className="k">Period</span><span className="v">{formatDate(statement.startDate)} – {formatDate(statement.endDate)}</span></div>
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
          <h4>Account Statement</h4>
          <div className="strong">{statement.customer.name}</div>
          {statement.customer.phone && <div>Phone: {statement.customer.phone}</div>}
          {statement.customer.address && <div>{statement.customer.address}</div>}
        </div>
      </div>

      {/* opening balance strip */}
      <div className="stmt-bal">
        <div className="stmt-bal-item">
          <span className="k">Opening Balance</span>
          <span className="v">{formatINR(statement.openingBalance)}</span>
        </div>
        <div className="stmt-bal-item">
          <span className="k">Total Billed</span>
          <span className="v">{formatINR(statement.totalDebit)}</span>
        </div>
        <div className="stmt-bal-item">
          <span className="k">Total Received</span>
          <span className="v">{formatINR(statement.totalCredit)}</span>
        </div>
      </div>

      {/* transactions */}
      <div className="inv-items">
        <table className="inv-tbl stmt-tbl">
          <thead>
            <tr>
              <th style={{ width: 92 }}>Date</th>
              <th>Description</th>
              <th className="num">Debit</th>
              <th className="num">Credit</th>
              <th className="num">Balance</th>
            </tr>
          </thead>
          <tbody>
            <tr className="stmt-open">
              <td>{formatDate(statement.startDate)}</td>
              <td style={{ fontWeight: 700 }}>Opening Balance</td>
              <td className="num">—</td>
              <td className="num">—</td>
              <td className="num" style={{ fontWeight: 700 }}>{formatINR(statement.openingBalance)}</td>
            </tr>
            {statement.rows.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', color: '#64748b', padding: '18px 10px' }}>
                  No transactions in this period.
                </td>
              </tr>
            )}
            {statement.rows.map((r) => (
              <tr key={r.key} className={r.type === 'payment' ? 'stmt-pay-row' : ''}>
                <td>{formatDate(r.date)}</td>
                <td>
                  <div style={{ fontWeight: r.type === 'payment' ? 600 : 700 }}>
                    {r.description}
                    {r.invoiceNumber && r.type !== 'invoice' ? (
                      <span style={{ color: '#64748b', fontWeight: 500 }}> — {r.invoiceNumber}</span>
                    ) : null}
                  </div>
                  {r.items && r.items.length > 0 && (
                    <div className="stmt-items">
                      {r.items.map((it, idx) => (
                        <div key={idx} className="stmt-item">
                          <span className="si-name">{it.label}</span>
                          <span className="si-size">{it.size}</span>
                          <span className="si-qty">{it.qty} × {formatINR(it.rate)}</span>
                          <span className="si-amt">{formatINR(it.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </td>
                <td className="num">{r.debit > 0 ? formatINR(r.debit) : '—'}</td>
                <td className="num">{r.credit > 0 ? formatINR(r.credit) : '—'}</td>
                <td className="num" style={{ fontWeight: 700 }}>{formatINR(r.balanceAfter)}</td>
              </tr>
            ))}
            <tr className="stmt-close">
              <td>{formatDate(statement.endDate)}</td>
              <td style={{ fontWeight: 800 }}>Closing / Outstanding Balance</td>
              <td className="num">—</td>
              <td className="num">—</td>
              <td className="num" style={{ fontWeight: 800 }}>{formatINR(statement.closingBalance)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* footer */}
      <div className="inv-foot">
        <div className="note" style={{ flex: 1 }}>
          <div>
            <strong>Statement period:</strong> {formatDate(statement.startDate)} to {formatDate(statement.endDate)}
          </div>
          <div style={{ marginTop: 3 }}>
            <strong>Customer:</strong> {statement.customer.name}
          </div>
          <div style={{ marginTop: 3, color: '#94a3b8' }}>
            Generated on {formatDateTime(new Date().toISOString())}
          </div>
        </div>
        <div className="thanks">
          <div style={{ fontWeight: 800, fontSize: 14 }}>{business.footer || 'Thank you for your business!'}</div>
          <div style={{ color: '#64748b', fontWeight: 400, fontSize: 11, marginTop: 4 }}>SK Flex Billing</div>
        </div>
      </div>

      <div style={{ height: 5, background: 'var(--navy-900)' }} />
    </div>
  );
}
