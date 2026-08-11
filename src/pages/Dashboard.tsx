import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { IndianRupee, FileText, Users, AlertCircle, Plus, ReceiptText, ChevronRight } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { formatINR, formatDate } from '../lib/format';
import { round2 } from '../lib/money';
import { todayISO } from '../lib/format';
import { totalOutstandingFromLedger } from '../services/ledger';
import { Card, EmptyState, StatCard, StatusBadge, Button, Row } from '../components/ui';

export function DashboardPage() {
  const { invoices, customers, ledger } = useApp();
  const navigate = useNavigate();
  const today = todayISO();

  const stats = useMemo(() => {
    const todayInvoices = invoices.filter((i) => i.date === today);
    const todaySales = round2(todayInvoices.reduce((a, i) => a + i.total, 0));
    // Outstanding = sum of each customer's current receivable from the ledger
    // (invoices − payments), computed from entry amounts so it is correct
    // regardless of snapshot ordering or stale balanceAfter values.
    const totalOutstanding = totalOutstandingFromLedger(ledger);
    const recentInvoices = [...invoices].sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1)).slice(0, 5);
    const recentCustomers = [...customers].sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1)).slice(0, 5);
    return { todaySales, todayBills: todayInvoices.length, totalCustomers: customers.length, totalOutstanding, recentInvoices, recentCustomers };
  }, [invoices, customers, ledger, today]);

  return (
    <div className="page">
      <h1 className="page-title">Dashboard</h1>
      <p className="page-sub">Overview of today's business</p>

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <StatCard label="Today's Sales" value={formatINR(stats.todaySales)} icon={<IndianRupee size={17} />} tone="blue" />
        <StatCard label="Today's Bills" value={String(stats.todayBills)} icon={<FileText size={17} />} tone="green" />
        <StatCard label="Total Customers" value={String(stats.totalCustomers)} icon={<Users size={17} />} tone="navy" />
        <StatCard label="Outstanding" value={formatINR(stats.totalOutstanding)} icon={<AlertCircle size={17} />} tone="red" />
      </div>

      <Row className="btn-wrap" style={{ marginBottom: 16 }}>
        <Button onClick={() => navigate('/billing')}>
          <Plus size={17} /> New Bill
        </Button>
        <Button variant="ghost" onClick={() => navigate('/customers')}>
          <Users size={17} /> Add Customer
        </Button>
      </Row>

      <div className="grid grid-2">
        <Card title="Recent Invoices" right={<Link to="/invoices" style={{ fontSize: 13 }}>View all</Link>}>
          {stats.recentInvoices.length === 0 ? (
            <EmptyState icon={<ReceiptText size={24} />} title="No invoices yet" text="Create your first bill from the Billing screen." />
          ) : (
            <div className="table-wrap">
              <table className="tbl">
                <tbody>
                  {stats.recentInvoices.map((inv) => (
                    <tr key={inv.id} className="clickable" onClick={() => navigate(`/invoices/${inv.id}`)}>
                      <td>
                        <div style={{ fontWeight: 700 }}>{inv.number}</div>
                        <div style={{ color: 'var(--text-3)', fontSize: 12.5 }}>{formatDate(inv.date)}</div>
                      </td>
                      <td style={{ fontWeight: 600 }}>{inv.customer.name}</td>
                      <td className="num" style={{ fontWeight: 700 }}>{formatINR(inv.total)}</td>
                      <td><StatusBadge status={inv.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Recent Customers" right={<Link to="/customers" style={{ fontSize: 13 }}>View all</Link>}>
          {stats.recentCustomers.length === 0 ? (
            <EmptyState icon={<Users size={24} />} title="No customers yet" text="Add your first customer to start billing." />
          ) : (
            <div>
              {stats.recentCustomers.map((c) => (
                <Link key={c.id} to={`/customers/${c.id}`} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 4px', borderBottom: '1px solid var(--border)', color: 'inherit' }}>
                  <div className="avatar" style={{ background: 'var(--brand-100)', color: 'var(--brand-700)' }}>
                    {c.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{c.name}</div>
                    <div style={{ color: 'var(--text-3)', fontSize: 12.5 }}>{c.phone}</div>
                  </div>
                  <ChevronRight size={17} color="var(--text-3)" />
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
