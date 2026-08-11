import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Plus } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { searchInvoices } from '../services/invoices';
import { formatDate, formatDateLong, formatINR } from '../lib/format';
import type { Invoice, InvoiceStatus } from '../lib/types';
import { Button, EmptyState, SearchInput, StatusBadge, Card } from '../components/ui';

const FILTERS: { key: 'all' | InvoiceStatus; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'paid', label: 'Paid' },
  { key: 'partial', label: 'Partial' },
  { key: 'credit', label: 'Credit' }
];

export function InvoicesPage() {
  const { invoices } = useApp();
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const [filter, setFilter] = useState<'all' | InvoiceStatus>('all');

  // Date-wise: group by the saved Bill Date (invoice.date), newest group first.
  // Within a group, newest invoice first.
  const groups = useMemo(() => {
    const found = searchInvoices(invoices, term, filter);
    const byDate = new Map<string, Invoice[]>();
    for (const inv of found) {
      const key = inv.date || '';
      const arr = byDate.get(key) ?? [];
      arr.push(inv);
      byDate.set(key, arr);
    }
    return [...byDate.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
      .map(([date, items]) => ({ date, items: [...items].sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1)) }));
  }, [invoices, term, filter]);

  const list = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  return (
    <div className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title">Invoices</h1>
          <p className="page-sub">Find any bill — search by invoice no, customer, phone or date</p>
        </div>
        <Button onClick={() => navigate('/billing')}>
          <Plus size={17} /> New Bill
        </Button>
      </div>

      <Card>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <SearchInput value={term} onChange={setTerm} placeholder="Search invoice no, customer, phone, date…" />
          </div>
          <div className="chips">
            {FILTERS.map((f) => (
              <button key={f.key} className={`chip${filter === f.key ? ' active' : ''}`} onClick={() => setFilter(f.key)}>
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {list.length === 0 ? (
          <EmptyState
            icon={<FileText size={24} />}
            title={term || filter !== 'all' ? 'No invoices match' : 'No invoices yet'}
            text={term || filter !== 'all' ? 'Try a different search or filter.' : 'Create your first bill — it takes seconds.'}
            action={!term && filter === 'all' ? <Button onClick={() => navigate('/billing')}><Plus size={16} /> Create Bill</Button> : undefined}
          />
        ) : (
          <div className="table-wrap">
            <table className="tbl stack-cards">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Customer</th>
                  <th>Date</th>
                  <th className="num">Total</th>
                  <th className="num">Paid</th>
                  <th className="num">Balance</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <GroupRows key={g.date} date={g.date} items={g.items} onOpen={(id) => navigate(`/invoices/${id}`)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/** A "Bill Date" group header row followed by its invoices. */
function GroupRows({ date, items, onOpen }: { date: string; items: Invoice[]; onOpen: (id: string) => void }) {
  return (
    <>
      <tr className="date-group-row">
        <td colSpan={7}>
          <span className="date-group-title">{formatDateLong(date)}</span>
          <span className="date-group-count">{items.length} bill{items.length === 1 ? '' : 's'}</span>
        </td>
      </tr>
      {items.map((inv) => (
        <tr key={inv.id} className="clickable" onClick={() => onOpen(inv.id)}>
          <td data-label="Invoice" style={{ fontWeight: 700 }}>{inv.number}</td>
          <td data-label="Customer">
            <div style={{ fontWeight: 600 }}>{inv.customer.name}</div>
            <div style={{ color: 'var(--text-3)', fontSize: 12.5 }}>{inv.customer.phone}</div>
          </td>
          <td data-label="Date">{formatDate(inv.date)}</td>
          <td className="num" data-label="Total">{formatINR(inv.total)}</td>
          <td className="num" data-label="Paid" style={{ color: 'var(--green)' }}>{formatINR(inv.paid)}</td>
          <td className="num" data-label="Balance" style={{ color: inv.balance > 0 ? 'var(--red)' : 'var(--green)', fontWeight: 700 }}>{formatINR(inv.balance)}</td>
          <td data-label="Status"><StatusBadge status={inv.status} /></td>
        </tr>
      ))}
    </>
  );
}
