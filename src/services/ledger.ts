import type { LedgerEntry, LedgerType } from '../lib/types';
import { add, round2, sum } from '../lib/money';
import type { DataService } from './data';

export interface LedgerInput {
  customerId: string;
  type: LedgerType;
  date: string; // ISO datetime
  description: string;
  invoiceId?: string;
  invoiceNumber?: string;
  /** Payment Date (YYYY-MM-DD) for payment entries — when the cash was received. */
  paymentDate?: string;
  amount: number; // + increases customer balance, - reduces it
}

/**
 * Append a ledger entry. balanceAfter = previous running balance + amount.
 * Computed from the sum of all existing entries so it stays correct even
 * if entries are added sequentially (invoice entry then payment entry).
 */
export async function addLedgerEntry(svc: DataService, input: LedgerInput): Promise<LedgerEntry> {
  // Query the whole (user-scoped) ledger with no where clause: the query
  // target then matches the app's cached ledger watch and works offline.
  const all = await svc.query<LedgerEntry>('ledger');
  const existing = all.filter((e) => e.customerId === input.customerId);
  const running = round2(sum(existing.map((e) => e.amount)));
  const balanceAfter = round2(add(running, input.amount));
  const id = await svc.add('ledger', {
    customerId: input.customerId,
    type: input.type,
    date: input.date,
    paymentDate: input.paymentDate || '',
    description: input.description,
    invoiceId: input.invoiceId || '',
    invoiceNumber: input.invoiceNumber || '',
    amount: input.amount,
    balanceAfter
  });
  return {
    id,
    customerId: input.customerId,
    type: input.type,
    date: input.date,
    paymentDate: input.paymentDate,
    description: input.description,
    invoiceId: input.invoiceId,
    invoiceNumber: input.invoiceNumber,
    amount: input.amount,
    balanceAfter,
    createdAt: ''
  };
}

export interface CustomerLedgerStats {
  billed: number; // sum of invoice amounts
  paid: number; // sum of payment amounts (absolute)
  balance: number; // current outstanding
  invoiceCount: number;
}

/**
 * A customer's CURRENT balance = sum of every entry's amount for that
 * customer (invoice debits +, payments/adjustments −). This is equivalent to
 * the running `balanceAfter` of the latest entry by construction, but it is
 * INDEPENDENT of collection ordering — Firestore returns unordered snapshots
 * (document-id order), so relying on `entries[entries.length-1].balanceAfter`
 * showed an arbitrary historical balance (e.g. a figure stuck at ₹10,000
 * after a payment) instead of the true current receivable.
 */
export function customerBalance(entries: LedgerEntry[]): number {
  return round2(sum(entries.map((e) => Number(e.amount) || 0)));
}

export function ledgerStats(entries: LedgerEntry[]): CustomerLedgerStats {
  let billed = 0;
  let paid = 0;
  let invoiceCount = 0;
  for (const e of entries) {
    if (e.type === 'invoice') {
      billed = add(billed, e.amount);
      invoiceCount += 1;
    } else if (e.type === 'payment') {
      paid = add(paid, Math.abs(e.amount));
    }
  }
  const balance = customerBalance(entries);
  return { billed: round2(billed), paid: round2(paid), balance, invoiceCount };
}

/**
 * Total receivable across ALL customers — the sum of each customer's current
 * ledger balance, floored at 0 per customer (credit customers don't reduce
 * the total). Computed from entry amounts so the result is exact regardless
 * of snapshot ordering and immune to stale balanceAfter values.
 */
export function totalOutstandingFromLedger(entries: LedgerEntry[]): number {
  const perCustomer = new Map<string, number>();
  for (const e of entries) {
    perCustomer.set(e.customerId, add(perCustomer.get(e.customerId) ?? 0, Number(e.amount) || 0));
  }
  let total = 0;
  for (const bal of perCustomer.values()) total = add(total, Math.max(0, bal));
  return round2(total);
}

export function sortLedgerChronological(entries: LedgerEntry[]): LedgerEntry[] {
  return [...entries].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1));
}

export function sortLedgerNewest(entries: LedgerEntry[]): LedgerEntry[] {
  return [...entries].sort((a, b) => (a.createdAt > b.createdAt ? -1 : a.createdAt < b.createdAt ? 1 : 0));
}
