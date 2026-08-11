import type { Invoice, Payment } from '../lib/types';
import { calcBalance, invoiceStatus } from '../lib/billing';
import { nowISO } from '../lib/format';
import { round2 } from '../lib/money';
import type { DataService } from './data';
import { addLedgerEntry } from './ledger';

export interface PaymentInput {
  invoiceId: string;
  amount: number;
  date: string; // YYYY-MM-DD
  method: string;
  note: string;
}

/** Record a payment against an existing invoice. */
export async function recordPayment(svc: DataService, invoice: Invoice, input: PaymentInput): Promise<void> {
  const amount = round2(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter a valid payment amount.');
  // Use the freshest invoice doc: the passed snapshot may be stale when
  // multiple payments are recorded in quick succession (each payment must
  // build on the previous one's paid/balance, not overwrite it).
  const current = (await svc.get<Invoice>('invoices', invoice.id)) || invoice;
  const remaining = round2(Math.max(0, current.balance));
  if (amount > remaining + 0.01) {
    throw new Error(`Payment exceeds the balance due (₹${remaining.toFixed(2)}).`);
  }

  const newPaid = round2(current.paid + amount);
  const newBalance = calcBalance(current.total, newPaid);
  const newStatus = invoiceStatus(current.total, newPaid);
  const ts = nowISO();

  await svc.set('invoices', invoice.id, {
    paid: newPaid,
    balance: newBalance,
    status: newStatus,
    updatedAt: ts
  });

  await addLedgerEntry(svc, {
    customerId: invoice.customerId,
    type: 'payment',
    date: ts,
    paymentDate: input.date,
    description: `Payment received — Invoice ${invoice.number}${input.method && input.method !== 'Cash' ? ` (${input.method})` : ''}`,
    invoiceId: invoice.id,
    invoiceNumber: invoice.number,
    amount: -amount
  });

  await svc.add('payments', {
    customerId: invoice.customerId,
    invoiceId: invoice.id,
    invoiceNumber: invoice.number,
    amount,
    date: input.date,
    method: input.method,
    note: input.note,
    createdAt: ts
  });
}

export function customerPayments(payments: Payment[], customerId: string): Payment[] {
  return payments.filter((p) => p.customerId === customerId).sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
}
