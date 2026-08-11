import { describe, expect, it } from 'vitest';
import { formatDate, formatINR, groupIndian } from './format';

describe('INR formatting', () => {
  it('Indian digit grouping', () => {
    expect(groupIndian(750)).toBe('750');
    expect(groupIndian(5000)).toBe('5,000');
    expect(groupIndian(125000)).toBe('1,25,000');
    expect(groupIndian(1234567.5)).toBe('12,34,567.50');
  });

  it('formatINR prefix', () => {
    expect(formatINR(750)).toBe('₹750');
    expect(formatINR(1234567.5)).toBe('₹12,34,567.50');
    expect(formatINR(0)).toBe('₹0');
  });
});

describe('date formatting', () => {
  it('YYYY-MM-DD -> DD Mon YYYY', () => {
    expect(formatDate('2026-08-10')).toBe('10 Aug 2026');
    expect(formatDate('2026-01-01')).toBe('1 Jan 2026');
  });
});
