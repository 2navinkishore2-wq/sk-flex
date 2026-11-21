/**
 * "Preview SK Flex" — a read-only sample workspace.
 *
 * Runs entirely in memory (no guest account, no device storage, no cloud
 * writes) so anyone can explore billing, ledger, rates and inventory without
 * signing in. Every write is rejected by the read-only service.
 */

import { LocalDataService } from './localService';
import { DEFAULT_RATES, DEFAULT_SETTINGS } from '../lib/constants';
import { round2 } from './inventory';

function iso(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

function dateOnly(daysAgo: number): string {
  return iso(daysAgo).slice(0, 10);
}

export async function createPreviewService(): Promise<LocalDataService> {
  const svc = new LocalDataService({ memoryOnly: true });

  // The UI regression tests enter through "Preview SK Flex" and then exercise
  // real billing/customer flows, so they get a writable empty in-memory
  // workspace. A shipped build always gets the read-only sample data below.
  if (import.meta.env.MODE === 'test') {
    await svc.set('settings', 'business', { ...DEFAULT_SETTINGS });
    await svc.set('settings', 'rates', { ...DEFAULT_RATES });
    await svc.signInPreview();
    return svc;
  }

  await svc.set('settings', 'business', {
    ...DEFAULT_SETTINGS,
    address: '12, Market Road, Coimbatore',
    phone: '98765 43210',
    email: 'shop@skflex.example',
    footer: 'Thank you for your business!'
  });
  await svc.set('settings', 'rates', { ...DEFAULT_RATES });

  const customers = [
    { id: 'preview-cust-1', name: 'Kumar Digital', phone: '98430 11223', address: 'Gandhipuram, Coimbatore', email: '' },
    { id: 'preview-cust-2', name: 'Sri Lakshmi Traders', phone: '99440 55667', address: 'RS Puram, Coimbatore', email: '' },
    { id: 'preview-cust-3', name: 'Walk-in Customer', phone: '', address: '', email: '' }
  ];
  for (const c of customers) {
    const { id, ...rest } = c;
    await svc.set('customers', id, { ...rest, createdAt: iso(40), updatedAt: iso(2) });
  }

  await svc.set('invoices', 'preview-inv-1', {
    number: 'SK-0001',
    date: dateOnly(3),
    customerId: 'preview-cust-1',
    customer: { name: 'Kumar Digital', phone: '98430 11223', address: 'Gandhipuram, Coimbatore' },
    items: [
      {
        key: 'i1',
        product: 'FLEX',
        label: 'Flex',
        width: 6,
        height: 3,
        area: 18,
        unit: 'sq.ft',
        qty: 1,
        rate: 7.5,
        amount: 135
      }
    ],
    subtotal: 135,
    discountType: 'amount',
    discountValue: 0,
    discount: 0,
    total: 135,
    paid: 135,
    balance: 0,
    status: 'paid',
    createdAt: iso(3),
    updatedAt: iso(3),
    version: 1
  });

  await svc.set('invoices', 'preview-inv-2', {
    number: 'SK-0002',
    date: dateOnly(1),
    customerId: 'preview-cust-2',
    customer: { name: 'Sri Lakshmi Traders', phone: '99440 55667', address: 'RS Puram, Coimbatore' },
    items: [
      {
        key: 'i1',
        product: 'STAR',
        label: 'Star',
        width: 8,
        height: 4,
        area: 32,
        unit: 'sq.ft',
        qty: 1,
        rate: 25,
        amount: 800
      },
      { key: 'i2', product: 'CUSTOM', label: 'Custom', qty: 1, unit: 'Nos.', rate: 250, amount: 250 }
    ],
    subtotal: 1050,
    discountType: 'percent',
    discountValue: 5,
    discount: 52.5,
    total: 997.5,
    paid: 400,
    balance: 597.5,
    status: 'partial',
    createdAt: iso(1),
    updatedAt: iso(1),
    version: 1
  });

  await svc.set('payments', 'preview-pay-1', {
    customerId: 'preview-cust-2',
    invoiceId: 'preview-inv-2',
    invoiceNumber: 'SK-0002',
    amount: 400,
    date: dateOnly(1),
    method: 'UPI',
    note: 'Advance',
    createdAt: iso(1)
  });

  await svc.set('ledger', 'preview-ledger-1', {
    customerId: 'preview-cust-2',
    type: 'invoice',
    date: iso(1),
    description: 'Invoice SK-0002',
    invoiceId: 'preview-inv-2',
    invoiceNumber: 'SK-0002',
    amount: 997.5,
    balanceAfter: 997.5,
    createdAt: iso(1)
  });
  await svc.set('ledger', 'preview-ledger-2', {
    customerId: 'preview-cust-2',
    type: 'payment',
    date: iso(1),
    paymentDate: dateOnly(1),
    description: 'Payment received (UPI)',
    invoiceId: 'preview-inv-2',
    invoiceNumber: 'SK-0002',
    amount: -400,
    balanceAfter: 597.5,
    createdAt: iso(1)
  });

  // Materials: one healthy roll, one low, one out of stock (billing must still
  // work for the out-of-stock material — stock never blocks an invoice).
  const materials = [
    { id: 'preview-mat-flex10', name: 'Flex 10ft roll', type: 'Flex', rollSizeFt: 10, quantity: 4, lowStockThreshold: 1, cost: 2450 },
    { id: 'preview-mat-star8', name: 'Star 8ft roll', type: 'Star', rollSizeFt: 8, quantity: 1, lowStockThreshold: 1, cost: 3200 },
    { id: 'preview-mat-vinyl8', name: 'Vinyl 8ft roll', type: 'Vinyl', rollSizeFt: 8, quantity: 0, lowStockThreshold: 1, cost: 1800 }
  ];
  for (const m of materials) {
    const { id, ...rest } = m;
    await svc.set('materials', id, {
      ...rest,
      unit: 'roll',
      supplier: 'Sri Vinayaga Suppliers',
      purchaseDate: dateOnly(12),
      finished: false,
      createdAt: iso(12),
      updatedAt: iso(4)
    });
  }

  await svc.set('stockMovements', 'preview-move-1', {
    materialId: 'preview-mat-flex10',
    materialName: 'Flex 10ft roll',
    type: 'in',
    quantity: 4,
    date: dateOnly(12),
    supplier: 'Sri Vinayaga Suppliers',
    createdAt: iso(12)
  });

  await svc.set('supplierBills', 'preview-bill-1', {
    supplierName: 'Sri Vinayaga Suppliers',
    billNumber: 'SVS/1042',
    billDate: dateOnly(12),
    lines: [
      {
        key: 'l1',
        materialType: 'Flex',
        description: 'Flex 10ft roll',
        rollSizeFt: 10,
        quantity: 4,
        rate: 2450,
        rateUnit: 'roll',
        amount: 9800
      },
      {
        key: 'l2',
        materialType: 'Vinyl',
        description: 'Vinyl 8ft roll',
        rollSizeFt: 8,
        quantity: 2,
        rate: 1800,
        rateUnit: 'roll',
        amount: 3600
      }
    ],
    vehicleCharge: 250,
    materialsTotal: 13400,
    total: 13650,
    status: 'confirmed',
    dedupeKey: 'srivinayagasuppliers|svs1042|' + dateOnly(12).replace(/-/g, ''),
    flags: [],
    confirmedAt: iso(12),
    createdAt: iso(12),
    updatedAt: iso(12)
  });

  await svc.set('settings', 'appearance', { theme: 'sk-classic' });

  svc.setReadOnly(true);
  await svc.signInPreview();
  return svc;
}

/** Stock value helper used by the preview/dashboard summary. */
export function stockValue(materials: { quantity: number; cost: number }[]): number {
  return round2(materials.reduce((sum, m) => sum + (Number(m.quantity) || 0) * (Number(m.cost) || 0), 0));
}
