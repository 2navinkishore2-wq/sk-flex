import type { InvoiceStatus } from './types';

/** Indian digit grouping: 1234567.89 -> "12,34,567.89" (manual, platform-independent). */
export function groupIndian(num: number): string {
  const neg = num < 0;
  const [intPart, fracPart] = Math.abs(num).toFixed(2).split('.');
  let grouped = '';
  const digits = intPart;
  if (digits.length <= 3) {
    grouped = digits;
  } else {
    const last3 = digits.slice(-3);
    let rest = digits.slice(0, -3);
    const pairs: string[] = [];
    while (rest.length > 2) {
      pairs.unshift(rest.slice(-2));
      rest = rest.slice(0, -2);
    }
    if (rest.length > 0) pairs.unshift(rest);
    grouped = [...pairs, last3].join(',');
  }
  return `${neg ? '-' : ''}${grouped}${fracPart !== '00' ? '.' + fracPart : ''}`;
}

/** Format as Indian Rupees: 750 -> "₹750", 1234.5 -> "₹1,234.50". */
export function formatINR(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  const s = groupIndian(v);
  return `₹${s}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-08-10" -> "10 Aug 2026". Missing/legacy dates render as "—" (never crash). */
export function formatDate(isoDate?: string): string {
  if (!isoDate) return '—';
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return isoDate;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-08-10" -> "10 August 2026" (used for date-wise history group headers). */
export function formatDateLong(isoDate?: string): string {
  if (!isoDate) return '—';
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return isoDate;
  return `${d} ${MONTHS_LONG[m - 1]} ${y}`;
}

/** ISO datetime -> "10 Aug 2026, 5:30 PM". */
export function formatDateTime(iso: string): string {
  if (!iso) return '—';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  let h = dt.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const mm = String(dt.getMinutes()).padStart(2, '0');
  return `${formatDate(dt.toISOString().slice(0, 10))}, ${h}:${mm} ${ampm}`;
}

/** Today as YYYY-MM-DD (local time). */
export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Now as ISO datetime string (local). */
export function nowISO(): string {
  return new Date().toISOString();
}

export const STATUS_LABEL: Record<InvoiceStatus, string> = {
  paid: 'Paid',
  partial: 'Partial',
  credit: 'Credit'
};

/** " +91 98765 43210" style phone formatting (display only). */
export function formatPhone(phone: string): string {
  return phone.trim() || '—';
}
