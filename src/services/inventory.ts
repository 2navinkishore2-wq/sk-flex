/**
 * Inventory — materials, roll-wise stock and supplier bill confirmation.
 *
 * Rules enforced here (not in the UI):
 *  - Only "Confirm & Add Stock" creates inventory records.
 *  - Confirming a supplier bill is idempotent: the bill document uses a stable
 *    id derived from supplier + bill number + date, stock movements have
 *    deterministic ids, and a per-key in-flight lock serialises retries. One
 *    confirmation can never create duplicate stock.
 *  - Vehicle charge is part of the purchase total only. It never changes any
 *    stock quantity.
 *  - Customer billing is completely independent: nothing in this module is
 *    called when an invoice is saved, and stock status never blocks billing.
 */

import type {
  Material,
  MaterialType,
  MaterialUnit,
  StockMovement,
  StockMovementType,
  StockState,
  SupplierBill,
  SupplierBillLine
} from '../lib/types';
import type { DataService } from './data';

export const MATERIALS = 'materials';
export const STOCK_MOVEMENTS = 'stockMovements';
export const SUPPLIER_BILLS = 'supplierBills';

export function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Price of one roll/unit for a bill line (rate may be quoted per foot). */
export function lineUnitCost(line: Pick<SupplierBillLine, 'rate' | 'rateUnit' | 'rollSizeFt'>): number {
  const rate = Number(line.rate) || 0;
  switch (line.rateUnit) {
    case 'foot':
      return round2(rate * (Number(line.rollSizeFt) || 0));
    case 'metre':
      return round2(rate * (Number(line.rollSizeFt) || 0) * 0.3048);
    default:
      return round2(rate);
  }
}

/** Expected line amount = quantity × unit cost. */
export function expectedLineAmount(line: SupplierBillLine): number {
  return round2((Number(line.quantity) || 0) * lineUnitCost(line));
}

export function computeMaterialsTotal(lines: SupplierBillLine[]): number {
  return round2(lines.reduce((sum, l) => sum + (Number(l.amount) || expectedLineAmount(l)), 0));
}

export function computeBillTotal(lines: SupplierBillLine[], vehicleCharge: number): number {
  return round2(computeMaterialsTotal(lines) + (Number(vehicleCharge) || 0));
}

/** Stable duplicate-detection key for a supplier bill. */
export function billDedupeKey(supplierName: string, billNumber: string, billDate: string): string {
  const norm = (v: string) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return [norm(supplierName), norm(billNumber), norm(billDate)].join('|');
}

/** Deterministic document id so retries/repeats address the same bill. */
export function stableId(prefix: string, key: string): string {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) >>> 0;
  let h2 = 52711;
  for (let i = key.length - 1; i >= 0; i--) h2 = ((h2 << 5) + h2 + key.charCodeAt(i)) >>> 0;
  return `${prefix}_${h.toString(36)}${h2.toString(36)}`;
}

export function materialKey(type: MaterialType, rollSizeFt: number): string {
  return `${type}|${round2(rollSizeFt)}`;
}

export function stockState(m: Pick<Material, 'finished' | 'quantity' | 'lowStockThreshold'>): StockState {
  if (m.finished) return 'finished';
  const qty = Number(m.quantity) || 0;
  if (qty <= 0) return 'out-of-stock';
  if (qty <= (Number(m.lowStockThreshold) || 0)) return 'low';
  return 'in-stock';
}

export const STOCK_STATE_LABEL: Record<StockState, string> = {
  'in-stock': 'In stock',
  low: 'Low stock',
  'out-of-stock': 'Out of stock',
  finished: 'Finished'
};

/**
 * Everything the reviewer must look at before confirming:
 * unreadable/ambiguous values, ambiguous rate units and mismatched totals.
 */
export function billIssues(bill: {
  supplierName: string;
  billNumber: string;
  billDate: string;
  lines: SupplierBillLine[];
  vehicleCharge: number;
  total: number;
}): string[] {
  const issues: string[] = [];
  if (!bill.supplierName.trim()) issues.push('Supplier name is missing.');
  if (!bill.billNumber.trim()) issues.push('Bill number is missing.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bill.billDate)) issues.push('Bill date is missing or unreadable.');
  if (bill.lines.length === 0) issues.push('No material lines were found.');

  bill.lines.forEach((l, i) => {
    const n = i + 1;
    if (!Number.isFinite(l.rollSizeFt) || l.rollSizeFt <= 0) issues.push(`Line ${n}: roll size is unreadable.`);
    if (!Number.isFinite(l.quantity) || l.quantity <= 0) issues.push(`Line ${n}: quantity is unreadable.`);
    if (!Number.isFinite(l.rate) || l.rate < 0) issues.push(`Line ${n}: rate is unreadable.`);
    if ((l.flags || []).includes('ambiguous-unit')) {
      issues.push(`Line ${n}: rate unit is ambiguous (per roll or per foot?).`);
    }
    if ((l.flags || []).includes('unreadable')) issues.push(`Line ${n}: values could not be read — please check.`);
    const expected = expectedLineAmount(l);
    if (Number.isFinite(l.amount) && Math.abs(expected - l.amount) > 0.5) {
      issues.push(`Line ${n}: amount ${l.amount} does not match qty × rate (${expected}).`);
    }
  });

  const materials = computeMaterialsTotal(bill.lines);
  const expectedTotal = round2(materials + (Number(bill.vehicleCharge) || 0));
  if (Number.isFinite(bill.total) && Math.abs(expectedTotal - bill.total) > 0.5) {
    issues.push(`Total ${bill.total} does not match materials + vehicle charge (${expectedTotal}).`);
  }
  return issues;
}

export function findDuplicateBill(
  bills: SupplierBill[],
  key: string
): SupplierBill | undefined {
  return bills.find((b) => b.dedupeKey === key && b.status === 'confirmed');
}

/* ------------------------------------------------------------ persistence */

const inFlight = new Map<string, Promise<ConfirmResult>>();

export interface ConfirmResult {
  status: 'confirmed' | 'duplicate';
  billId: string;
  materialsTouched: number;
  movements: number;
}

export interface ConfirmInput {
  supplierName: string;
  billNumber: string;
  billDate: string;
  lines: SupplierBillLine[];
  vehicleCharge: number;
  /** Printed purchase total on the bill; stored for audit. */
  total?: number;
  note?: string;
}

/**
 * Confirm a supplier bill and create/update the stock records.
 * Safe to call repeatedly: the second call for the same bill is a no-op that
 * reports `duplicate`.
 */
export async function confirmSupplierBill(svc: DataService, input: ConfirmInput): Promise<ConfirmResult> {
  const key = billDedupeKey(input.supplierName, input.billNumber, input.billDate);
  const running = inFlight.get(key);
  if (running) return running;
  const promise = doConfirm(svc, input, key).finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

async function doConfirm(svc: DataService, input: ConfirmInput, key: string): Promise<ConfirmResult> {
  const billId = stableId('bill', key);
  const existing = await svc.get<SupplierBill>(SUPPLIER_BILLS, billId);
  if (existing && existing.status === 'confirmed') {
    return { status: 'duplicate', billId, materialsTouched: 0, movements: 0 };
  }

  const materialsTotal = computeMaterialsTotal(input.lines);
  const total = round2(materialsTotal + (Number(input.vehicleCharge) || 0));
  const now = new Date().toISOString();
  const bill: Omit<SupplierBill, 'id'> = {
    supplierName: input.supplierName.trim(),
    billNumber: input.billNumber.trim(),
    billDate: input.billDate,
    lines: input.lines,
    vehicleCharge: round2(Number(input.vehicleCharge) || 0),
    materialsTotal,
    total,
    status: 'confirmed',
    dedupeKey: key,
    flags: billIssues({ ...input, lines: input.lines, vehicleCharge: input.vehicleCharge, total: input.total ?? total }),
    note: input.note,
    confirmedAt: now,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };

  // Write the bill first: this is the duplicate guard for the whole operation.
  await svc.set(SUPPLIER_BILLS, billId, bill as unknown as Record<string, unknown>);

  let materialsTouched = 0;
  let movements = 0;

  for (let index = 0; index < input.lines.length; index++) {
    const line = input.lines[index];
    const qty = Number(line.quantity) || 0;
    if (qty <= 0) continue;

    const mKey = materialKey(line.materialType, line.rollSizeFt);
    const materialId = stableId('mat', mKey);
    const existingMaterial = await svc.get<Material>(MATERIALS, materialId);
    const unitCost = lineUnitCost(line);

    const material: Record<string, unknown> = existingMaterial
      ? {
          name: existingMaterial.name || line.description || `${line.materialType} ${line.rollSizeFt}ft`,
          type: line.materialType,
          rollSizeFt: line.rollSizeFt,
          unit: 'roll' as MaterialUnit,
          quantity: round2((Number(existingMaterial.quantity) || 0) + qty),
          lowStockThreshold: existingMaterial.lowStockThreshold ?? 1,
          supplier: input.supplierName.trim() || existingMaterial.supplier || '',
          purchaseDate: input.billDate,
          cost: unitCost,
          finished: false
        }
      : {
          name: line.description || `${line.materialType} ${line.rollSizeFt}ft roll`,
          type: line.materialType,
          rollSizeFt: line.rollSizeFt,
          unit: 'roll' as MaterialUnit,
          quantity: round2(qty),
          lowStockThreshold: 1,
          supplier: input.supplierName.trim(),
          purchaseDate: input.billDate,
          cost: unitCost,
          finished: false
        };

    await svc.set(MATERIALS, materialId, material);
    materialsTouched += 1;

    // Deterministic movement id => a retry overwrites instead of appending.
    const movementId = `${billId}_l${index}`;
    const movement: Omit<StockMovement, 'id'> = {
      materialId,
      materialName: String(material.name || ''),
      type: 'in' as StockMovementType,
      quantity: qty,
      date: input.billDate,
      supplier: input.supplierName.trim(),
      billId,
      note: line.description || undefined,
      createdAt: now
    };
    await svc.set(STOCK_MOVEMENTS, movementId, movement as unknown as Record<string, unknown>);
    movements += 1;
  }

  return { status: 'confirmed', billId, materialsTouched, movements };
}

/** Restock an existing material and record the movement. */
export async function restockMaterial(
  svc: DataService,
  material: Material,
  quantity: number,
  date: string,
  note = ''
): Promise<void> {
  const qty = Number(quantity) || 0;
  if (qty <= 0) throw new Error('Enter a quantity greater than zero.');
  await svc.set(MATERIALS, material.id, {
    quantity: round2((Number(material.quantity) || 0) + qty),
    finished: false,
    purchaseDate: date || material.purchaseDate
  });
  await svc.add(STOCK_MOVEMENTS, {
    materialId: material.id,
    materialName: material.name,
    type: 'restock',
    quantity: qty,
    date,
    supplier: material.supplier || '',
    note
  });
}

/** Mark a material roll as finished (kept in history, excluded from low stock). */
export async function markMaterialFinished(svc: DataService, material: Material): Promise<void> {
  const now = new Date().toISOString().slice(0, 10);
  await svc.set(MATERIALS, material.id, { finished: true, quantity: 0 });
  await svc.add(STOCK_MOVEMENTS, {
    materialId: material.id,
    materialName: material.name,
    type: 'finished',
    quantity: Number(material.quantity) || 0,
    date: now,
    supplier: material.supplier || ''
  });
}

/** Add a brand-new material manually (no bill), still an explicit stock action. */
export async function addMaterial(svc: DataService, input: {
  name: string;
  type: MaterialType;
  rollSizeFt: number;
  quantity: number;
  lowStockThreshold: number;
  supplier: string;
  purchaseDate: string;
  cost: number;
}): Promise<string> {
  const id = await svc.add(MATERIALS, {
    name: input.name.trim() || `${input.type} ${input.rollSizeFt}ft roll`,
    type: input.type,
    rollSizeFt: input.rollSizeFt,
    unit: 'roll',
    quantity: input.quantity,
    lowStockThreshold: input.lowStockThreshold,
    supplier: input.supplier.trim(),
    purchaseDate: input.purchaseDate,
    cost: input.cost,
    finished: false
  });
  await svc.add(STOCK_MOVEMENTS, {
    materialId: id,
    materialName: input.name.trim() || `${input.type} ${input.rollSizeFt}ft roll`,
    type: 'in',
    quantity: input.quantity,
    date: input.purchaseDate,
    supplier: input.supplier.trim(),
    note: 'Manual entry'
  });
  return id;
}

/** Low/out-of-stock materials, worst first (finished rolls excluded). */
export function lowStockMaterials(materials: Material[]): Material[] {
  const rank: Record<StockState, number> = { 'out-of-stock': 0, low: 1, 'in-stock': 2, finished: 3 };
  return materials
    .filter((m) => !m.finished && stockState(m) !== 'in-stock')
    .sort((a, b) => rank[stockState(a)] - rank[stockState(b)]);
}
