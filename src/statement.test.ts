import { describe, expect, it } from 'vitest';
import type { Customer, Invoice, LedgerEntry, Payment } from './lib/types';
import { buildCustomerStatement, entryBusinessDate, formatFilenameDate, statementFileName } from './lib/statement';

const CUSTOMER: Customer = {
  id: 'c1',
  name: 'Manipasanga Flex',
  phone: '9876543210',
  address: 'Main Road, Salem',
  email: '',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z'
};

function invoice(over: Partial<Invoice> & { id: string; number: string; date: string; total: number }): Invoice {
  return {
    customerId: 'c1',
    customer: { name: CUSTOMER.name, phone: CUSTOMER.phone, address: CUSTOMER.address },
    items: [
      { key: 'it1', product: 'FLEX', label: 'Flex', width: 10, height: 10, area: 100, unit: 'sq.ft', qty: 1, rate: 7.5, amount: 750 }
    ],
    subtotal: over.total,
    discountType: 'amount',
    discountValue: 0,
    discount: 0,
    paid: 0,
    balance: over.total,
    status: 'credit',
    version: 1,
    createdAt: `${over.date}T09:00:00.000Z`,
    updatedAt: `${over.date}T09:00:00.000Z`,
    ...over
  };
}

function invEntry(partial: Partial<LedgerEntry> & { id: string; invoiceId: string; invoiceNumber: string; amount: number; date: string }): LedgerEntry {
  return {
    customerId: 'c1',
    type: 'invoice',
    paymentDate: '',
    description: `Invoice ${partial.invoiceNumber}`,
    balanceAfter: 0,
    createdAt: partial.date,
    ...partial
  };
}

function payEntry(partial: Partial<LedgerEntry> & { id: string; invoiceId: string; invoiceNumber: string; amount: number; paymentDate: string; date: string }): LedgerEntry {
  return {
    customerId: 'c1',
    type: 'payment',
    description: `Payment received — Invoice ${partial.invoiceNumber}`,
    balanceAfter: 0,
    createdAt: partial.date,
    ...partial
  };
}

function payment(partial: Partial<Payment> & { id: string; invoiceId: string; invoiceNumber: string; amount: number; date: string; method: string }): Payment {
  return {
    customerId: 'c1',
    note: '',
    createdAt: `${partial.date}T10:00:00.000Z`,
    ...partial
  };
}

/**
 * Reference scenario (Manipasanga Flex, 27-Jul-2026 to 8-Aug-2026):
 * opening balance carried from before 27-Jul, invoices and cash receipts on
 * interleaved dates, running balance, closing balance.
 */
const INVOICES: Invoice[] = [
  invoice({ id: 'i1', number: 'SK-0041', date: '2026-07-20', total: 12000 }), // before the period -> opening
  invoice({ id: 'i2', number: 'SK-0042', date: '2026-07-27', total: 8000 }),
  invoice({ id: 'i3', number: 'SK-0043', date: '2026-07-29', total: 5000 }),
  invoice({ id: 'i4', number: 'SK-0044', date: '2026-07-30', total: 3000 }),
  invoice({ id: 'i5', number: 'SK-0045', date: '2026-08-02', total: 10000 }),
  invoice({ id: 'i6', number: 'SK-0046', date: '2026-08-03', total: 2000 }),
  invoice({ id: 'i7', number: 'SK-0047', date: '2026-08-10', total: 4000 }) // after the period
];

const LEDGER: LedgerEntry[] = [
  invEntry({ id: 'l1', invoiceId: 'i1', invoiceNumber: 'SK-0041', amount: 12000, date: '2026-07-20T09:00:00.000Z' }),
  invEntry({ id: 'l2', invoiceId: 'i2', invoiceNumber: 'SK-0042', amount: 8000, date: '2026-07-27T09:00:00.000Z' }),
  payEntry({ id: 'l3', invoiceId: 'i2', invoiceNumber: 'SK-0042', amount: -3000, paymentDate: '2026-07-27', date: '2026-07-27T10:00:00.000Z' }),
  invEntry({ id: 'l4', invoiceId: 'i3', invoiceNumber: 'SK-0043', amount: 5000, date: '2026-07-29T09:00:00.000Z' }),
  invEntry({ id: 'l5', invoiceId: 'i4', invoiceNumber: 'SK-0044', amount: 3000, date: '2026-07-30T09:00:00.000Z' }),
  payEntry({ id: 'l6', invoiceId: 'i3', invoiceNumber: 'SK-0043', amount: -2000, paymentDate: '2026-07-30', date: '2026-07-30T10:00:00.000Z' }),
  invEntry({ id: 'l7', invoiceId: 'i5', invoiceNumber: 'SK-0045', amount: 10000, date: '2026-08-02T09:00:00.000Z' }),
  invEntry({ id: 'l8', invoiceId: 'i6', invoiceNumber: 'SK-0046', amount: 2000, date: '2026-08-03T09:00:00.000Z' }),
  payEntry({ id: 'l9', invoiceId: 'i5', invoiceNumber: 'SK-0045', amount: -5000, paymentDate: '2026-08-05', date: '2026-08-05T10:00:00.000Z' }),
  invEntry({ id: 'l10', invoiceId: 'i7', invoiceNumber: 'SK-0047', amount: 4000, date: '2026-08-10T09:00:00.000Z' })
];

const PAYMENTS: Payment[] = [
  payment({ id: 'p1', invoiceId: 'i2', invoiceNumber: 'SK-0042', amount: 3000, date: '2026-07-27', method: 'Cash' }),
  payment({ id: 'p2', invoiceId: 'i3', invoiceNumber: 'SK-0043', amount: 2000, date: '2026-07-30', method: 'UPI' }),
  payment({ id: 'p3', invoiceId: 'i5', invoiceNumber: 'SK-0045', amount: 5000, date: '2026-08-05', method: 'Cash' })
];

describe('buildCustomerStatement — the full customer ledger', () => {
  it('opening balance = sum of entries before the start date', () => {
    const s = buildCustomerStatement(CUSTOMER, LEDGER, INVOICES, PAYMENTS, '2026-07-27', '2026-08-08');
    expect(s.openingBalance).toBe(12000); // SK-0041 on 20-Jul is before the period
  });

  it('every invoice and payment in the period appears, chronological, with payments BETWEEN invoices visible', () => {
    const s = buildCustomerStatement(CUSTOMER, LEDGER, INVOICES, PAYMENTS, '2026-07-27', '2026-08-08');
    const dates = s.rows.map((r) => r.date);
    // The reference sequence: 27-Jul invoice, 27-Jul receipt, 29-Jul invoice,
    // 30-Jul invoice, 30-Jul receipt, 2-Aug invoice, 3-Aug invoice…
    expect(dates).toEqual([
      '2026-07-27', // invoice SK-0042
      '2026-07-27', // cash receipt (same day, recorded after)
      '2026-07-29', // invoice SK-0043
      '2026-07-30', // invoice SK-0044
      '2026-07-30', // cash receipt (UPI)
      '2026-08-02', // invoice SK-0045
      '2026-08-03', // invoice SK-0046
      '2026-08-05' //  cash receipt SK-0045
    ]);
    // Payments are NOT hidden between invoices:
    const types = s.rows.map((r) => r.type);
    expect(types.filter((t) => t === 'payment')).toHaveLength(3);
    // Only in-period entries: SK-0041 (20-Jul) and SK-0047 (10-Aug) excluded.
    expect(s.rows).toHaveLength(8);
  });

  it('running balance is recomputed row by row from the opening balance', () => {
    const s = buildCustomerStatement(CUSTOMER, LEDGER, INVOICES, PAYMENTS, '2026-07-27', '2026-08-08');
    // 12000 +8000 -3000 +5000 +3000 -2000 +10000 +2000 -5000
    const expected = [20000, 17000, 22000, 25000, 23000, 33000, 35000, 30000];
    expect(s.rows.map((r) => r.balanceAfter)).toEqual(expected);
  });

  it('closing balance = opening + in-period amounts (current outstanding at period end)', () => {
    const s = buildCustomerStatement(CUSTOMER, LEDGER, INVOICES, PAYMENTS, '2026-07-27', '2026-08-08');
    expect(s.closingBalance).toBe(30000);
    expect(s.totalDebit).toBe(28000); // 8000+5000+3000+10000+2000
    expect(s.totalCredit).toBe(10000); // 3000+2000+5000
  });

  it('a full-history range (start <= first entry) gives opening balance 0', () => {
    const s = buildCustomerStatement(CUSTOMER, LEDGER, INVOICES, PAYMENTS, '2026-07-01', '2026-08-12');
    expect(s.openingBalance).toBe(0);
    expect(s.rows[0].date).toBe('2026-07-20');
    // All debits (44000) minus all payments (10000): the full account balance.
    expect(s.closingBalance).toBe(34000);
  });

  it('invoice rows carry their individual items; payment rows carry the method', () => {
    const s = buildCustomerStatement(CUSTOMER, LEDGER, INVOICES, PAYMENTS, '2026-07-27', '2026-08-08');
    const invRow = s.rows.find((r) => r.type === 'invoice' && r.invoiceNumber === 'SK-0042')!;
    expect(invRow.items).toHaveLength(1);
    expect(invRow.items![0]).toMatchObject({ label: 'Flex', rate: 7.5, amount: 750 });

    const payUPI = s.rows.find((r) => r.type === 'payment' && r.date === '2026-07-30')!;
    expect(payUPI.method).toBe('UPI');
    expect(payUPI.description).toContain('UPI');
    const payCash = s.rows.find((r) => r.type === 'payment' && r.date === '2026-08-05')!;
    expect(payCash.method).toBe('Cash');
    expect(payCash.credit).toBe(5000);
    expect(payCash.debit).toBe(0);
  });

  it('payments use their Payment Date, invoices their Bill Date (never recording time)', () => {
    expect(entryBusinessDate(LEDGER[1], INVOICES)).toBe('2026-07-27'); // invoice bill date
    expect(entryBusinessDate(LEDGER[2], INVOICES)).toBe('2026-07-27'); // payment date
    // A backdated bill recorded later still sorts by its Bill Date:
    const late = invEntry({ id: 'lz', invoiceId: 'i7', invoiceNumber: 'SK-0047', amount: 4000, date: '2026-08-12T09:00:00.000Z' });
    const s = buildCustomerStatement(CUSTOMER, [...LEDGER.filter((e) => e.id !== 'l10'), late], INVOICES, PAYMENTS, '2026-08-10', '2026-08-12');
    expect(s.rows.map((r) => r.date)).toEqual(['2026-08-10']);
    expect(s.rows[0].invoiceNumber).toBe('SK-0047');
  });

  it('an empty range yields opening == closing with no rows', () => {
    const s = buildCustomerStatement(CUSTOMER, LEDGER, INVOICES, PAYMENTS, '2026-09-01', '2026-09-30');
    expect(s.rows).toHaveLength(0);
    expect(s.openingBalance).toBe(34000); // the whole ledger is before September
    expect(s.closingBalance).toBe(34000);
  });

  it('customer isolation: only that customer’s entries are used', () => {
    const other: LedgerEntry = {
      ...invEntry({ id: 'lx', invoiceId: 'i2', invoiceNumber: 'SK-0042', amount: 8000, date: '2026-07-27T09:00:00.000Z' }),
      customerId: 'other-user'
    };
    const s = buildCustomerStatement(CUSTOMER, [...LEDGER, other], INVOICES, PAYMENTS, '2026-07-27', '2026-08-08');
    expect(s.rows).toHaveLength(8); // the other customer's entry never appears
  });

  it('invoice-edit adjustments are FOLDED into the invoice row — the statement never shows "edited" entries', () => {
    // A legacy adjustment left by the old edit flow: SK-0042 was 8000, edited
    // down by 500. The statement must show ONLY the corrected invoice value.
    const adj: LedgerEntry = {
      id: 'la',
      customerId: 'c1',
      type: 'adjustment',
      date: '2026-07-28T09:00:00.000Z',
      paymentDate: '',
      description: 'Invoice SK-0042 edited (balance reduced by 500)',
      invoiceId: 'i2',
      invoiceNumber: 'SK-0042',
      amount: -500,
      balanceAfter: 0,
      createdAt: '2026-07-28T09:00:00.000Z'
    };
    const s = buildCustomerStatement(CUSTOMER, [...LEDGER, adj], INVOICES, PAYMENTS, '2026-07-27', '2026-08-08');
    // No separate adjustment / "edited" row anywhere:
    expect(s.rows.some((r) => r.key === 'la')).toBe(false);
    expect(s.rows.some((r) => r.type === 'adjustment')).toBe(false);
    // SK-0042 shows its FINAL corrected value (8000 − 500 = 7500):
    const row = s.rows.find((r) => r.invoiceNumber === 'SK-0042')!;
    expect(row.type).toBe('invoice');
    expect(row.debit).toBe(7500);
    expect(row.credit).toBe(0);
    expect(row.date).toBe('2026-07-27'); // the invoice's Bill Date
    // Running balance stays exactly equal to the raw ledger sum (nothing lost):
    expect(s.totalDebit).toBe(27500); // 28000 − 500
    expect(s.closingBalance).toBe(29500); // 30000 − 500
  });

  it('a netted-down invoice still carries its corrected items', () => {
    const adj: LedgerEntry = {
      id: 'la2',
      customerId: 'c1',
      type: 'adjustment',
      date: '2026-07-28T09:00:00.000Z',
      paymentDate: '',
      description: 'Invoice SK-0042 edited (balance reduced by 500)',
      invoiceId: 'i2',
      invoiceNumber: 'SK-0042',
      amount: -500,
      balanceAfter: 0,
      createdAt: '2026-07-28T09:00:00.000Z'
    };
    const s = buildCustomerStatement(CUSTOMER, [...LEDGER, adj], INVOICES, PAYMENTS, '2026-07-27', '2026-08-08');
    const row = s.rows.find((r) => r.invoiceNumber === 'SK-0042')!;
    expect(row.items).toHaveLength(1);
    expect(row.items![0]).toMatchObject({ label: 'Flex', rate: 7.5, amount: 750 });
  });
});

describe('statement export filenames — customer + date range', () => {
  it('DD-MM-YYYY format with customer name: 27-07-2026_To_08-08-2026_Manipasanga_Flex.pdf', () => {
    expect(formatFilenameDate('2026-07-27')).toBe('27-07-2026');
    expect(formatFilenameDate('2026-08-08')).toBe('08-08-2026');
    expect(statementFileName('2026-07-27', '2026-08-08', 'Manipasanga Flex', 'pdf')).toBe(
      '27-07-2026_To_08-08-2026_Manipasanga_Flex.pdf'
    );
    expect(statementFileName('2026-07-27', '2026-08-08', 'Manipasanga Flex', 'jpg')).toBe(
      '27-07-2026_To_08-08-2026_Manipasanga_Flex.jpg'
    );
  });

  it('unsafe customer characters become underscores; no generic names', () => {
    const name = 'Flex & Sign "Shop" / Salem';
    const f = statementFileName('2026-07-27', '2026-08-08', name, 'pdf');
    expect(f).toMatch(/^27-07-2026_To_08-08-2026_/);
    expect(f.endsWith('.pdf')).toBe(true);
    expect(f).not.toContain('&');
    expect(f).not.toContain('"');
    expect(f).not.toContain('/');
    expect(f).not.toBe('download.pdf');
    expect(f).not.toBe('invoice.jpg');
  });
});
