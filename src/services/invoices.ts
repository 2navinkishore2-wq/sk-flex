import type { Invoice, InvoiceDraft, InvoiceStatus, LedgerEntry, Payment, PaymentDraft } from '../lib/types';
import { calcBalance, invoiceStatus, invoiceTotals } from '../lib/billing';
import { nowISO, todayISO } from '../lib/format';
import { add, round2, sub, sum } from '../lib/money';
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

/** Validate a draft before saving. Returns a friendly message or null. */
export function validateInvoiceDraft(draft: InvoiceDraft): string | null {
  if (!draft.customerId || !draft.customer.name) return 'Select a customer.';
  if (draft.items.length === 0) return 'Add at least one item.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date || '')) return 'Enter a valid Bill Date.';
  // A discount larger than the bill, or a percentage above 100, is never valid
  // input — it would silently floor the total at ₹0 and hide the mistake.
  const dv = Number(draft.discountValue) || 0;
  if (!Number.isFinite(dv) || dv < 0) return 'Enter a valid discount.';
  if (draft.discountType === 'percent' && dv > 100) return 'Percentage discount cannot be more than 100%.';
  if (draft.discountType === 'amount' && dv > round2(sum(draft.items.map((i) => i.amount)))) {
    return 'Discount cannot be more than the bill subtotal.';
  }
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

/**
 * The customer's current advance/credit balance (₹): how much of the money
 * they have paid is not yet covered by invoices. Derived from the ledger
 * (sum of all entries) — when the running balance is negative the customer is
 * ahead, and that credit automatically covers the next invoice.
 */
async function availableCredit(svc: DataService, customerId: string): Promise<number> {
  const all = await svc.query<LedgerEntry>('ledger');
  const balance = round2(
    sum(all.filter((e) => e.customerId === customerId).map((e) => Number(e.amount) || 0))
  );
  return round2(Math.max(0, -balance));
}

/** Payment records attached to one invoice (full list fetch = offline-safe). */
async function invoicePaymentRecords(svc: DataService, invoiceId: string): Promise<Payment[]> {
  const all = await svc.query<Payment>('payments', { orderBy: { field: 'createdAt', dir: 'desc' } });
  return all.filter((p) => p.invoiceId === invoiceId);
}

/**
 * Invoice settlement state: paid = billing-time cash + credit applied, capped
 * at the total (anything beyond becomes customer credit in the ledger).
 */
function settleInvoice(total: number, cashPaid: number, creditApplied: number): { paid: number; balance: number; status: InvoiceStatus } {
  const paid = round2(Math.min(Math.max(0, total), add(Math.max(0, cashPaid), Math.max(0, creditApplied))));
  const balance = calcBalance(total, paid);
  const status = invoiceStatus(total, paid);
  return { paid, balance, status };
}

/** Create a new invoice + ledger entries (invoice debit, optional payments).
 *
 * If the customer already has advance/credit (an earlier overpayment), that
 * credit is automatically applied to this invoice first: the invoice's `paid`
 * includes the applied credit, so the remaining balance is total − credit −
 * cash received at billing. The ledger only records the invoice's full total
 * and the actual cash payments — the credit itself is the customer's existing
 * (negative) running balance, so it carries forward naturally and is never
 * double-counted.
 */
export async function createInvoice(svc: DataService, draft: InvoiceDraft): Promise<Invoice> {
  const err = validateInvoiceDraft(draft);
  if (err) throw new Error(err);
  const billDate = draft.date || todayISO();
  const payments = normalizePayments(draft);
  const cashPaid = round2(sum(payments.map((p) => p.amount)));
  const t = invoiceTotals(draft.items, draft.discountType, draft.discountValue);
  const credit = await availableCredit(svc, draft.customerId);
  const creditApplied = round2(Math.min(credit, Math.max(0, sub(t.total, cashPaid))));
  const { paid, balance, status } = settleInvoice(t.total, cashPaid, creditApplied);
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
    paid,
    balance,
    status,
    creditApplied: creditApplied > 0 ? creditApplied : 0,
    note: draft.note || '',
    version: 1,
    createdAt,
    updatedAt: createdAt
  });

  // The bill and its ledger rows are one unit: if the ledger cannot be
  // written, the whole save is rolled back so a bill never exists without its
  // ledger entry (which would silently understate the customer's balance).
  const ledgerIds: string[] = [];
  const paymentIds: string[] = [];
  try {
    // Ledger: invoice debit (+total)
    const invEntry = await addLedgerEntry(svc, {
      customerId: draft.customerId,
      type: 'invoice',
      date: createdAt,
      description: `Invoice ${number}`,
      invoiceId: id,
      invoiceNumber: number,
      amount: t.total
    });
    ledgerIds.push(invEntry.id);
    // Payments: one ledger entry + one payment record each, with its own
    // Payment Date (may differ from the Bill Date).
    for (const p of payments) {
      const payEntry = await addLedgerEntry(svc, {
        customerId: draft.customerId,
        type: 'payment',
        date: createdAt,
        paymentDate: p.date,
        description: `Payment received — Invoice ${number}${p.method && p.method !== 'Cash' ? ` (${p.method})` : ''}`,
        invoiceId: id,
        invoiceNumber: number,
        amount: -p.amount
      });
      ledgerIds.push(payEntry.id);
      paymentIds.push(
        await svc.add('payments', {
          customerId: draft.customerId,
          invoiceId: id,
          invoiceNumber: number,
          amount: p.amount,
          date: p.date,
          method: p.method,
          note: p.note || '',
          createdAt
        })
      );
    }
  } catch (e) {
    for (const pid of paymentIds) await svc.delete('payments', pid).catch(() => undefined);
    for (const lid of ledgerIds) await svc.delete('ledger', lid).catch(() => undefined);
    await svc.delete('invoices', id).catch(() => undefined);
    throw new Error(
      `The bill was not saved because the customer ledger could not be updated (${(e as Error).message}). Nothing was changed — please retry.`
    );
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
    paid,
    balance,
    status,
    creditApplied: creditApplied > 0 ? creditApplied : 0,
    note: draft.note,
    version: 1,
    createdAt,
    updatedAt: createdAt
  };
}

/**
 * Delete an invoice AND the rows that belong to it: its ledger entries and its
 * billing-time payment records. Customer-level payments (received from the
 * customer against the account, invoiceId '') are never touched — that money
 * really was received and must keep counting in the customer's balance.
 *
 * The invoice document is removed last, so a failure part-way leaves the bill
 * visible rather than orphaning its money rows.
 */
export async function deleteInvoice(svc: DataService, invoice: Invoice): Promise<void> {
  const ledger = await svc.query<LedgerEntry>('ledger');
  for (const e of ledger.filter((x) => x.invoiceId === invoice.id)) {
    await svc.delete('ledger', e.id);
  }
  const payments = await svc.query<Payment>('payments');
  for (const p of payments.filter((x) => x.invoiceId === invoice.id)) {
    await svc.delete('payments', p.id);
  }
  await svc.delete('invoices', invoice.id);
}

/**
 * Update an existing invoice. Keeps the original number and behaves as if the
 * original invoice value was corrected:
 *
 *  - The invoice's ledger entry is UPDATED IN PLACE to the new total (no
 *    separate "Invoice X edited…" adjustment entry), so the customer statement
 *    shows only the FINAL invoice value and never internal edit rows.
 *  - Billing-time cash payment records (and their ledger entries) are
 *    reconciled to the draft: removed rows are deleted, new rows added, with
 *    each keeping its own Payment Date.
 *  - Payments previously allocated to this invoice from a customer-level
 *    "Receive Payment" are preserved, as is the credit applied at creation.
 *
 * The running balance shown to users is always recomputed from the ledger, so
 * the in-place rewrite never leaves a stale balance visible.
 */
export async function updateInvoice(svc: DataService, invoice: Invoice, draft: InvoiceDraft): Promise<Invoice> {
  const err = validateInvoiceDraft(draft);
  if (err) throw new Error(err);
  const billDate = draft.date || todayISO();
  const payments = normalizePayments(draft);
  const cashPaidNew = round2(sum(payments.map((p) => p.amount)));
  const t = invoiceTotals(draft.items, draft.discountType, draft.discountValue);
  const updatedAt = nowISO();

  // Use the freshest invoice doc: the passed snapshot may be stale (e.g. a
  // payment was recorded after the page loaded), so the paid/credit
  // decomposition below must never be built on old values.
  const current = (await svc.get<Invoice>('invoices', invoice.id)) || invoice;

  // Decompose the invoice's current paid: billing-time cash records + credit
  // applied at creation + cash allocated from customer-level payments.
  const oldRecords = await invoicePaymentRecords(svc, invoice.id);
  const billingCashOld = round2(sum(oldRecords.map((p) => p.amount)));
  const creditOld = Math.max(0, current.creditApplied || 0);
  const allocatedCashOld = round2(Math.max(0, sub(current.paid, add(billingCashOld, creditOld))));
  // Keep the previously applied credit (clamped to what the new total can use).
  const creditApplied = round2(Math.min(creditOld, Math.max(0, sub(t.total, add(allocatedCashOld, cashPaidNew)))));
  const { paid, balance, status } = settleInvoice(t.total, add(allocatedCashOld, cashPaidNew), creditOld);

  await svc.set('invoices', invoice.id, {
    date: billDate,
    customerId: draft.customerId,
    customer: draft.customer,
    items: draft.items,
    subtotal: t.subtotal,
    discountType: draft.discountType,
    discountValue: draft.discountValue,
    discount: t.discount,
    total: t.total,
    paid,
    balance,
    status,
    creditApplied,
    note: draft.note || '',
    version: (invoice.version || 1) + 1,
    updatedAt
  });

  // Rewrite the invoice's ledger entry to the corrected total — never an
  // "edited" adjustment row.
  const allLedger = await svc.query<LedgerEntry>('ledger');
  const invEntry = allLedger.find((e) => e.invoiceId === invoice.id && e.type === 'invoice');
  if (invEntry) {
    await svc.set('ledger', invEntry.id, {
      amount: t.total,
      description: `Invoice ${invoice.number}`,
      updatedAt
    });
  } else {
    // Safety net for legacy invoices without a ledger entry.
    await addLedgerEntry(svc, {
      customerId: draft.customerId,
      type: 'invoice',
      date: updatedAt,
      description: `Invoice ${invoice.number}`,
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      amount: t.total
    });
  }

  // Reconcile billing-time payment records + their ledger entries to the draft.
  const oldLedgerPayments = allLedger.filter((e) => e.invoiceId === invoice.id && e.type === 'payment');
  for (const e of oldLedgerPayments) await svc.delete('ledger', e.id);
  for (const p of oldRecords) await svc.delete('payments', p.id);
  for (const p of payments) {
    await addLedgerEntry(svc, {
      customerId: draft.customerId,
      type: 'payment',
      date: updatedAt,
      paymentDate: p.date,
      description: `Payment received — Invoice ${invoice.number}${p.method && p.method !== 'Cash' ? ` (${p.method})` : ''}`,
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      amount: -p.amount
    });
    await svc.add('payments', {
      customerId: draft.customerId,
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      amount: p.amount,
      date: p.date,
      method: p.method,
      note: p.note || '',
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
    paid,
    balance,
    status,
    creditApplied,
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
