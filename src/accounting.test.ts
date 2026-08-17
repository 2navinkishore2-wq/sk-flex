// @vitest-environment jsdom
/* Accounting behavior tests (demo/localStorage backend):
 *  - invoice edits NEVER surface as "edited" / adjustment rows — the statement
 *    and ledger show only the FINAL invoice value
 *  - payments require NO invoice selection and are NEVER capped by an
 *    invoice's balance — the full amount received is always stored
 *  - overpayment becomes customer credit / advance that automatically applies
 *    to the customer's next invoice
 *  - invoice dates and payment dates stay separate
 *  - one customer's money movement never leaks into another customer's account
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { LocalDataService } from './services/localService';
import { createInvoice, updateInvoice } from './services/invoices';
import { recordPayment } from './services/payments';
import { createCustomer } from './services/customers';
import { customerBalance, ledgerStats } from './services/ledger';
import { buildCustomerStatement } from './lib/statement';
import type { Customer, Invoice, InvoiceDraft, InvoiceItem, LedgerEntry, Payment } from './lib/types';

const item = (label: string, amount: number): InvoiceItem => ({
  key: 'it1',
  product: 'CUSTOM',
  label,
  qty: 1,
  rate: amount,
  amount,
  unit: 'Nos.',
  note: 'Custom'
});

const custom = (amount: number) => [item(`Board ${amount}`, amount)];

async function setup() {
  const svc = new LocalDataService();
  await svc.signInDemo('Shop Owner');
  const customer = await createCustomer(svc, { name: 'Mani', phone: '9876543210', address: '', email: '' });
  return { svc, customer };
}

function draft(customer: Customer, over: Partial<InvoiceDraft> = {}): InvoiceDraft {
  return {
    customerId: customer.id,
    customer: { name: customer.name, phone: customer.phone, address: customer.address },
    items: custom(750),
    discountType: 'amount',
    discountValue: 0,
    paid: 0,
    date: '2026-08-11',
    ...over
  };
}

async function ledgerOf(svc: LocalDataService, customerId: string): Promise<LedgerEntry[]> {
  const all = await svc.query<LedgerEntry>('ledger');
  return all.filter((e) => e.customerId === customerId);
}

beforeEach(() => {
  localStorage.clear();
});

describe('TEST 1 — editing an invoice corrects it in place (no "edited" transaction)', () => {
  it('₹3,075 → ₹2,585.50: statement shows only the final invoice value', async () => {
    const { svc, customer } = await setup();
    const inv = await createInvoice(svc, draft(customer, { items: custom(3075), date: '2026-08-11' }));
    expect(inv.total).toBe(3075);

    await updateInvoice(svc, inv, draft(customer, { items: custom(2585.5), date: '2026-08-11' }));

    const reloaded = (await svc.query<Invoice>('invoices'))[0];
    expect(reloaded.total).toBe(2585.5);

    // Ledger: the invoice entry was rewritten in place — no adjustment row.
    const ledger = await ledgerOf(svc, customer.id);
    expect(ledger.filter((e) => e.type === 'adjustment')).toHaveLength(0);
    expect(ledger.find((e) => e.type === 'invoice')!.amount).toBe(2585.5);
    expect(customerBalance(ledger)).toBe(2585.5);

    // Statement: ONE clean invoice row with the corrected value.
    const statement = buildCustomerStatement(customer, ledger, [reloaded], [], '2026-08-01', '2026-08-31');
    expect(statement.rows).toHaveLength(1);
    const row = statement.rows[0];
    expect(row.type).toBe('invoice');
    expect(row.invoiceNumber).toBe(inv.number);
    expect(row.debit).toBe(2585.5);
    expect(row.credit).toBe(0);
    expect(row.description).toContain('Invoice');
    expect(row.description.toLowerCase()).not.toContain('edit');
    expect(statement.closingBalance).toBe(2585.5);
  });

  it('₹1,000 → ₹1,500: statement shows the final ₹1,500', async () => {
    const { svc, customer } = await setup();
    const inv = await createInvoice(svc, draft(customer, { items: custom(1000), date: '2026-08-11' }));
    await updateInvoice(svc, inv, draft(customer, { items: custom(1500), date: '2026-08-11' }));

    const reloaded = (await svc.query<Invoice>('invoices'))[0];
    expect(reloaded.total).toBe(1500);
    const ledger = await ledgerOf(svc, customer.id);
    expect(ledger.find((e) => e.type === 'invoice')!.amount).toBe(1500);
    const statement = buildCustomerStatement(customer, ledger, [reloaded], [], '2026-08-01', '2026-08-31');
    expect(statement.rows).toHaveLength(1);
    expect(statement.rows[0].debit).toBe(1500);
    expect(statement.rows[0].credit).toBe(0);
  });

  it('re-saving an invoice never silently changes paid/credit state', async () => {
    const { svc, customer } = await setup();
    await createInvoice(svc, draft(customer, { items: custom(1500), date: '2026-08-11' }));
    await recordPayment(svc, customer.id, { amount: 2500, date: '2026-08-17', method: 'Cash', note: '' }); // credit 1000
    const inv2 = await createInvoice(svc, draft(customer, { items: custom(3000), date: '2026-08-18' }));
    expect(inv2.creditApplied).toBe(1000);

    await updateInvoice(svc, inv2, draft(customer, { items: custom(3000), date: '2026-08-18' }));
    const reloaded = (await svc.query<Invoice>('invoices')).find((i) => i.id === inv2.id)!;
    expect(reloaded.paid).toBe(1000);
    expect(reloaded.balance).toBe(2000);
    expect(reloaded.creditApplied).toBe(1000);
  });

  it('editing an invoice keeps payments that were allocated from customer receipts', async () => {
    const { svc, customer } = await setup();
    const inv = await createInvoice(svc, draft(customer, { items: custom(1500), date: '2026-08-11' }));
    await recordPayment(svc, customer.id, { amount: 500, date: '2026-08-17', method: 'Cash', note: '' });
    await updateInvoice(svc, inv, draft(customer, { items: custom(1500), date: '2026-08-11' })); // minor fix, same total

    const reloaded = (await svc.query<Invoice>('invoices'))[0];
    expect(reloaded.paid).toBe(500); // the allocated ₹500 survives the edit
    expect(reloaded.balance).toBe(1000);
    const ledger = await ledgerOf(svc, customer.id);
    expect(customerBalance(ledger)).toBe(1000);
  });
});

describe('TEST 2 — a full payment settles the outstanding exactly', () => {
  it('outstanding ₹1,500 + payment ₹1,500 → outstanding ₹0', async () => {
    const { svc, customer } = await setup();
    await createInvoice(svc, draft(customer, { items: custom(1500), date: '2026-08-11' }));
    await recordPayment(svc, customer.id, { amount: 1500, date: '2026-08-17', method: 'Cash', note: '' });

    const reloaded = (await svc.query<Invoice>('invoices'))[0];
    expect(reloaded.paid).toBe(1500);
    expect(reloaded.balance).toBe(0);
    expect(reloaded.status).toBe('paid');

    const ledger = await ledgerOf(svc, customer.id);
    expect(customerBalance(ledger)).toBe(0);
    expect(ledgerStats(ledger).balance).toBe(0);
  });
});

describe('TEST 3 — overpayment is recorded in full and becomes customer credit', () => {
  it('outstanding ₹1,500 + payment ₹2,500 → payment record ₹2,500, credit ₹1,000', async () => {
    const { svc, customer } = await setup();
    await createInvoice(svc, draft(customer, { items: custom(1500), date: '2026-08-11' }));
    await recordPayment(svc, customer.id, { amount: 2500, date: '2026-08-17', method: 'Cash', note: '' });

    // The FULL amount is stored — never silently reduced to ₹1,500.
    const pays = await svc.query<Payment>('payments');
    expect(pays).toHaveLength(1);
    expect(pays[0].amount).toBe(2500);
    expect(pays[0].date).toBe('2026-08-17');
    expect(pays[0].method).toBe('Cash');

    // The invoice is fully settled; the extra ₹1,000 is customer credit.
    const reloaded = (await svc.query<Invoice>('invoices'))[0];
    expect(reloaded.paid).toBe(1500);
    expect(reloaded.balance).toBe(0);

    const ledger = await ledgerOf(svc, customer.id);
    expect(customerBalance(ledger)).toBe(-1000); // customer is ahead by ₹1,000
    expect(ledgerStats(ledger).paid).toBe(2500);
  });
});

describe('TEST 4 — credit automatically applies to the next invoice', () => {
  it('₹1,000 credit + new ₹3,000 invoice → outstanding ₹2,000, statement shows real money movement', async () => {
    const { svc, customer } = await setup();
    await createInvoice(svc, draft(customer, { items: custom(1500), date: '2026-08-11' }));
    await recordPayment(svc, customer.id, { amount: 2500, date: '2026-08-17', method: 'Cash', note: '' });

    const inv2 = await createInvoice(svc, draft(customer, { items: custom(3000), date: '2026-08-18' }));
    expect(inv2.creditApplied).toBe(1000);
    expect(inv2.paid).toBe(1000);
    expect(inv2.balance).toBe(2000);

    const all = await svc.query<Invoice>('invoices');
    const inv1 = all.find((i) => i.number === 'SK-0001')!;
    const pays = await svc.query<Payment>('payments');
    const ledger = await ledgerOf(svc, customer.id);
    expect(customerBalance(ledger)).toBe(2000); // outstanding after the credit was applied

    // The statement tells the whole story cleanly:
    const statement = buildCustomerStatement(customer, ledger, all, pays, '2026-08-01', '2026-08-31');
    expect(statement.rows.map((r) => [r.date, r.type, r.invoiceNumber || '', r.debit, r.credit, r.balanceAfter])).toEqual([
      ['2026-08-11', 'invoice', 'SK-0001', 1500, 0, 1500],
      ['2026-08-17', 'payment', '', 0, 2500, -1000], // credit carried (advance)
      ['2026-08-18', 'invoice', 'SK-0002', 3000, 0, 2000] // credit applied → ₹2,000
    ]);
    expect(statement.closingBalance).toBe(2000);
    expect(inv1.balance).toBe(0);
  });
});

describe('TEST 5 — invoice date and payment date stay separate', () => {
  it('invoice on 11 Aug, payment on 17 Aug — both dates preserved correctly', async () => {
    const { svc, customer } = await setup();
    await createInvoice(svc, draft(customer, { items: custom(1500), date: '2026-08-11' }));
    await recordPayment(svc, customer.id, { amount: 1000, date: '2026-08-17', method: 'Cash', note: '' });

    const reloaded = (await svc.query<Invoice>('invoices'))[0];
    expect(reloaded.date).toBe('2026-08-11'); // invoice date never overwritten

    const pays = await svc.query<Payment>('payments');
    expect(pays[0].date).toBe('2026-08-17'); // actual payment date

    const ledger = await ledgerOf(svc, customer.id);
    const payEntry = ledger.find((e) => e.type === 'payment')!;
    expect(payEntry.paymentDate).toBe('2026-08-17');

    const statement = buildCustomerStatement(customer, ledger, [reloaded], pays, '2026-08-01', '2026-08-31');
    expect(statement.rows.map((r) => [r.date, r.type])).toEqual([
      ['2026-08-11', 'invoice'],
      ['2026-08-17', 'payment']
    ]);
  });
});

describe('TEST 6 — a payment can be recorded without selecting an invoice', () => {
  it('recordPayment takes only a customer — no invoiceId anywhere', async () => {
    const { svc, customer } = await setup();
    await createInvoice(svc, draft(customer, { items: custom(1500), date: '2026-08-11' }));

    await recordPayment(svc, customer.id, { amount: 800, date: '2026-08-17', method: 'UPI', note: 'GPay' });

    const pays = await svc.query<Payment>('payments');
    expect(pays).toHaveLength(1);
    expect(pays[0].invoiceId).toBe('');
    expect(pays[0].amount).toBe(800);
    expect(pays[0].method).toBe('UPI');

    const ledger = await ledgerOf(svc, customer.id);
    const payEntry = ledger.find((e) => e.type === 'payment')!;
    expect(payEntry.invoiceId).toBe('');
    expect(payEntry.paymentDate).toBe('2026-08-17');

    // The payment was allocated to the outstanding invoice anyway.
    const reloaded = (await svc.query<Invoice>('invoices'))[0];
    expect(reloaded.paid).toBe(800);
  });
});

describe('TEST 7 — payments are never limited by an invoice balance', () => {
  it('a ₹5,000 payment is allowed when outstanding is only ₹1,500', async () => {
    const { svc, customer } = await setup();
    await createInvoice(svc, draft(customer, { items: custom(1500), date: '2026-08-11' }));

    await expect(
      recordPayment(svc, customer.id, { amount: 5000, date: '2026-08-17', method: 'Bank Transfer', note: '' })
    ).resolves.toBeUndefined();

    const pays = await svc.query<Payment>('payments');
    expect(pays[0].amount).toBe(5000); // full amount, untouched

    const ledger = await ledgerOf(svc, customer.id);
    expect(customerBalance(ledger)).toBe(-3500); // 1500 − 5000 → ₹3,500 credit
  });
});

describe('TEST 8 — customer isolation (data never crosses customers)', () => {
  it("customer A's invoices/payments never appear in customer B's statement", async () => {
    const { svc, customer: a } = await setup();
    const b = await createCustomer(svc, { name: 'Other Shop', phone: '9000000000', address: '', email: '' });

    await createInvoice(svc, draft(a, { items: custom(1500), date: '2026-08-11' }));
    await createInvoice(svc, draft(b, { items: custom(3000), date: '2026-08-12' }));
    await recordPayment(svc, a.id, { amount: 500, date: '2026-08-17', method: 'Cash', note: '' });

    const allInvoices = await svc.query<Invoice>('invoices');
    const allPays = await svc.query<Payment>('payments');
    const ledger = await svc.query<LedgerEntry>('ledger');

    const sA = buildCustomerStatement(a, ledger, allInvoices, allPays, '2026-08-01', '2026-08-31');
    expect(sA.rows.some((r) => r.invoiceNumber === 'SK-0002')).toBe(false); // B's invoice never in A's statement
    expect(sA.totalDebit).toBe(1500);
    expect(sA.totalCredit).toBe(500);
    expect(sA.closingBalance).toBe(1000);

    const sB = buildCustomerStatement(b, ledger, allInvoices, allPays, '2026-08-01', '2026-08-31');
    expect(sB.rows.some((r) => r.invoiceNumber === 'SK-0001')).toBe(false);
    expect(sB.totalCredit).toBe(0); // A's payment never reduces B's balance
    expect(sB.totalDebit).toBe(3000);
    expect(sB.closingBalance).toBe(3000);
  });
});

describe('Allocation & statement clarity', () => {
  it('a customer-level payment is allocated to the oldest outstanding invoices first', async () => {
    const { svc, customer } = await setup();
    const inv1 = await createInvoice(svc, draft(customer, { items: custom(1500), date: '2026-08-11' }));
    const inv2 = await createInvoice(svc, draft(customer, { items: custom(3000), date: '2026-08-12' }));
    await recordPayment(svc, customer.id, { amount: 2500, date: '2026-08-17', method: 'Cash', note: '' });

    const all = await svc.query<Invoice>('invoices');
    const i1 = all.find((i) => i.id === inv1.id)!;
    const i2 = all.find((i) => i.id === inv2.id)!;
    expect(i1.paid).toBe(1500); // oldest settled first
    expect(i1.balance).toBe(0);
    expect(i2.paid).toBe(1000);
    expect(i2.balance).toBe(2000);

    const ledger = await ledgerOf(svc, customer.id);
    expect(customerBalance(ledger)).toBe(2000);
  });

  it('the statement contains no internal implementation details', async () => {
    const { svc, customer } = await setup();
    await createInvoice(svc, draft(customer, { items: custom(1500), date: '2026-08-11' }));
    await recordPayment(svc, customer.id, { amount: 2500, date: '2026-08-17', method: 'Cash', note: '' });

    const all = await svc.query<Invoice>('invoices');
    const pays = await svc.query<Payment>('payments');
    const ledger = await ledgerOf(svc, customer.id);
    const statement = buildCustomerStatement(customer, ledger, all, pays, '2026-08-01', '2026-08-31');

    const text = statement.rows.map((r) => r.description.toLowerCase()).join(' ');
    expect(text).not.toContain('edited');
    expect(text).not.toContain('balance reduced');
    expect(text).not.toContain('balance increased');
    expect(text).not.toContain('adjustment');
    // Clean, human-readable money movement:
    expect(statement.rows.map((r) => r.description)).toEqual([
      'Invoice SK-0001',
      'Cash Receipt (Cash)'
    ]);
  });
});
