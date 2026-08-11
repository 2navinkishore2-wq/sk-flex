import { describe, expect, it } from 'vitest';
import type { LedgerEntry } from './lib/types';
import { customerBalance, ledgerStats, totalOutstandingFromLedger } from './services/ledger';

function entry(partial: Partial<LedgerEntry> & { customerId: string; amount: number }): LedgerEntry {
  return {
    id: partial.id || `e${Math.random().toString(36).slice(2, 8)}`,
    type: partial.type || 'invoice',
    date: partial.date || '2026-08-11T00:00:00.000Z',
    paymentDate: partial.paymentDate || '',
    description: partial.description || '',
    invoiceId: partial.invoiceId || '',
    invoiceNumber: partial.invoiceNumber || '',
    balanceAfter: partial.balanceAfter ?? 0,
    createdAt: partial.createdAt || '2026-08-11T00:00:00.000Z',
    ...partial
  };
}

describe('totalOutstandingFromLedger — no ₹10,000 cap, exact totals', () => {
  const cases: { label: string; amounts: number[]; expected: number }[] = [
    { label: '₹0', amounts: [], expected: 0 },
    { label: '₹5,000', amounts: [5000], expected: 5000 },
    { label: '₹10,000 (exactly the old reported cap)', amounts: [10000], expected: 10000 },
    { label: '₹10,001 (just above the old reported cap)', amounts: [10001], expected: 10001 },
    { label: '₹15,000', amounts: [15000], expected: 15000 },
    { label: '₹25,000', amounts: [25000], expected: 25000 },
    { label: '₹50,000', amounts: [50000], expected: 50000 },
    { label: '₹1,00,000', amounts: [100000], expected: 100000 },
    { label: '₹2,50,000 across several invoices', amounts: [50000, 75000, 125000], expected: 250000 }
  ];

  it.each(cases)('single customer billed $label', ({ amounts, expected }) => {
    const entries = amounts.map((amount, i) => entry({ customerId: 'c1', amount, createdAt: `2026-08-11T00:00:0${i}.000Z` }));
    expect(totalOutstandingFromLedger(entries)).toBe(expected);
  });

  it('sums across multiple customers', () => {
    const entries = [
      entry({ customerId: 'c1', amount: 12000 }),
      entry({ customerId: 'c2', amount: 15000 }),
      entry({ customerId: 'c3', amount: 25000 })
    ];
    expect(totalOutstandingFromLedger(entries)).toBe(52000);
  });

  it('payments reduce outstanding: invoice 12,000 − payment 2,000 = 10,000', () => {
    const entries = [
      entry({ customerId: 'c1', amount: 12000, type: 'invoice' }),
      entry({ customerId: 'c1', amount: -2000, type: 'payment' })
    ];
    expect(totalOutstandingFromLedger(entries)).toBe(10000);
  });

  it('full payment → outstanding 0', () => {
    const entries = [
      entry({ customerId: 'c1', amount: 15000, type: 'invoice' }),
      entry({ customerId: 'c1', amount: -15000, type: 'payment' })
    ];
    expect(totalOutstandingFromLedger(entries)).toBe(0);
  });

  it('overpaid / credit customers do not reduce the total below zero', () => {
    const entries = [
      entry({ customerId: 'c1', amount: 10000, type: 'invoice' }),
      entry({ customerId: 'c1', amount: -12000, type: 'payment' }), // credit balance
      entry({ customerId: 'c2', amount: 25000, type: 'invoice' })
    ];
    expect(totalOutstandingFromLedger(entries)).toBe(25000);
  });

  it('order of entries NEVER matters (regression: Firestore returns doc-id order)', () => {
    // Two customers, each with invoice + payment entries. Same data, three
    // different array orders must produce the SAME total.
    const build = (): LedgerEntry[] => [
      entry({ id: 'a', customerId: 'c1', amount: 12000, type: 'invoice', createdAt: '2026-08-10T00:00:00.000Z', balanceAfter: 12000 }),
      entry({ id: 'b', customerId: 'c1', amount: -2000, type: 'payment', createdAt: '2026-08-11T00:00:00.000Z', balanceAfter: 10000 }),
      entry({ id: 'c', customerId: 'c2', amount: 15000, type: 'invoice', createdAt: '2026-08-12T00:00:00.000Z', balanceAfter: 15000 })
    ];
    const orders = [
      build(),
      [build()[2], build()[0], build()[1]],
      [build()[1], build()[2], build()[0]],
      [...build()].reverse()
    ];
    for (const o of orders) {
      // true receivable: (12000−2000) + 15000 = 25000 — never the stale
      // balanceAfter of an arbitrary entry (e.g. 12000 or 15000).
      expect(totalOutstandingFromLedger(o)).toBe(25000);
    }
  });

  it('adjustment entries (invoice edits) are included', () => {
    const entries = [
      entry({ customerId: 'c1', amount: 12000, type: 'invoice' }),
      entry({ customerId: 'c1', amount: 3000, type: 'adjustment' }), // balance increased by ₹3,000 on edit
      entry({ customerId: 'c1', amount: -5000, type: 'payment' })
    ];
    expect(totalOutstandingFromLedger(entries)).toBe(10000);
  });
});

describe('customerBalance / ledgerStats — order-independent per-customer balance', () => {
  it('balance equals the sum of amounts regardless of entry order', () => {
    const a = entry({ customerId: 'c1', amount: 12000, type: 'invoice', balanceAfter: 12000 });
    const b = entry({ customerId: 'c1', amount: -2000, type: 'payment', balanceAfter: 10000 });
    expect(customerBalance([a, b])).toBe(10000);
    expect(customerBalance([b, a])).toBe(10000);
    expect(ledgerStats([a, b]).balance).toBe(10000);
    expect(ledgerStats([b, a]).balance).toBe(10000);
  });

  it('ledgerStats billed/paid/count remain correct', () => {
    const stats = ledgerStats([
      entry({ customerId: 'c1', amount: 12000, type: 'invoice' }),
      entry({ customerId: 'c1', amount: 5000, type: 'invoice' }),
      entry({ customerId: 'c1', amount: -3000, type: 'payment' })
    ]);
    expect(stats.billed).toBe(17000);
    expect(stats.paid).toBe(3000);
    expect(stats.balance).toBe(14000);
    expect(stats.invoiceCount).toBe(2);
  });
});
