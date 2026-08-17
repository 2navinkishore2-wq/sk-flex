import type { Invoice, Payment } from '../lib/types';
import { calcBalance, invoiceStatus, parseInvoiceNumber } from '../lib/billing';
import { nowISO } from '../lib/format';
import { round2, sub } from '../lib/money';
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
}

/**
 * Record money received from a customer. Payments are CUSTOMER-level — they
 * never require selecting an invoice and are NEVER limited by an invoice's
 * balance:
 *
 *  - The FULL amount entered is stored in the payments collection and the
 *    ledger (payment date kept separate from any invoice date).
 *  - The payment is then allocated across the customer's outstanding invoices
 *    (oldest first) so each invoice shows an accurate paid/balance.
 *  - Anything above the total outstanding stays as customer credit / advance:
 *    the ledger running balance simply goes negative, and that credit is
 *    automatically applied to the next invoice created for the customer.
 */
export async function recordPayment(svc: DataService, customerId: string, input: PaymentInput): Promise<void> {
  const amount = round2(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter a valid payment amount.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date || '')) throw new Error('Enter a valid Payment Date.');

  const ts = nowISO();

  // Full payment record — the exact amount the customer actually paid.
  await svc.add('payments', {
    customerId,
    invoiceId: input.invoiceId || '',
    invoiceNumber: '',
    amount,
    date: input.date,
    method: input.method,
    note: input.note,
    createdAt: ts
  });

  await addLedgerEntry(svc, {
    customerId,
    type: 'payment',
    date: ts,
    paymentDate: input.date,
    description: `Payment received${input.method && input.method !== 'Cash' ? ` (${input.method})` : ''}`,
    invoiceId: input.invoiceId || '',
    invoiceNumber: '',
    amount: -amount
  });

  // Allocate across the customer's outstanding invoices, oldest first. Fetch
  // the freshest docs (the passed snapshot may be stale when payments are
  // recorded in quick succession) using the watched query shape so it also
  // works offline.
  const all = await svc.query<Invoice>('invoices', { orderBy: { field: 'createdAt', dir: 'desc' } });
  const outstanding = all
    .filter((i) => i.customerId === customerId && i.balance > 0)
    // Oldest first: recording time, then the sequential invoice number (two
    // invoices created in the same millisecond have an identical createdAt), then id.
    .sort((a, b) => {
      if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
      const na = parseInvoiceNumber('', a.number);
      const nb = parseInvoiceNumber('', b.number);
      if (na !== nb) return na < nb ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    });

  let remaining = amount;
  for (const inv of outstanding) {
    if (remaining <= 0) break;
    const alloc = round2(Math.min(remaining, inv.balance));
    if (alloc <= 0) continue;
    const newPaid = round2(inv.paid + alloc);
    const newBalance = calcBalance(inv.total, newPaid);
    const newStatus = invoiceStatus(inv.total, newPaid);
    await svc.set('invoices', inv.id, {
      paid: newPaid,
      balance: newBalance,
      status: newStatus,
      updatedAt: ts
    });
    remaining = round2(sub(remaining, alloc));
  }
  // Anything left over is customer credit — it lives in the ledger's running
  // balance and is applied automatically to the customer's next invoice.
}


export function customerPayments(payments: Payment[], customerId: string): Payment[] {
  return payments.filter((p) => p.customerId === customerId).sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
}
