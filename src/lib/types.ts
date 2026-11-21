/** Shared domain types for SK Flex Billing. */

export type ProductKey = 'FLEX' | 'VINYL' | 'STAR' | 'SUNPACK' | 'FRAME' | 'CUSTOM';

export interface AuthUser {
  uid: string;
  name: string;
  email: string | null;
  photoURL: string | null;
  isDemo: boolean;
  /** True for the read-only "Preview SK Flex" sample session (no account). */
  preview?: boolean;
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
  /** Portion of this invoice settled from the customer's advance/credit balance
   * (e.g. an earlier overpayment). Real money movement lives in the ledger;
   * this is a display record of how much of the credit was applied here. */
  creditApplied?: number;
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
 * One allocation of a customer-level payment to a specific invoice.
 *
 * Allocations are APPEND-ONLY and each has a deterministic id derived from the
 * payment and the invoice (`<paymentId>__<invoiceId>`), so applying the same
 * payment twice (a retry, or two devices syncing the same queued write) can
 * never allocate the money twice. Invoice `paid`/`balance` are derived from
 * these rows plus the invoice's own billing-time payments, which means two
 * devices recording payments at the same time can never lose one another's
 * allocation — the rows simply add up, and a reconciliation pass recomputes
 * the stored totals from them.
 */
export interface PaymentAllocation {
  id: string;
  customerId: string;
  paymentId: string;
  invoiceId: string;
  amount: number;
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
  /** Show the per-item Rate column on the customer invoice (display only —
   * never affects the stored rate or the amount calculation). Default OFF. */
  showRateOnInvoice: boolean;
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

/* =========================================================
   Inventory (materials, roll-wise stock, supplier bills)
   ========================================================= */

export type MaterialType = 'Flex' | 'Vinyl' | 'Star' | 'Sunpack' | 'Frame' | 'Other';

export const MATERIAL_TYPES: MaterialType[] = ['Flex', 'Vinyl', 'Star', 'Sunpack', 'Frame', 'Other'];

export type MaterialUnit = 'roll' | 'metre' | 'piece' | 'sqft';

export type StockState = 'in-stock' | 'low' | 'out-of-stock' | 'finished';

/** One stocked material (a specific material type + roll size). */
export interface Material {
  id: string;
  name: string;
  type: MaterialType;
  /** Roll size in feet (e.g. 10 for a 10-ft roll). */
  rollSizeFt: number;
  unit: MaterialUnit;
  quantity: number;
  lowStockThreshold: number;
  supplier: string;
  /** YYYY-MM-DD (latest purchase). */
  purchaseDate: string;
  /** Cost per roll/unit at the latest purchase. */
  cost: number;
  finished: boolean;
  createdAt: string;
  updatedAt: string;
}

export type StockMovementType = 'in' | 'restock' | 'finished';

/** Append-only stock history entry. Movements never come from customer bills. */
export interface StockMovement {
  id: string;
  materialId: string;
  materialName: string;
  type: StockMovementType;
  quantity: number;
  /** YYYY-MM-DD */
  date: string;
  supplier: string;
  billId?: string;
  note?: string;
  createdAt: string;
}

export type RateUnit = 'roll' | 'foot' | 'metre' | 'piece' | 'sqft';

/** One line of a supplier bill draft (editable before confirming). */
export interface SupplierBillLine {
  key: string;
  materialType: MaterialType;
  description: string;
  rollSizeFt: number;
  quantity: number;
  rate: number;
  rateUnit: RateUnit;
  /** Expected line amount from the bill (editable). */
  amount: number;
  /** Warning flags, e.g. "Check rate unit". */
  flags?: string[];
}

export interface SupplierBill {
  id: string;
  supplierName: string;
  billNumber: string;
  /** YYYY-MM-DD */
  billDate: string;
  lines: SupplierBillLine[];
  /** Vehicle charge shown separately; never affects stock quantities. */
  vehicleCharge: number;
  materialsTotal: number;
  total: number;
  status: 'draft' | 'confirmed';
  /** Stable key derived from supplier + bill number + date (duplicate guard). */
  dedupeKey: string;
  flags: string[];
  note?: string;
  confirmedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AppearanceSettings {
  theme: string;
}
