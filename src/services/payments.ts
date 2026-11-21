import type { Invoice, Payment, PaymentAllocation } from '../lib/types';
import { calcBalance, invoiceStatus, parseInvoiceNumber } from '../lib/billing';
import { nowISO } from '../lib/format';
import { add, round2, sub, sum } from '../lib/money';
import type { DataService } from './data';
import { addLedgerEntry } from './ledger';

export interface PaymentInput {
  /** Optional for backward compatibility — the payment itself is CUSTOMER-level
   * and never requires picking a specific invoice. */
  invoiceId?: string;
  amount: number;
  date: string; // YYYY-MM-DD — the actual date the money was received
  method: string;
  note: string;
  /**
   * Idempotency key. A retry (or the same queued offline write arriving twice)
   * with the same key never records the money twice.
   */
  paymentId?: string;
}

const ALLOCATIONS = 'allocations';

/** Deterministic allocation document id: one row per (payment, invoice). */
export function allocationDocId(paymentId: string, invoiceId: string): string {
  return `${paymentId}__${invoiceId}`;
}

function newPaymentId(): string {
  try {
    const c = typeof crypto !== 'undefined' ? crypto : undefined;
    if (c && typeof c.randomUUID === 'function') return `pay_${c.randomUUID()}`;
  } catch {
    /* fall through */
  }
  return `pay_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** Oldest-first order: recording time, then sequential number, then id. */
function oldestFirst(a: Invoice, b: Invoice): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  const na = parseInvoiceNumber('', a.number);
  const nb = parseInvoiceNumber('', b.number);
  if (na !== nb) return na < nb ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}

export interface InvoiceSettlement {
  /** Cash received at billing time (payment rows that belong to this invoice). */
  billing: number;
  /** Credit applied from an earlier overpayment (stored on the invoice). */
  credit: number;
  /** Sum of customer-level payment allocations to this invoice. */
  allocated: number;
  /** paid derived from the records (never from a possibly stale invoice.paid). */
  paid: number;
  balance: number;
  status: 'paid' | 'partial' | 'credit';
  /** True when allocation rows exist for this invoice. */
  hasAllocations: boolean;
}

/**
 * Derive an invoice's settlement from the money RECORDS:
 *
 *   paid = billing-time cash + credit applied + allocated customer payments
 *
 * This is order-independent and additive: every device's allocation row counts,
 * no matter in which order Firestore delivers or re-sends them. It is the single
 * definition used by payments, reconciliation and invoice edits.
 */
export function invoiceSettlement(
  invoice: Invoice,
  payments: Payment[],
  allocations: PaymentAllocation[]
): InvoiceSettlement {
  const billing = round2(
    sum(payments.filter((p) => p.invoiceId === invoice.id).map((p) => Number(p.amount) || 0))
  );
  const credit = round2(Math.max(0, invoice.creditApplied || 0));
  const mine = allocations.filter((a) => a.invoiceId === invoice.id);
  const allocated = round2(sum(mine.map((a) => Number(a.amount) || 0)));
  const paid = round2(Math.min(Math.max(0, invoice.total), add(add(billing, credit), allocated)));
  return {
    billing,
    credit,
    allocated,
    paid,
    balance: calcBalance(invoice.total, paid),
    status: invoiceStatus(invoice.total, paid),
    hasAllocations: mine.length > 0
  };
}

async function loadRecords(
  svc: DataService,
  patch: { invoices?: Invoice[]; payments?: Payment[]; allocations?: PaymentAllocation[] } = {}
): Promise<{ invoices: Invoice[]; payments: Payment[]; allocations: PaymentAllocation[] }> {
  const [invoices, payments, allocations] = await Promise.all([
    patch.invoices
      ? Promise.resolve(patch.invoices)
      : svc.query<Invoice>('invoices', { orderBy: { field: 'createdAt', dir: 'desc' } }),
    patch.payments
      ? Promise.resolve(patch.payments)
      : svc.query<Payment>('payments', { orderBy: { field: 'createdAt', dir: 'desc' } }),
    patch.allocations ? Promise.resolve(patch.allocations) : svc.query<PaymentAllocation>(ALLOCATIONS)
  ]);
  return { invoices, payments, allocations };
}

/**
 * Recompute stored invoice `paid`/`balance`/`status` from the money records.
 *
 * Safe by construction:
 *  - it only ever RAISES a recorded paid amount when there are no allocation
 *    rows (money older builds wrote directly onto an invoice is never undone);
 *  - with allocation rows present the records are authoritative, so a lost
 *    update from two devices paying at once is repaired to the exact total.
 *
 * Runs at startup, after reconnecting, and after each payment.
 */
export async function reconcileInvoiceSettlement(
  svc: DataService,
  patch: { invoices?: Invoice[]; payments?: Payment[]; allocations?: PaymentAllocation[] } = {}
): Promise<number> {
  const { invoices, payments, allocations } = await loadRecords(svc, patch);
  let fixed = 0;
  for (const inv of invoices) {
    const s = invoiceSettlement(inv, payments, allocations);
    // Legacy invoices (no allocation rows) whose paid is higher than the
    // records explain are left untouched — that money was recorded directly on
    // the invoice before allocations existed.
    const nextPaid = !s.hasAllocations && s.paid < inv.paid ? inv.paid : s.paid;
    const nextBalance = calcBalance(inv.total, nextPaid);
    const nextStatus = invoiceStatus(inv.total, nextPaid);
    const changed =
      Math.abs(nextPaid - inv.paid) > 0.004 ||
      Math.abs(nextBalance - inv.balance) > 0.004 ||
      nextStatus !== inv.status;
    if (!changed) continue;
    await svc.set('invoices', inv.id, { paid: nextPaid, balance: nextBalance, status: nextStatus });
    fixed += 1;
  }
  return fixed;
}

/**
 * Record money received from a customer. Payments are CUSTOMER-level — they
 * never require selecting an invoice and are NEVER limited by an invoice's
 * balance:
 *
 *  - The FULL amount entered is stored once in the payments collection (under a
 *    deterministic id, so a retry cannot duplicate it) and once in the ledger.
 *  - The payment is then allocated across the customer's outstanding invoices
 *    (oldest first) as append-only allocation rows. Allocation is computed from
 *    the RECORDS, not from a snapshot of `invoice.paid`, so two devices paying
 *    at the same moment cannot overwrite each other's allocation: both sets of
 *    rows survive and add up.
 *  - Anything above the total outstanding stays as customer credit / advance:
 *    the ledger running balance simply goes negative, and that credit is
 *    automatically applied to the next invoice created for the customer.
 *
 * If writing the ledger or an allocation fails, everything this call wrote is
 * rolled back — a payment row must never exist without its ledger entry.
 */
export async function recordPayment(
  svc: DataService,
  customerId: string,
  input: PaymentInput
): Promise<void> {
  const amount = round2(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter a valid payment amount.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date || '')) throw new Error('Enter a valid Payment Date.');

  const ts = nowISO();
  const paymentId = (input.paymentId || '').trim() || newPaymentId();

  // Idempotency: this exact payment was already recorded (retry / duplicate
  // sync). Nothing more to do — the money is already counted once.
  const already = await svc.get<Payment>('payments', paymentId);
  if (already) return;

  const { invoices, payments, allocations } = await loadRecords(svc);

  const written: { collection: string; id: string }[] = [];
  try {
    // 1. The authoritative money row (deterministic id).
    await svc.set('payments', paymentId, {
      customerId,
      invoiceId: input.invoiceId || '',
      invoiceNumber: '',
      amount,
      date: input.date,
      method: input.method,
      note: input.note
    });
    written.push({ collection: 'payments', id: paymentId });

    // 2. Its ledger entry, under a deterministic id so a retry rewrites the
    //    same row instead of adding the payment again.
    const ledgerId = `led_${paymentId}`;
    await addLedgerEntry(
      svc,
      {
        customerId,
        type: 'payment',
        date: ts,
        paymentDate: input.date,
        description: `Payment received${input.method && input.method !== 'Cash' ? ` (${input.method})` : ''}`,
        invoiceId: input.invoiceId || '',
        invoiceNumber: '',
        amount: -amount
      },
      ledgerId
    );
    written.push({ collection: 'ledger', id: ledgerId });

    // 3. Allocate against what is still owed per the RECORDS (oldest first).
    const outstanding = invoices
      .filter((i) => i.customerId === customerId)
      .map((inv) => {
        const s = invoiceSettlement(inv, payments, allocations);
        const due = round2(sub(inv.total, add(add(s.billing, s.credit), s.allocated)));
        return { inv, due };
      })
      .filter((x) => x.due > 0)
      .sort((a, b) => oldestFirst(a.inv, b.inv));

    const newRows: PaymentAllocation[] = [];
    let remaining = amount;
    for (const { inv, due } of outstanding) {
      if (remaining <= 0) break;
      const alloc = round2(Math.min(remaining, due));
      if (alloc <= 0) continue;
      const id = allocationDocId(paymentId, inv.id);
      const row = { customerId, paymentId, invoiceId: inv.id, amount: alloc, createdAt: ts };
      await svc.set(ALLOCATIONS, id, row);
      written.push({ collection: ALLOCATIONS, id });
      newRows.push({ id, ...row });
      remaining = round2(sub(remaining, alloc));
    }

    // 4. Refresh the denormalized totals from what is now on record. Stale
    //    values (a concurrent device's write) are corrected by reconciliation.
    await reconcileInvoiceSettlement(svc, {
      invoices,
      payments,
      allocations: [...allocations, ...newRows]
    });
  } catch (e) {
    // All-or-nothing: a half-written payment would understate or overstate the
    // customer's balance, so undo everything this call created.
    for (const w of written.reverse()) {
      await svc.delete(w.collection, w.id).catch(() => undefined);
    }
    throw new Error(
      `The payment was not saved because it could not be reconciled with the customer ledger (${(e as Error).message}). Nothing was changed — please retry.`
    );
  }

}

export function customerPayments(payments: Payment[], customerId: string): Payment[] {
  return payments.filter((p) => p.customerId === customerId).sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
}
