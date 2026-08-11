import Decimal from 'decimal.js';

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

/** Round to 2 decimal places (paise). */
export function round2(n: number): number {
  return new Decimal(n).toDecimalPlaces(2).toNumber();
}

export function mul(...ns: number[]): number {
  return ns.reduce((acc, n) => acc.mul(n), new Decimal(1)).toNumber();
}

export function add(...ns: number[]): number {
  return ns.reduce((acc, n) => acc.plus(n), new Decimal(0)).toNumber();
}

export function sub(a: number, b: number): number {
  return new Decimal(a).minus(b).toNumber();
}

export function sum(ns: number[]): number {
  return ns.reduce((acc, n) => acc.plus(n), new Decimal(0)).toNumber();
}

export function percentOf(value: number, percent: number): number {
  return new Decimal(value).mul(percent).div(100).toNumber();
}
