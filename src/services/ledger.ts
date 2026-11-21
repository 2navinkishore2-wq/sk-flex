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
 *
 * Pass `id` for an idempotent entry: a retried write (same payment, same id)
 * overwrites the same document instead of appending a second money row.
 */
export async function addLedgerEntry(svc: DataService, input: LedgerInput, id?: string): Promise<LedgerEntry> {
  // Query the whole (user-scoped) ledger with no where clause: the query
  // target then matches the app's cached ledger watch and works offline.
  const all = await svc.query<LedgerEntry>('ledger');
  const existing = all.filter((e) => e.customerId === input.customerId);
  const running = round2(sum(existing.map((e) => e.amount)));
  const balanceAfter = round2(add(running, input.amount));
  const entry = {
    customerId: input.customerId,
    type: input.type,
    date: input.date,
    paymentDate: input.paymentDate || '',
    description: input.description,
    invoiceId: input.invoiceId || '',
    invoiceNumber: input.invoiceNumber || '',
    amount: input.amount,
    balanceAfter
  };
  let entryId: string;
  if (id === undefined) {
    entryId = await svc.add('ledger', entry);
  } else {
    // Deterministic id: a retry lands on the same document (idempotent).
    entryId = id;
    await svc.set('ledger', entryId, entry);
  }
  return {
    id: entryId,
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

/**
 * Fold invoice-edit adjustment entries into their linked invoice entries so
 * the customer-facing statement / ledger show ONLY the corrected invoice
 * value — never separate "Invoice X edited (balance reduced/increased…)" rows.
 *
 * The invoice entry's amount becomes total + Σ(adjustments for that invoice),
 * and the adjustment entries themselves are dropped. This keeps the running
 * balance EXACTLY equal to the raw ledger sum (legacy adjustment rows still
 * count) while presenting a clean, human-readable account. Orphaned
 * adjustments (their invoice no longer exists anywhere in the ledger) are
 * kept as-is so no money silently disappears.
 *
 * New invoices/edits never create adjustment entries at all — this only
 * normalizes data written by the old edit flow.
 */
export function netAdjustments(entries: LedgerEntry[]): LedgerEntry[] {
  const adjByInvoice = new Map<string, number>();
  const nettedIds = new Set<string>();
  const invoiceIds = new Set<string>();
  for (const e of entries) {
    if (e.type === 'invoice' && e.invoiceId) invoiceIds.add(e.invoiceId);
  }
  for (const e of entries) {
    if (e.type !== 'adjustment' || !e.invoiceId) continue;
    if (!invoiceIds.has(e.invoiceId)) continue; // orphan — keep it visible
    nettedIds.add(e.id);
    adjByInvoice.set(e.invoiceId, round2(add(adjByInvoice.get(e.invoiceId) ?? 0, Number(e.amount) || 0)));
  }
  return entries
    .filter((e) => !nettedIds.has(e.id))
    .map((e) => {
      if (e.type !== 'invoice') return e;
      const adj = adjByInvoice.get(e.invoiceId || '');
      if (adj == null || adj === 0) return e;
      return { ...e, amount: round2(add(Number(e.amount) || 0, adj)) };
    });
}

/**
 * Recompute every entry's running balance in chronological order. In-place
 * invoice edits (which rewrite an entry's amount without appending a new one)
 * make stored `balanceAfter` values stale, so the ledger tab and statement
 * always recompute instead of trusting them.
 */
export function withRunningBalance(entries: LedgerEntry[]): LedgerEntry[] {
  let running = 0;
  return sortLedgerChronological(entries).map((e) => {
    running = round2(add(running, Number(e.amount) || 0));
    return { ...e, balanceAfter: running };
  });
}

export function sortLedgerNewest(entries: LedgerEntry[]): LedgerEntry[] {
  return [...entries].sort((a, b) => (a.createdAt > b.createdAt ? -1 : a.createdAt < b.createdAt ? 1 : 0));
}
