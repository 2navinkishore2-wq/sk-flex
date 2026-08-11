/** Shared domain types for SK Flex Billing. */

export type ProductKey = 'FLEX' | 'VINYL' | 'STAR' | 'SUNPACK' | 'FRAME' | 'CUSTOM';

export interface AuthUser {
  uid: string;
  name: string;
  email: string | null;
  photoURL: string | null;
  isDemo: boolean;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  address: string;
  email: string;
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

export interface InvoiceItem {
  key: string; // unique within the invoice
  product: ProductKey;
  label: string; // display name, e.g. "Flex"
  width?: number;
  height?: number;
  area?: number; // sq.ft
  unit?: string; // e.g. "sq.ft", "Nos.", "m"
  qty: number;
  rate: number;
  amount: number;
  note?: string; // e.g. matched frame size + thickness, custom item description
  /** For FRAME items: the photo size from the frame price table, e.g. "12x18". */
  frameSize?: string;
  /** For FRAME items: the thickness option key, e.g. "oneInch". */
  frameThickness?: string;
}

export type InvoiceStatus = 'paid' | 'partial' | 'credit';

export interface InvoiceCustomerSnapshot {
  name: string;
  phone: string;
  address: string;
}

export interface Invoice {
  id: string;
  number: string;
  /** Bill Date — YYYY-MM-DD (local). The date the bill BELONGS to; never overwritten by payment dates. */
  date: string;
  customerId: string;
  customer: InvoiceCustomerSnapshot;
  items: InvoiceItem[];
  subtotal: number;
  discountType: 'amount' | 'percent';
  discountValue: number;
  discount: number;
  total: number;
  paid: number;
  balance: number;
  status: InvoiceStatus;
  note?: string;
  version: number;
  renumbered?: boolean; // true if sync reconciliation changed the number
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

export type LedgerType = 'invoice' | 'payment' | 'adjustment';

export interface LedgerEntry {
  id: string;
  customerId: string;
  type: LedgerType;
  date: string; // ISO datetime (when the entry was recorded)
  /** Payment Date (YYYY-MM-DD) for payment entries — when the cash was actually received. */
  paymentDate?: string;
  description: string;
  invoiceId?: string;
  invoiceNumber?: string;
  /** Positive = added to customer balance (invoice / debit), negative = reduced (payment / credit). */
  amount: number;
  balanceAfter: number;
  createdAt: string; // ISO
}

export interface Payment {
  id: string;
  customerId: string;
  invoiceId: string;
  invoiceNumber: string;
  amount: number;
  date: string; // YYYY-MM-DD
  method: string; // Cash / UPI / Card / Other
  note: string;
  createdAt: string; // ISO
}

/**
 * One row of the SK Photo Frame price table. `size` is the photo size in
 * inches (e.g. "12x18"); each thickness column is the FIXED price per frame
 * for that width option. `null` means that thickness is NOT offered for the
 * size (never 0 — 0 is not a valid price).
 */
export interface FramePrice {
  id: string;
  size: string; // e.g. "12x18"
  beading: number | null;
  oneInch: number | null;
  onePointFiveInch: number | null;
  twoInch: number | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProductRates {
  flex: number;
  vinyl: number;
  star: number;
  sunpack: number;
}

export interface BusinessSettings {
  address: string;
  phone: string;
  email: string;
  gst: string;
  invoicePrefix: string;
  footer: string;
  paymentNote: string;
}

export type SyncStatus = 'synced' | 'syncing' | 'offline' | 'error';

export interface DashboardStats {
  todaySales: number;
  todayBills: number;
  totalCustomers: number;
  totalOutstanding: number;
  recentInvoices: Invoice[];
  recentCustomers: Customer[];
}

/** One cash payment entered at billing time (or via Record Payment). */
export interface PaymentDraft {
  amount: number;
  /** Payment Date — YYYY-MM-DD. When the money was actually received (may differ from the Bill Date). */
  date: string;
  method: string;
  note?: string;
}

export interface InvoiceDraft {
  customerId: string;
  customer: InvoiceCustomerSnapshot;
  items: InvoiceItem[];
  discountType: 'amount' | 'percent';
  discountValue: number;
  /** Total paid — normally the sum of `payments`. Kept for backward compatibility. */
  paid: number;
  /** Bill Date — YYYY-MM-DD. */
  date: string;
  /** Optional per-payment records (each with its own Payment Date). When absent, `paid` is recorded as a single cash payment on the Bill Date. */
  payments?: PaymentDraft[];
  note?: string;
}

export interface AppContextData {
  service: import('../services/data').DataService;
  uid: string;
}
