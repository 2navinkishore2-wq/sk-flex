import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Plus, Pencil, Trash2 } from 'lucide-react';
import { useApp } from '../store/AppContext';
import type { Customer } from '../lib/types';
import { createCustomer, deleteCustomer, searchCustomers, updateCustomer, type CustomerInput } from '../services/customers';
import { diagLog } from '../lib/diagnostics';
import { Button, Card, ConfirmDialog, EmptyState, Field, Modal, SearchInput, useToast } from '../components/ui';
import { formatDate } from '../lib/format';

const emptyInput: CustomerInput = { name: '', phone: '', address: '', email: '' };

export function CustomersPage() {
  const { customers, invoices, service } = useApp();
  const navigate = useNavigate();
  const toast = useToast();

  const [term, setTerm] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [input, setInput] = useState<CustomerInput>(emptyInput);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<Customer | null>(null);
  const [busy, setBusy] = useState(false);

  const list = useMemo(() => searchCustomers(customers, term), [customers, term]);

  const invoiceCount = (id: string) => invoices.filter((i) => i.customerId === id).length;

  const openAdd = () => {
    setEditing(null);
    setInput(emptyInput);
    setError('');
    setModalOpen(true);
  };

  const openEdit = (c: Customer) => {
    setEditing(c);
    setInput({ name: c.name, phone: c.phone, address: c.address, email: c.email });
    setError('');
    setModalOpen(true);
  };

  const save = async () => {
    setBusy(true);
    setError('');
    // TEMP-DIAG: save start/end markers for the white-screen investigation.
    diagLog('save.customer.start', { editing: !!editing });
    try {
      if (editing) {
        await updateCustomer(service, editing.id, input);
        toast('Customer updated', 'success');
      } else {
        await createCustomer(service, input);
        toast('Customer added', 'success');
      }
      setModalOpen(false);
      diagLog('save.customer.done', { editing: !!editing });
    } catch (e) {
      diagLog('save.customer.error', { message: (e as Error).message });
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    if (invoiceCount(deleting.id) > 0) {
      toast('This customer has invoices. Delete the invoices first, or keep the customer.', 'warn');
      setDeleting(null);
      return;
    }
    await deleteCustomer(service, deleting.id);
    toast('Customer deleted', 'info');
    setDeleting(null);
  };

  return (
    <div className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title">Customers</h1>
          <p className="page-sub">{customers.length} customer{customers.length === 1 ? '' : 's'}</p>
        </div>
        <Button onClick={openAdd}>
          <Plus size={17} /> Add Customer
        </Button>
      </div>

      <Card>
        <div style={{ marginBottom: 14 }}>
          <SearchInput value={term} onChange={setTerm} placeholder="Search by name or phone…" />
        </div>

        {list.length === 0 ? (
          <EmptyState
            icon={<Users size={24} />}
            title={term ? 'No customers match' : 'No customers yet'}
            text={term ? 'Try a different name or phone number.' : 'Add a customer to start billing them.'}
            action={!term ? <Button onClick={openAdd}><Plus size={16} /> Add Customer</Button> : undefined}
          />
        ) : (
          <div className="table-wrap">
            <table className="tbl stack-cards">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Phone</th>
                  <th>Address</th>
                  <th className="num">Invoices</th>
                  <th>Added</th>
                  <th className="actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id} className="clickable" onClick={() => navigate(`/customers/${c.id}`)}>
                    <td data-label="Customer">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div className="avatar" style={{ background: 'var(--brand-100)', color: 'var(--brand-700)', width: 30, height: 30, fontSize: 12 }}>
                          {c.name.slice(0, 2).toUpperCase()}
                        </div>
                        <b>{c.name}</b>
                      </div>
                    </td>
                    <td data-label="Phone">{c.phone}</td>
                    <td data-label="Address" style={{ color: 'var(--text-2)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.address || '—'}
                    </td>
                    <td className="num" data-label="Invoices">{invoiceCount(c.id)}</td>
                    <td data-label="Added" style={{ color: 'var(--text-2)' }}>{formatDate(c.createdAt.slice(0, 10))}</td>
                    <td className="actions" onClick={(e) => e.stopPropagation()}>
                      <button className="icon-btn" style={{ marginRight: 6 }} onClick={() => openEdit(c)} title="Edit"><Pencil size={15} /></button>
                      <button className="icon-btn danger" onClick={() => setDeleting(c)} title="Delete"><Trash2 size={15} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={modalOpen} title={editing ? 'Edit Customer' : 'Add Customer'} onClose={() => setModalOpen(false)} width={460}>
        <Field label="Customer name *">
          <input className="input" value={input.name} onChange={(e) => setInput({ ...input, name: e.target.value })} placeholder="e.g. Ramesh" />
        </Field>
        <Field label="Phone number *">
          <input className="input" inputMode="tel" value={input.phone} onChange={(e) => setInput({ ...input, phone: e.target.value })} placeholder="e.g. 98765 43210" />
        </Field>
        <Field label="Address (optional)">
          <textarea className="textarea" value={input.address} onChange={(e) => setInput({ ...input, address: e.target.value })} placeholder="Shop / home address" />
        </Field>
        <Field label="Email (optional)">
          <input className="input" type="email" value={input.email} onChange={(e) => setInput({ ...input, email: e.target.value })} placeholder="name@example.com" />
        </Field>
        {error && <div className="form-error" style={{ marginBottom: 10 }}>{error}</div>}
        <Button block size="lg" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : editing ? 'Save Changes' : 'Add Customer'}
        </Button>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        title="Delete customer?"
        message={
          deleting
            ? `"${deleting.name}" will be removed. ${invoiceCount(deleting.id) > 0 ? `They have ${invoiceCount(deleting.id)} invoice(s) — delete those first.` : ''}`
            : ''
        }
        confirmLabel="Delete"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
