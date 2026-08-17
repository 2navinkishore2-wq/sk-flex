import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, ChevronRight } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { ledgerStats } from '../services/ledger';
import { formatINR } from '../lib/format';
import { Card, EmptyState, SearchInput } from '../components/ui';

export function LedgerPage() {
  const { customers, ledger } = useApp();
  const navigate = useNavigate();
  const [term, setTerm] = useState('');

  const rows = useMemo(() => {
    const t = term.trim().toLowerCase();
    return customers
      .map((c) => {
        const entries = ledger.filter((e) => e.customerId === c.id);
        const stats = ledgerStats(entries);
        return { customer: c, ...stats };
      })
      .filter((r) => !t || r.customer.name.toLowerCase().includes(t) || r.customer.phone.replace(/\s/g, '').includes(t.replace(/\s/g, '')))
      .sort((a, b) => b.balance - a.balance);
  }, [customers, ledger, term]);

  const totalOutstanding = useMemo(() => rows.reduce((a, r) => a + Math.max(0, r.balance), 0), [rows]);

  return (
    <div className="page">
      <h1 className="page-title">Ledger</h1>
      <p className="page-sub">
        Customer accounts · Outstanding total: <b style={{ color: totalOutstanding > 0 ? 'var(--red)' : 'var(--green)' }}>{formatINR(totalOutstanding)}</b>
      </p>

      <Card>
        <div style={{ marginBottom: 14 }}>
          <SearchInput value={term} onChange={setTerm} placeholder="Search customer…" />
        </div>
        {rows.length === 0 ? (
          <EmptyState
            icon={<BookOpen size={24} />}
            title={term ? 'No customers match' : 'No ledger entries yet'}
            text={term ? 'Try a different name or phone.' : 'Create invoices to see each customer’s account here.'}
          />
        ) : (
          <div className="table-wrap">
            <table className="tbl stack-cards">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Phone</th>
                  <th className="num">Total Billed</th>
                  <th className="num">Total Paid</th>
                  <th className="num">Outstanding</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.customer.id} className="clickable" onClick={() => navigate(`/customers/${r.customer.id}`)}>
                    <td data-label="Customer">
                      <b>{r.customer.name}</b>
                      <div style={{ color: 'var(--text-3)', fontSize: 12.5 }}>{r.invoiceCount} invoice{r.invoiceCount === 1 ? '' : 's'}</div>
                    </td>
                    <td data-label="Phone">{r.customer.phone}</td>
                    <td className="num" data-label="Total Billed">{formatINR(r.billed)}</td>
                    <td className="num" data-label="Total Paid" style={{ color: 'var(--green)' }}>{formatINR(r.paid)}</td>
                    <td className="num" data-label="Outstanding" style={{ color: r.balance > 0 ? 'var(--red)' : 'var(--green)', fontWeight: 800 }}>
                      {r.balance > 0 ? formatINR(r.balance) : r.balance < 0 ? `Credit ${formatINR(Math.abs(r.balance))}` : '₹0'}
                    </td>
                    <td className="num"><ChevronRight size={17} color="var(--text-3)" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
