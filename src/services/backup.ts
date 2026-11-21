import type { Customer, Invoice } from '../lib/types';
import { formatDate, formatINR, groupIndian } from '../lib/format';
import type { DataService } from './data';

export const BACKUP_COLLECTIONS = [
  'customers',
  'invoices',
  'payments',
  // Append-only payment→invoice allocations (settlement records).
  'allocations',
  'ledger',
  'frameRates',
  'settings',
  // Inventory: materials, stock history and confirmed supplier bills.
  'materials',
  'stockMovements',
  'supplierBills'
] as const;

export interface BackupFile {
  app: string;
  version: number;
  exportedAt: string;
  data: Record<string, unknown[]>;
}

export async function exportBackup(svc: DataService): Promise<BackupFile> {
  const data: Record<string, unknown[]> = {};
  for (const name of BACKUP_COLLECTIONS) {
    data[name] = await svc.query<{ id: string }>(name);
  }
  return {
    app: 'SK Flex Billing',
    version: 1,
    exportedAt: new Date().toISOString(),
    data
  };
}

/** Restore from a parsed, validated backup file. Returns a summary. */
export async function importBackup(
  svc: DataService,
  file: BackupFile
): Promise<{ collections: number; documents: number }> {
  if (!file || file.app !== 'SK Flex Billing' || !file.data || typeof file.data !== 'object') {
    throw new Error('This file is not a valid SK Flex Billing backup.');
  }
  let documents = 0;
  let collections = 0;
  for (const name of BACKUP_COLLECTIONS) {
    const docs = file.data[name];
    if (!Array.isArray(docs)) continue;
    for (const doc of docs as ({ id: string } & Record<string, unknown>)[]) {
      if (!doc || typeof doc !== 'object' || !doc.id) continue;
      const { id, ...rest } = doc;
      await svc.set(name, id, rest);
      documents += 1;
    }
    if (docs.length > 0) collections += 1;
  }
  return { collections, documents };
}

export function csvEscape(v: string | number): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function invoicesToCSV(invoices: Invoice[]): string {
  const header = ['Invoice No', 'Date', 'Customer', 'Phone', 'Items', 'Subtotal', 'Discount', 'Total', 'Paid', 'Balance', 'Status'];
  const rows = invoices.map((i) =>
    [
      i.number,
      i.date,
      i.customer.name,
      i.customer.phone,
      i.items.map((it) => `${it.label}${it.width && it.height ? ` (${it.width}x${it.height})` : ''} x${it.qty}`).join('; '),
      formatINR(i.subtotal),
      formatINR(i.discount),
      formatINR(i.total),
      formatINR(i.paid),
      formatINR(i.balance),
      i.status
    ]
      .map(csvEscape)
      .join(',')
  );
  return [header.join(','), ...rows].join('\n');
}

export function customersToCSV(customers: Customer[]): string {
  const header = ['Name', 'Phone', 'Address', 'Email', 'Added On'];
  const rows = customers.map((c) =>
    [c.name, c.phone, c.address, c.email, formatDate(c.createdAt.slice(0, 10))].map(csvEscape).join(',')
  );
  return [header.join(','), ...rows].join('\n');
}

export function triggerTextDownload(content: string, filename: string, mime = 'application/json') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export { groupIndian };
