// @vitest-environment jsdom
/* Concurrency regression tests for customer-level payments.
 *
 * The bug these cover: a payment was allocated by reading each invoice's
 * `paid` value, adding to it and writing the result back. Two devices (Windows
 * + Android) recording a payment at the same moment each read the same
 * pre-payment value, so one allocation overwrote the other — the invoice showed
 * less paid than the money actually received, and its balance disagreed with the
 * ledger.
 *
 * The fix allocates through append-only allocation rows (deterministic ids) and
 * derives invoice paid/balance from the records, so simultaneous writes add up.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { DataService } from './services/data';
import { LocalDataService } from './services/localService';
import { createInvoice } from './services/invoices';
import { recordPayment, reconcileInvoiceSettlement } from './services/payments';
import { customerBalance } from './services/ledger';
import type { Invoice, InvoiceDraft, LedgerEntry, Payment, PaymentAllocation } from './lib/types';

function draft(): InvoiceDraft {
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
        rate: 10,
        amount: 1000
      }
    ],
    discountType: 'amount',
    discountValue: 0,
    paid: 0,
    date: '2026-11-01'
  };
}

/**
 * A second "device": writes go to the shared store, but the first read of each
 * money collection returns a snapshot taken BEFORE the other device's writes.
 * This deterministically reproduces the stale-read race that two real devices
 * hit when they pay at the same time.
 */
function staleDevice(shared: LocalDataService): DataService {
  const stale = new Map<string, unknown>();
  const proxy = new Proxy(shared as unknown as Record<string, unknown>, {
    get(target, prop, receiver) {
      if (prop !== 'query') return Reflect.get(target, prop, receiver);
      return async (name: string, spec?: unknown) => {
        if (!stale.has(name)) {
          stale.set(name, await (target as unknown as DataService).query(name, spec as never));
        }
        return stale.get(name);
      };
    }
  });
  return proxy as unknown as DataService;
}

async function records(svc: DataService) {
  const [invoices, payments, ledger, allocations] = await Promise.all([
    svc.query<Invoice>('invoices'),
    svc.query<Payment>('payments'),
    svc.query<LedgerEntry>('ledger'),
    svc.query<PaymentAllocation>('allocations')
  ]);
  return { invoices, payments, ledger, allocations };
}

let svc: LocalDataService;
let invoice: Invoice;

beforeEach(async () => {
  svc = new LocalDataService({ memoryOnly: true });
  invoice = await createInvoice(svc, draft());
});

describe('concurrent partial payments', () => {
  it('two devices paying at once both count, and the invoice agrees with the ledger', async () => {
    const deviceA = svc;
    const deviceB = staleDevice(svc);

    await Promise.all([
      recordPayment(deviceA, 'cust-1', { amount: 400, date: '2026-11-21', method: 'Cash', note: 'A' }),
      recordPayment(deviceB, 'cust-1', { amount: 600, date: '2026-11-21', method: 'UPI', note: 'B' })
    ]);

    const after = await records(svc);
    expect(after.payments).toHaveLength(2);
    expect(after.ledger).toHaveLength(3); // invoice debit + two payment entries
    expect(after.allocations.reduce((n, a) => n + a.amount, 0)).toBe(1000);

    // Stored totals may be stale after the race; reconciliation (startup and
    // reconnect) is what makes them exact.
    await reconcileInvoiceSettlement(svc);
    const settled = (await svc.get<Invoice>('invoices', invoice.id))!;
    expect(settled.paid).toBe(1000);
    expect(settled.balance).toBe(0);
    expect(settled.status).toBe('paid');

    // The ledger and the invoice agree: nothing is owed, nothing is credited.
    expect(customerBalance(after.ledger)).toBe(0);
  });

  it('allocates oldest-first and keeps the excess as customer credit', async () => {
    const second = await createInvoice(svc, { ...draft(), date: '2026-11-02' });
    await recordPayment(svc, 'cust-1', { amount: 1500, date: '2026-11-21', method: 'Cash', note: '' });

    await reconcileInvoiceSettlement(svc);
    const first = (await svc.get<Invoice>('invoices', invoice.id))!;
    const later = (await svc.get<Invoice>('invoices', second.id))!;
    expect(first.paid).toBe(1000);
    expect(later.paid).toBe(500);
    expect(later.balance).toBe(500);

    const { ledger } = await records(svc);
    // ₹2,000 billed − ₹1,500 received = ₹500 still due (and no credit).
    expect(customerBalance(ledger)).toBe(500);
  });
});

describe('retries and duplicate delivery are idempotent', () => {
  it('recording the same payment id twice never double-counts', async () => {
    const key = 'pay_retry_key';
    await recordPayment(svc, 'cust-1', { paymentId: key, amount: 500, date: '2026-11-21', method: 'Cash', note: '' });
    await recordPayment(svc, 'cust-1', { paymentId: key, amount: 500, date: '2026-11-21', method: 'Cash', note: '' });

    const after = await records(svc);
    expect(after.payments).toHaveLength(1);
    expect(after.ledger).toHaveLength(2); // invoice debit + one payment entry
    expect(after.allocations).toHaveLength(1);

    const settled = (await svc.get<Invoice>('invoices', invoice.id))!;
    expect(settled.paid).toBe(500);
    expect(settled.balance).toBe(500);
    expect(customerBalance(after.ledger)).toBe(500);
  });

  it('a payment that cannot be written is rolled back entirely', async () => {
    const broken: DataService = new Proxy(svc as unknown as Record<string, unknown>, {
      get(target, prop, receiver) {
        if (prop === 'set') {
          return async (name: string, id: string, data: Record<string, unknown>) => {
            if (name === 'allocations') throw new Error('network lost');
            return (target as unknown as DataService).set(name, id, data);
          };
        }
        return Reflect.get(target, prop, receiver);
      }
    }) as unknown as DataService;

    await expect(
      recordPayment(broken, 'cust-1', { amount: 500, date: '2026-11-21', method: 'Cash', note: '' })
    ).rejects.toThrow(/Nothing was changed/);

    const after = await records(svc);
    expect(after.payments).toHaveLength(0);
    expect(after.ledger).toHaveLength(1); // only the invoice's own debit survives
    expect(after.allocations).toHaveLength(0);
    const untouched = (await svc.get<Invoice>('invoices', invoice.id))!;
    expect(untouched.paid).toBe(0);
    expect(untouched.balance).toBe(1000);
  });
});

describe('offline queue and reconnect', () => {
  it('a payment recorded while offline lands once and settles on reconnect', async () => {
    // Simulate the offline queue: the local cache already holds the payment row
    // (Firestore applies queued writes to its cache) but the invoice aggregate
    // was never updated because the connection dropped mid-save.
    const key = 'pay_offline_1';
    await svc.set('payments', key, {
      customerId: 'cust-1',
      invoiceId: '',
      invoiceNumber: '',
      amount: 700,
      date: '2026-11-20',
      method: 'Cash',
      note: 'offline'
    });
    await svc.set('allocations', `${key}__${invoice.id}`, {
      customerId: 'cust-1',
      paymentId: key,
      invoiceId: invoice.id,
      amount: 700,
      createdAt: '2026-11-20T10:00:00.000Z'
    });

    // The queued write is delivered again on reconnect — same key, no duplicate.
    await recordPayment(svc, 'cust-1', { paymentId: key, amount: 700, date: '2026-11-20', method: 'Cash', note: 'offline' });
    const after = await records(svc);
    expect(after.payments).toHaveLength(1);
    expect(after.allocations).toHaveLength(1);

    // Reconnect reconciliation repairs the invoice from the records.
    const fixed = await reconcileInvoiceSettlement(svc);
    expect(fixed).toBe(1);
    const settled = (await svc.get<Invoice>('invoices', invoice.id))!;
    expect(settled.paid).toBe(700);
    expect(settled.balance).toBe(300);
  });

  it('reconciliation never reduces money recorded by older builds without allocation rows', async () => {
    // Legacy shape: an invoice whose paid was written directly, no allocation rows.
    await svc.set('invoices', invoice.id, { paid: 400, balance: 600, status: 'partial' });
    await reconcileInvoiceSettlement(svc);
    const kept = (await svc.get<Invoice>('invoices', invoice.id))!;
    expect(kept.paid).toBe(400);
    expect(kept.balance).toBe(600);
  });
});
