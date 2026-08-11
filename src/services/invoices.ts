import type { Invoice, InvoiceDraft, InvoiceStatus, PaymentDraft } from '../lib/types';
import { calcBalance, invoiceStatus, invoiceTotals } from '../lib/billing';
import { nowISO, todayISO } from '../lib/format';
import { round2, sub, sum } from '../lib/money';
import type { DataService } from './data';
import { addLedgerEntry } from './ledger';

/**
 * Normalize draft payments: an explicit list wins; otherwise the legacy
 * single `paid` amount becomes one cash payment on the Bill Date.
 */
function normalizePayments(draft: InvoiceDraft): PaymentDraft[] {
  if (draft.payments && draft.payments.length > 0) {
    return draft.payments.map((p) => ({
      amount: round2(Math.max(0, p.amount)),
      date: p.date || draft.date,
      method: p.method || 'Cash',
      note: p.note || ''
    }));
  }
  if (draft.paid > 0) {
    return [{ amount: round2(draft.paid), date: draft.date, method: 'Cash', note: 'Payment at billing time' }];
  }
  return [];
}

export function computeInvoiceTotals(draft: InvoiceDraft) {
  const { subtotal, discount, total } = invoiceTotals(draft.items, draft.discountType, draft.discountValue);
  const paid = round2(Math.min(Math.max(0, draft.paid), total));
  const balance = calcBalance(total, paid);
  const status: InvoiceStatus = invoiceStatus(total, paid);
  return { subtotal, discount, total, paid, balance, status };
}

export interface SavedInvoice {
  invoice: Invoice;
}

/** Validate a draft before saving. Returns a friendly message or null. */
export function validateInvoiceDraft(draft: InvoiceDraft): string | null {
  if (!draft.customerId || !draft.customer.name) return 'Select a customer.';
  if (draft.items.length === 0) return 'Add at least one item.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date || '')) return 'Enter a valid Bill Date.';
  for (const item of draft.items) {
    if (!item.label) return 'Every item needs a name.';
    if (!Number.isFinite(item.rate) || item.rate < 0) return `Invalid rate for "${item.label}".`;
    if (!Number.isFinite(item.qty) || item.qty <= 0) return `Invalid quantity for "${item.label}".`;
    if (item.product === 'CUSTOM' && !item.note?.trim() && !item.label.trim()) return 'Enter the custom item name.';
    if (item.amount < 0) return `Invalid amount for "${item.label}".`;
  }
  for (const p of draft.payments || []) {
    if (!Number.isFinite(p.amount) || p.amount <= 0) return 'Every payment needs a valid amount.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date || '')) return 'Every payment needs a valid Payment Date.';
  }
  return null;
}

/** Create a new invoice + ledger entries (invoice debit, optional payments). */
export async function createInvoice(svc: DataService, draft: InvoiceDraft): Promise<Invoice> {
  const err = validateInvoiceDraft(draft);
  if (err) throw new Error(err);
  const billDate = draft.date || todayISO();
  const payments = normalizePayments(draft);
  const paidTotal = round2(sum(payments.map((p) => p.amount)));
  const t = computeInvoiceTotals({ ...draft, paid: paidTotal, date: billDate });
  const prefix = await getInvoicePrefix(svc);
  const number = await svc.nextInvoiceNumber(prefix);
  const createdAt = nowISO();
  const id = await svc.add('invoices', {
    number,
    date: billDate,
    customerId: draft.customerId,
    customer: draft.customer,
    items: draft.items,
    subtotal: t.subtotal,
    discountType: draft.discountType,
    discountValue: draft.discountValue,
    discount: t.discount,
    total: t.total,
    paid: t.paid,
    balance: t.balance,
    status: t.status,
    note: draft.note || '',
    version: 1,
    createdAt,
    updatedAt: createdAt
  });

  // Ledger: invoice debit (+total)
  await addLedgerEntry(svc, {
    customerId: draft.customerId,
    type: 'invoice',
    date: createdAt,
    description: `Invoice ${number}`,
    invoiceId: id,
    invoiceNumber: number,
    amount: t.total
  });
  // Payments: one ledger entry + one payment record each, with its own
  // Payment Date (may differ from the Bill Date).
  for (const p of payments) {
    await addLedgerEntry(svc, {
      customerId: draft.customerId,
      type: 'payment',
      date: createdAt,
      paymentDate: p.date,
      description: `Payment received — Invoice ${number}${p.method && p.method !== 'Cash' ? ` (${p.method})` : ''}`,
      invoiceId: id,
      invoiceNumber: number,
      amount: -p.amount
    });
    await svc.add('payments', {
      customerId: draft.customerId,
      invoiceId: id,
      invoiceNumber: number,
      amount: p.amount,
      date: p.date,
      method: p.method,
      note: p.note || '',
      createdAt
    });
  }

  return {
    id,
    number,
    date: billDate,
    customerId: draft.customerId,
    customer: draft.customer,
    items: draft.items,
    subtotal: t.subtotal,
    discountType: draft.discountType,
    discountValue: draft.discountValue,
    discount: t.discount,
    total: t.total,
    paid: t.paid,
    balance: t.balance,
    status: t.status,
    note: draft.note,
    version: 1,
    createdAt,
    updatedAt: createdAt
  };
}

/**
 * Update an existing invoice. Keeps the original number. Writes ONE ledger
 * adjustment entry with the net balance delta so the running balance stays
 * correct, and records any additional payment in the payments collection.
 */
export async function updateInvoice(svc: DataService, invoice: Invoice, draft: InvoiceDraft): Promise<Invoice> {
  const err = validateInvoiceDraft(draft);
  if (err) throw new Error(err);
  const t = computeInvoiceTotals(draft);
  const updatedAt = nowISO();

  await svc.set('invoices', invoice.id, {
    date: draft.date,
    customerId: draft.customerId,
    customer: draft.customer,
    items: draft.items,
    subtotal: t.subtotal,
    discountType: draft.discountType,
    discountValue: draft.discountValue,
    discount: t.discount,
    total: t.total,
    paid: t.paid,
    balance: t.balance,
    status: t.status,
    note: draft.note || '',
    version: (invoice.version || 1) + 1,
    updatedAt
  });

  const oldNet = round2(sub(invoice.total, invoice.paid));
  const newNet = round2(sub(t.total, t.paid));
  const delta = round2(sub(newNet, oldNet));
  if (delta !== 0) {
    await addLedgerEntry(svc, {
      customerId: draft.customerId,
      type: 'adjustment',
      date: updatedAt,
      description: `Invoice ${invoice.number} edited (balance ${delta > 0 ? 'increased' : 'reduced'} by ${Math.abs(delta).toFixed(2)})`,
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      amount: delta
    });
  }
  if (t.paid > invoice.paid) {
    const extraPaid = round2(sub(t.paid, invoice.paid));
    await svc.add('payments', {
      customerId: draft.customerId,
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      amount: extraPaid,
      date: draft.date,
      method: 'Cash',
      note: 'Additional payment at invoice edit',
      createdAt: updatedAt
    });
  }

  return {
    ...invoice,
    ...draft,
    items: draft.items,
    subtotal: t.subtotal,
    discount: t.discount,
    discountValue: draft.discountValue,
    discountType: draft.discountType,
    total: t.total,
    paid: t.paid,
    balance: t.balance,
    status: t.status,
    version: (invoice.version || 1) + 1,
    updatedAt
  };
}

async function getInvoicePrefix(svc: DataService): Promise<string> {
  // Use a query (not getDoc): the app watches the settings collection on
  // load, so this query target is cached even when the business doc was never
  // created — getDoc of a missing doc would fail while offline.
  const settings = await svc.query<{ id: string; invoicePrefix?: string }>('settings');
  return settings.find((s) => s.id === 'business')?.invoicePrefix || 'SK';
}

/** Aggregate outstanding across all invoices (fallback if ledger unavailable). */
export function totalOutstanding(invoices: Invoice[]): number {
  return round2(invoices.reduce((acc, inv) => acc + Math.max(0, inv.balance), 0));
}

export function searchInvoices(
  invoices: Invoice[],
  term: string,
  statusFilter: 'all' | InvoiceStatus
): Invoice[] {
  let list = invoices;
  if (statusFilter !== 'all') list = list.filter((i) => i.status === statusFilter);
  const t = term.trim().toLowerCase();
  if (!t) return list;
  return list.filter(
    (i) =>
      i.number.toLowerCase().includes(t) ||
      i.customer.name.toLowerCase().includes(t) ||
      i.customer.phone.replace(/\s/g, '').includes(t.replace(/\s/g, '')) ||
      (i.date || '').includes(t)
  );
}
