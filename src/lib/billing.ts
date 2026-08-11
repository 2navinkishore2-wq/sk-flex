import { mul, percentOf, round2, sub, sum } from './money';
import type { FramePrice, InvoiceItem, InvoiceStatus } from './types';

/** The four thickness/width options of the frame price table. */
export type FrameThicknessKey = 'beading' | 'oneInch' | 'onePointFiveInch' | 'twoInch';

export const FRAME_THICKNESS_COLUMNS: { key: FrameThicknessKey; label: string }[] = [
  { key: 'beading', label: 'BEADING' },
  { key: 'oneInch', label: '1 INC' },
  { key: 'onePointFiveInch', label: '1.5 INC' },
  { key: 'twoInch', label: '2 INC' }
];

/** "12 X 18" / "12×18" / "12x18" -> "12x18" (canonical, lowercase, no spaces). */
export function normalizeFrameSize(raw: string): string {
  return (raw || '').trim().toLowerCase().replace(/\s+/g, '').replace(/×/g, 'x');
}

/** Width x Height = Area (sq.ft). Returns rounded to 3 decimals for display safety. */
export function calcArea(width: number, height: number): number {
  return round2(mul(width, height));
}

/** Dimension-based product: Width x Height x Rate x Qty. */
export function calcDimensionAmount(width: number, height: number, rate: number, qty = 1): number {
  return round2(mul(width, height, rate, qty));
}

/** Custom item: Rate x Qty. */
export function calcCustomAmount(rate: number, qty: number): number {
  return round2(mul(rate, qty));
}

/**
 * Find the active frame-price row for a photo size (e.g. "12x18").
 * Sizes are matched exactly after normalization; inactive rows are ignored.
 */
export function findFramePrice(rates: FramePrice[], size: string): FramePrice | null {
  const s = normalizeFrameSize(size);
  if (!s) return null;
  return rates.find((r) => r.active && normalizeFrameSize(r.size) === s) ?? null;
}

/** Price (₹) for a size + thickness option, or null when not offered. */
export function framePriceFor(rates: FramePrice[], size: string, thickness: FrameThicknessKey): number | null {
  const row = findFramePrice(rates, size);
  if (!row) return null;
  const v = row[thickness];
  return v != null && v > 0 ? v : null;
}

/** Thickness option label, e.g. "oneInch" -> "1 inc". */
export function frameThicknessLabel(key: FrameThicknessKey | string): string {
  return FRAME_THICKNESS_COLUMNS.find((c) => c.key === key)?.label ?? key;
}

/** Frame amount: fixed price per frame × qty. */
export function calcFrameAmount(price: number, qty = 1): number {
  return round2(mul(price, qty));
}

export interface Totals {
  subtotal: number;
  discount: number;
  total: number;
}

/** Subtotal -> discount (amount or %) -> total. */
export function invoiceTotals(
  items: InvoiceItem[],
  discountType: 'amount' | 'percent',
  discountValue: number
): Totals {
  const subtotal = round2(sum(items.map((i) => i.amount)));
  const discount =
    discountType === 'percent'
      ? round2(percentOf(subtotal, discountValue))
      : round2(Math.max(0, discountValue));
  const total = round2(Math.max(0, sub(subtotal, discount)));
  return { subtotal, discount, total };
}

export function invoiceStatus(total: number, paid: number): InvoiceStatus {
  if (total <= 0) return 'paid';
  if (paid >= total) return 'paid';
  if (paid > 0) return 'partial';
  return 'credit';
}

export function calcBalance(total: number, paid: number): number {
  return round2(Math.max(0, sub(total, paid)));
}

/** "SK-0001" style invoice numbers. */
export function formatInvoiceNumber(prefix: string, n: number): string {
  return `${prefix || 'SK'}-${String(n).padStart(4, '0')}`;
}

/** Parse "SK-0042" -> 42, or -1 if unparsable. */
export function parseInvoiceNumber(_prefix: string, number: string): number {
  const m = /-(\d+)$/.exec(number);
  if (!m) return -1;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : -1;
}

export function emptyItemKey(): string {
  return `it_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
