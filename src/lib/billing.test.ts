import { describe, expect, it } from 'vitest';
import {
  calcArea,
  calcCustomAmount,
  calcDimensionAmount,
  calcFrameAmount,
  findFramePrice,
  formatInvoiceNumber,
  framePriceFor,
  invoiceStatus,
  invoiceTotals,
  parseInvoiceNumber
} from './billing';
import type { FramePrice, InvoiceItem } from './types';

describe('dimension calculations', () => {
  it('Flex 10x10 @ ₹7.50 = ₹750 (the core requirement)', () => {
    expect(calcArea(10, 10)).toBe(100);
    expect(calcDimensionAmount(10, 10, 7.5)).toBe(750);
  });

  it('Vinyl 5x4 @ ₹25 = ₹500', () => {
    expect(calcArea(5, 4)).toBe(20);
    expect(calcDimensionAmount(5, 4, 25)).toBe(500);
  });

  it('handles decimals without rounding errors', () => {
    // 3.3 x 2.2 = 7.26 sq.ft; 7.26 x 7.5 = 54.45
    expect(calcArea(3.3, 2.2)).toBe(7.26);
    expect(calcDimensionAmount(3.3, 2.2, 7.5)).toBe(54.45);
  });

  it('multiplies by quantity', () => {
    expect(calcDimensionAmount(10, 10, 7.5, 2)).toBe(1500);
  });

  it('custom item rate x qty', () => {
    expect(calcCustomAmount(80, 5)).toBe(400);
    expect(calcCustomAmount(500, 1)).toBe(500);
  });
});

describe('frame price table (size x thickness)', () => {
  const prices: FramePrice[] = [
    { id: '1', size: '12x18', beading: 255, oneInch: 350, onePointFiveInch: 400, twoInch: 450, active: true, createdAt: '', updatedAt: '' },
    { id: '2', size: '8x6', beading: 70, oneInch: 130, onePointFiveInch: null, twoInch: null, active: true, createdAt: '', updatedAt: '' },
    { id: '3', size: '12x24', beading: 420, oneInch: 560, onePointFiveInch: 610, twoInch: 660, active: false, createdAt: '', updatedAt: '' }
  ];

  it('picks the row for a size (case / × tolerant)', () => {
    expect(findFramePrice(prices, '12x18')?.id).toBe('1');
    expect(findFramePrice(prices, '12X18')?.id).toBe('1');
    expect(findFramePrice(prices, '12×18')?.id).toBe('1');
  });

  it('ignores inactive rows and unknown sizes', () => {
    expect(findFramePrice(prices, '12x24')).toBeNull(); // inactive
    expect(findFramePrice(prices, '5x5')).toBeNull();
  });

  it('returns a price for an offered thickness, null for an unoffered one', () => {
    expect(framePriceFor(prices, '8x6', 'beading')).toBe(70);
    expect(framePriceFor(prices, '8x6', 'oneInch')).toBe(130);
    expect(framePriceFor(prices, '8x6', 'onePointFiveInch')).toBeNull();
    expect(framePriceFor(prices, '12x18', 'twoInch')).toBe(450);
  });

  it('calculates fixed per-frame amounts x qty', () => {
    expect(calcFrameAmount(400, 1)).toBe(400);
    expect(calcFrameAmount(450, 2)).toBe(900);
  });
});

describe('invoice totals & status', () => {
  const items: InvoiceItem[] = [
    { key: 'a', product: 'FLEX', label: 'Flex', width: 10, height: 10, area: 100, unit: 'sq.ft', qty: 1, rate: 7.5, amount: 750 },
    { key: 'b', product: 'CUSTOM', label: 'Installation', qty: 1, rate: 300, amount: 300, unit: 'Nos.' }
  ];

  it('subtotal = 1050, discount amount 50 -> total 1000', () => {
    const t = invoiceTotals(items, 'amount', 50);
    expect(t.subtotal).toBe(1050);
    expect(t.discount).toBe(50);
    expect(t.total).toBe(1000);
  });

  it('percent discount', () => {
    const t = invoiceTotals(items, 'percent', 10);
    expect(t.discount).toBe(105);
    expect(t.total).toBe(945);
  });

  it('status: credit / partial / paid', () => {
    expect(invoiceStatus(1000, 0)).toBe('credit');
    expect(invoiceStatus(1000, 500)).toBe('partial');
    expect(invoiceStatus(1000, 1000)).toBe('paid');
  });

  it('invoice number formatting and parsing', () => {
    expect(formatInvoiceNumber('SK', 1)).toBe('SK-0001');
    expect(formatInvoiceNumber('SK', 42)).toBe('SK-0042');
    expect(formatInvoiceNumber('', 7)).toBe('SK-0007');
    expect(parseInvoiceNumber('SK', 'SK-0042')).toBe(42);
    expect(parseInvoiceNumber('SK', 'ABC')).toBe(-1);
  });
});
