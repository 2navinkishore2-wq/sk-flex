import type { Customer, Invoice, InvoiceItem, LedgerEntry, Payment } from './types';
import { round2, add, sub, sum } from './money';
import { netAdjustments } from '../services/ledger';

export interface StatementItemLine {
  label: string;
  size: string;
  qty: number;
  rate: number;
  amount: number;
}

export interface StatementRow {
  key: string;
  /** Business date (YYYY-MM-DD) — the date the transaction BELONGS to: the
   * invoice's Bill Date for invoices, the Payment Date for payments. */
  date: string;
  type: 'invoice' | 'payment' | 'adjustment';
  description: string;
  invoiceNumber?: string;
  /** Increases the customer balance (invoice / adjustment-up). */
  debit: number;
  /** Decreases the customer balance (payment / adjustment-down). */
  credit: number;
  balanceAfter: number;
  /** Payment method (Cash / UPI / …) for payment rows. */
  method?: string;
  /** Individual invoice items — only for invoice rows. */
  items?: StatementItemLine[];
}

export interface StatementData {
  customer: Customer;
  /** Inclusive range (YYYY-MM-DD). */
  startDate: string;
  endDate: string;
  /** Balance carried into the period (sum of entries before startDate). */
  openingBalance: number;
  /** Chronological rows within [startDate, endDate]. */
  rows: StatementRow[];
  /** Sum of debits within the period (invoices + adjustment-up). */
  totalDebit: number;
  /** Sum of credits within the period (payments + adjustment-down, absolute). */
  totalCredit: number;
  /** Opening + all in-period amounts (same as last row's balanceAfter). */
  closingBalance: number;
}

/** "2026-08-10T05:30:00.000Z" -> local "YYYY-MM-DD" (safe, never shifts a day). */
export function isoToLocalDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * The date a ledger entry BELONGS to for statement purposes:
 *  - invoice    -> the linked invoice's Bill Date (never the recording time)
 *  - payment    -> the Payment Date (when the cash was actually received)
 *  - adjustment -> the linked invoice's Bill Date; else the Payment Date;
 *                  else the entry's local recording date
 */
export function entryBusinessDate(e: LedgerEntry, invoices: Invoice[]): string {
  if (e.type === 'payment') return e.paymentDate || isoToLocalDate(e.date) || '';
  if (e.invoiceId) {
    const inv = invoices.find((i) => i.id === e.invoiceId);
    if (inv?.date) return inv.date;
  }
  return e.paymentDate || isoToLocalDate(e.date) || '';
}

function itemSize(item: InvoiceItem): string {
  if (item.width != null && item.height != null) {
    const qty = item.qty > 1 ? ` × ${item.qty}` : '';
    return `${item.width} × ${item.height} ft${qty}`;
  }
  return '—';
}

/**
 * Build a customer statement for the inclusive date range [startDate, endDate].
 *
 * The statement is built from the LEDGER (the single source of transaction
 * truth), joined with invoices (Bill Dates + items) and payments (methods) so
 * the output mirrors the shop's paper ledger:
 *  - Opening balance = sum of every entry dated BEFORE startDate.
 *  - Every invoice, payment and adjustment with a business date inside the
 *    range appears, in chronological order (date, then recording time).
 *  - Running balance is recomputed row by row (never trusts stored
 *    balanceAfter values, which can be stale or unordered).
 *  - Closing balance = opening + in-period amounts.
 *
 * Payments are NEVER hidden just because they fall between invoices.
 */
export function buildCustomerStatement(
  customer: Customer,
  ledger: LedgerEntry[],
  invoices: Invoice[],
  payments: Payment[],
  startDate: string,
  endDate: string
): StatementData {
  // Invoice edits are corrected IN PLACE on the invoice's ledger entry, so the
  // statement only ever shows the final invoice value. Legacy "edited"
  // adjustment entries are folded into their invoice row here (never shown as
  // separate rows) — the running balance stays exactly equal to the raw sum.
  const entries = netAdjustments(ledger.filter((e) => e.customerId === customer.id));

  // Payment method lookup: payments are recorded against an invoice with a
  // date + amount; the ledger payment entry mirrors exactly those values.
  const paymentByKey = new Map<string, Payment>();
  for (const p of payments) {
    if (p.customerId !== customer.id) continue;
    paymentByKey.set(`${p.invoiceId}|${p.date}|${p.amount}`, p);
  }

  const dated = entries
    .map((e) => {
      const businessDate = entryBusinessDate(e, invoices);
      const isPayment = e.type === 'payment';
      const method = isPayment
        ? paymentByKey.get(`${e.invoiceId || ''}|${e.paymentDate || ''}|${Math.abs(e.amount)}`)?.method
        : undefined;
      const amount = Number(e.amount) || 0;
      const inv = e.invoiceId ? invoices.find((i) => i.id === e.invoiceId) : undefined;
      const row: StatementRow = {
        key: e.id,
        date: businessDate,
        type: e.type,
        description:
          e.type === 'invoice'
            ? `Invoice ${e.invoiceNumber || ''}`.trim()
            : e.type === 'payment'
              ? `Cash Receipt${method ? ` (${method})` : ''}`
              : e.description || 'Adjustment',
        invoiceNumber: e.invoiceNumber || undefined,
        debit: amount > 0 ? amount : 0,
        credit: amount < 0 ? Math.abs(amount) : 0,
        balanceAfter: 0,
        method,
        items:
          e.type === 'invoice' && inv
            ? inv.items.map((it) => ({
                label: it.label,
                size: itemSize(it),
                qty: it.qty,
                rate: it.rate,
                amount: it.amount
              }))
            : undefined
      };
      return { row, amount, businessDate, createdAt: e.date, id: e.id };
    })
    .filter((x) => x.businessDate !== '');

  // Opening balance: every entry dated strictly before the start.
  const openingBalance = round2(
    sum(
      dated
        .filter((x) => x.businessDate < startDate)
        .map((x) => x.amount)
    )
  );

  // In-period entries, chronological: business date first, then recording
  // time, then id (stable tie-break for tests).
  const inRange = dated
    .filter((x) => x.businessDate >= startDate && x.businessDate <= endDate)
    .sort((a, b) => {
      if (a.businessDate !== b.businessDate) return a.businessDate < b.businessDate ? -1 : 1;
      if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    });

  let running = openingBalance;
  let totalDebit = 0;
  let totalCredit = 0;
  const rows: StatementRow[] = [];
  for (const x of inRange) {
    running = round2(add(running, x.amount));
    totalDebit = round2(add(totalDebit, x.row.debit));
    totalCredit = round2(add(totalCredit, x.row.credit));
    rows.push({ ...x.row, balanceAfter: running });
  }

  return {
    customer,
    startDate,
    endDate,
    openingBalance,
    rows,
    totalDebit,
    totalCredit,
    closingBalance: running
  };
}

/** YYYY-MM-DD -> DD-MM-YYYY (statement filenames, e.g. 27-07-2026). */
export function formatFilenameDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return y && m && d ? `${d}-${m}-${y}` : isoDate;
}

/**
 * Statement filename: `27-07-2026_To_08-08-2026_Manipasanga_Flex.pdf`.
 * Identifies the customer + date range at a glance; safe characters only.
 */
export function statementFileName(startDate: string, endDate: string, customerName: string, ext: 'pdf' | 'jpg'): string {
  const safe = customerName.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'Customer';
  return `${formatFilenameDate(startDate)}_To_${formatFilenameDate(endDate)}_${safe}.${ext}`;
}

/** Useful statement math reused by both the UI and the document. */
export function statementBalanceDelta(statement: StatementData): number {
  return round2(sub(statement.closingBalance, statement.openingBalance));
}
