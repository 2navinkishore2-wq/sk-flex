// @vitest-environment jsdom
/* Regression tests for the billing-integrity fixes:
 *  - deleting an invoice also deletes its own ledger + billing-time payment
 *    rows (no orphaned money inflating the customer's balance),
 *  - customer-level payments are never deleted with an invoice,
 *  - a bill is rolled back entirely when its ledger write fails,
 *  - discounts beyond the bill / 100% are rejected instead of silently capped.
 *
 * The real LocalDataService is used as the data backend (it implements the same
 * DataService contract as Firestore), so these assertions cover the actual
 * save/delete logic the app runs.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { DataService } from './services/data';
import { LocalDataService } from './services/localService';
import { createInvoice, deleteInvoice, validateInvoiceDraft } from './services/invoices';
import { recordPayment } from './services/payments';
import { customerBalance } from './services/ledger';
import type { Invoice, InvoiceDraft, LedgerEntry, Payment } from './lib/types';

function draft(overrides: Partial<InvoiceDraft> = {}): InvoiceDraft {
  return {
    customerId: 'cust-1',
    customer: { name: 'Ramesh', phone: '9876543210', address: '' },
    items: [
      {
        key: 'k1',
        product: 'FLEX',
        label: 'Flex',
        width: 10,
        height: 10,
        area: 100,
        unit: 'sq.ft',
        qty: 1,
        rate: 7.5,
        amount: 750
      }
    ],
    discountType: 'amount',
    discountValue: 0,
    paid: 0,
    date: '2026-11-21',
    ...overrides
  };
}

let svc: DataService;

beforeEach(() => {
  // memoryOnly: isolated per test, never touches localStorage.
  svc = new LocalDataService({ memoryOnly: true });
});

async function ledgerFor(customerId: string): Promise<LedgerEntry[]> {
  return (await svc.query<LedgerEntry>('ledger')).filter((e) => e.customerId === customerId);
}

describe('invoice deletion keeps the ledger consistent', () => {
  it('removes the invoice, its ledger entry and its billing-time payment record', async () => {
    const inv = await createInvoice(svc, draft({ paid: 500 }));
    expect(customerBalance(await ledgerFor('cust-1'))).toBe(250); // 750 billed − 500 paid

    await deleteInvoice(svc, inv as Invoice);

    expect(await svc.get('invoices', inv.id)).toBeNull();
    // No orphan ledger rows: the customer's balance is back to ₹0.
    expect(await ledgerFor('cust-1')).toHaveLength(0);
    expect(customerBalance(await ledgerFor('cust-1'))).toBe(0);
    // The billing-time payment record is gone too (it belonged to the bill).
    const payments = (await svc.query<Payment>('payments')).filter((p) => p.invoiceId === inv.id);
    expect(payments).toHaveLength(0);
  });

  it('never deletes a customer-level payment (money actually received) with an invoice', async () => {
    const inv = await createInvoice(svc, draft()); // ₹750 outstanding, no billing-time payment
    await recordPayment(svc, 'cust-1', { amount: 300, date: '2026-11-21', method: 'Cash', note: '' });
    // The payment is customer-level (invoiceId ''), recorded in payments + ledger.
    const before = (await svc.query<Payment>('payments')).filter((p) => p.customerId === 'cust-1');
    expect(before.length).toBe(1);

    await deleteInvoice(svc, inv as Invoice);

    const after = (await svc.query<Payment>('payments')).filter((p) => p.customerId === 'cust-1');
    expect(after).toHaveLength(1); // the received money still exists
    // Ledger now holds only the −₹300 payment, i.e. the customer is ₹300 in credit.
    expect(customerBalance(await ledgerFor('cust-1'))).toBe(-300);
    expect((await ledgerFor('cust-1')).map((e) => e.type)).toEqual(['payment']);
  });
});

describe('a bill is never saved without its ledger rows', () => {
  it('rolls back the invoice + payment rows when the ledger write fails', async () => {
    // Wrap the service so ledger writes fail while everything else works.
    const failing: DataService = Object.create(svc) as DataService;
    failing.add = (name: string, data: Record<string, unknown>) => {
      if (name === 'ledger') return Promise.reject(new Error('permission-denied'));
      return svc.add(name, data);
    };

    await expect(createInvoice(failing, draft({ paid: 100 }))).rejects.toThrow(/not saved.*ledger/i);

    // Nothing half-written survived.
    expect(await svc.query('invoices')).toHaveLength(0);
    expect(await svc.query('payments')).toHaveLength(0);
    expect(await svc.query('ledger')).toHaveLength(0);
  });
});

describe('discount validation', () => {
  it('rejects an amount discount larger than the subtotal', () => {
    expect(validateInvoiceDraft(draft({ discountType: 'amount', discountValue: 5000 }))).toMatch(/subtotal/i);
  });

  it('rejects a percentage discount above 100', () => {
    expect(validateInvoiceDraft(draft({ discountType: 'percent', discountValue: 150 }))).toMatch(/100%/);
  });

  it('accepts valid discounts and still bills correctly', async () => {
    expect(validateInvoiceDraft(draft({ discountType: 'percent', discountValue: 10 }))).toBeNull();
    const inv = await createInvoice(svc, draft({ discountType: 'percent', discountValue: 10 }));
    expect(inv.total).toBe(675); // 750 − 10%
    expect(customerBalance(await ledgerFor('cust-1'))).toBe(675);
  });

  it('rejects a negative discount', () => {
    expect(validateInvoiceDraft(draft({ discountValue: -50 }))).toMatch(/valid discount/i);
  });
});
