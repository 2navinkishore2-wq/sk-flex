/**
 * Supplier bill scanning — OCR text → editable draft.
 *
 * This module is pure (no DOM, no OCR engine) so every heuristic is unit
 * tested: header fields, roll-wise lines, rate units, totals and the
 * "distinct lines for two 10-ft rolls and one 8-ft roll" case.
 *
 * The OCR engine itself lives in lib/ocr.ts and is optional: when it is
 * unavailable the UI still lets the user paste/type the bill text or enter
 * everything manually — parsing never depends on a network service.
 */

import { MATERIAL_TYPES, type MaterialType, type RateUnit, type SupplierBillLine } from './types';
import { expectedLineAmount, round2 } from '../services/inventory';

export interface ParsedBill {
  supplierName: string;
  billNumber: string;
  billDate: string;
  lines: SupplierBillLine[];
  vehicleCharge: number;
  /** Total printed on the bill (0 when nothing readable). */
  printedTotal: number;
  rawText: string;
  flags: string[];
}

const NUM = String.raw`(\d[\d,]*(?:\.\d{1,2})?)`;

export function parseAmount(raw: string | undefined | null): number {
  if (!raw) return NaN;
  const cleaned = String(raw).replace(/[^\d.]/g, '');
  if (!cleaned) return NaN;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

/** Parse the common Indian bill date formats into YYYY-MM-DD. */
export function parseLooseDate(raw: string): string {
  if (!raw) return '';
  const text = String(raw).trim();
  // ISO first
  let m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (m) return iso(m[1], m[2], m[3]);
  // dd/mm/yyyy, dd-mm-yy, dd.mm.yyyy
  m = /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/.exec(text);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return iso(year, m[2], m[1]);
  }
  return '';
}

function iso(y: string, mo: string, d: string): string {
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return '';
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function detectMaterialType(text: string): MaterialType {
  const t = text.toLowerCase();
  const known: { needle: string; type: MaterialType }[] = [
    { needle: 'flex', type: 'Flex' },
    { needle: 'vinyl', type: 'Vinyl' },
    { needle: 'star', type: 'Star' },
    { needle: 'sunpack', type: 'Sunpack' },
    { needle: 'frame', type: 'Frame' }
  ];
  for (const k of known) if (t.includes(k.needle)) return k.type;
  if (/banner|backlit|star flex|one\s*star/.test(t)) return 'Star';
  if (/sun\s*board|sunboard/.test(t)) return 'Sunpack';
  if (MATERIAL_TYPES.some((m) => t.includes(m.toLowerCase()))) {
    return MATERIAL_TYPES.find((m) => t.includes(m.toLowerCase())) as MaterialType;
  }
  return 'Other';
}

/** Roll size in feet from "10 ft", "10ft roll", `10'`, "8 feet". */
export function parseRollSize(text: string): number {
  const m = new RegExp(String.raw`(\d+(?:\.\d+)?)\s*(?:ft\.?|feet|foot|')\b`, 'i').exec(text);
  if (m) return Number(m[1]);
  return 0;
}

function stripRollSize(text: string): string {
  return text.replace(new RegExp(String.raw`\d+(?:\.\d+)?\s*(?:ft\.?|feet|foot|')`, 'gi'), ' ');
}

function numbersIn(text: string): number[] {
  const out: number[] = [];
  const re = new RegExp(NUM, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const n = parseAmount(m[1]);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

function explicitUnit(text: string): RateUnit | null {
  const t = text.toLowerCase();
  if (/(?:per|\/)\s*(?:sq\.?\s*ft|square\s*foot)/.test(t)) return 'sqft';
  if (/(?:per|\/)\s*(?:ft|foot|feet)\b/.test(t)) return 'foot';
  if (/(?:per|\/)\s*(?:m|mtr|metre|meter)\b/.test(t)) return 'metre';
  if (/(?:per|\/)\s*(?:roll|piece|pc|nos?)\b/.test(t)) return 'roll';
  return null;
}

/**
 * Decide whether a rate is per roll or per foot.
 * Returns `ambiguous: true` whenever the bill text does not say, which the UI
 * must surface for review before stock is created.
 */
export function resolveRateUnit(
  text: string,
  rate: number,
  quantity: number,
  amount: number,
  rollSizeFt: number
): { unit: RateUnit; ambiguous: boolean } {
  const explicit = explicitUnit(text);
  if (explicit) return { unit: explicit, ambiguous: false };
  if (!(rate > 0)) return { unit: 'roll', ambiguous: false };

  if (amount > 0 && quantity > 0) {
    const asRoll = round2(quantity * rate);
    const asFoot = round2(quantity * rate * (rollSizeFt || 0));
    const rollMatch = Math.abs(asRoll - amount) <= 0.5;
    const footMatch = rollSizeFt > 0 && Math.abs(asFoot - amount) <= 0.5;
    if (rollMatch && !footMatch) return { unit: 'roll', ambiguous: false };
    if (footMatch && !rollMatch) return { unit: 'foot', ambiguous: false };
    return { unit: 'roll', ambiguous: true };
  }

  // No amount to cross-check. A per-foot rate for roll material is small.
  if (rollSizeFt > 0 && rate <= 100) return { unit: 'foot', ambiguous: true };
  return { unit: 'roll', ambiguous: true };
}

function parseQuantity(text: string, quantityHint?: string): number {
  if (quantityHint) {
    const n = parseAmount(quantityHint);
    if (Number.isFinite(n)) return n;
  }
  const qty = /(?:qty|quantity|nos?\.?|pcs?\.?|rolls?)\s*[:\-]?\s*(\d+(?:\.\d+)?)/i.exec(text);
  if (qty) return Number(qty[1]);
  // "10 ft x 2" / "8ft roll - 1"
  const x = /\bx\s*(\d+(?:\.\d+)?)\b/i.exec(text);
  if (x) return Number(x[1]);
  const lead = /^\s*(\d+(?:\.\d+)?)\s*(?:x|nos?|pcs?|rolls?)\b/i.exec(text);
  if (lead) return Number(lead[1]);
  return 0;
}

export function isLikelyBillLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (/^(total|sub\s*total|grand\s*total|tax|gst|vehicle|transport|freight|cartage|delivery|thank|for\s+sk|signature|amount\s+in\s+words)/i.test(t)) {
    return false;
  }
  return /(?:\d+(?:\.\d+)?\s*(?:ft\.?|feet|foot|')|roll|flex|vinyl|star|sunpack|frame|sq\.?\s*ft)/i.test(t);
}

/** Parse one OCR line into a stock line (or null when it isn't one). */
export function parseBillLine(line: string, index = 0): SupplierBillLine | null {
  if (!isLikelyBillLine(line)) return null;
  const original = line.trim();
  const rollSizeFt = parseRollSize(original);
  const quantity = parseQuantity(original);
  const withoutSize = stripRollSize(original);
  const nums = numbersIn(withoutSize);
  // Remove quantities that were already used so they can't be read as money.
  const money = nums.filter((n, i) => !(quantity > 0 && n === quantity && i === 0));

  let rate = NaN;
  let amount = NaN;
  if (money.length >= 2) {
    rate = money[money.length - 2];
    amount = money[money.length - 1];
  } else if (money.length === 1) {
    amount = money[0];
    if (quantity > 0) rate = amount / quantity;
  }

  const { unit, ambiguous } = resolveRateUnit(original, rate, quantity, amount, rollSizeFt);

  if (!Number.isFinite(rate) && Number.isFinite(amount) && quantity > 0) {
    rate = amount / quantity;
  }
  if (!Number.isFinite(amount) && Number.isFinite(rate) && quantity > 0) {
    amount = round2(quantity * rate * (unit === 'foot' ? rollSizeFt : 1));
  }

  const flags: string[] = [];
  if (!(rollSizeFt > 0) || !(quantity > 0) || !Number.isFinite(rate)) flags.push('unreadable');
  if (ambiguous) flags.push('ambiguous-unit');

  const description = original
    .replace(/[|]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\d.,]+\s*$/g, '')
    .trim();

  const materialType = detectMaterialType(original);

  const lineOut: SupplierBillLine = {
    key: `scan-${index}-${Math.random().toString(36).slice(2, 7)}`,
    materialType,
    description: description || `${materialType} ${rollSizeFt || ''}ft`.trim(),
    rollSizeFt: rollSizeFt || 0,
    quantity: quantity || 0,
    rate: Number.isFinite(rate) ? round2(rate) : 0,
    rateUnit: unit,
    amount: Number.isFinite(amount) ? round2(amount) : expectedLineAmount({
      key: '',
      materialType,
      description: '',
      rollSizeFt,
      quantity,
      rate: Number.isFinite(rate) ? rate : 0,
      rateUnit: unit,
      amount: 0
    })
  };
  if (flags.length) lineOut.flags = flags;
  return lineOut;
}

function firstMatch(text: string, re: RegExp): string {
  const m = re.exec(text);
  return m ? (m[1] || '').trim() : '';
}

function lastAmount(re: RegExp, text: string): number {
  let value = NaN;
  let m: RegExpExecArray | null;
  const global = new RegExp(re.source, 'gi');
  while ((m = global.exec(text))) {
    const n = parseAmount(m[1]);
    if (Number.isFinite(n)) value = n;
  }
  return value;
}

/** Parse full OCR/typed bill text into a reviewable draft. */
export function parseBillText(rawText: string): ParsedBill {
  const text = String(rawText || '').replace(/\r/g, '');
  const lines = text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim());

  const supplierName =
    firstMatch(text, /(?:supplier|seller|party|shop\s*name|from)\s*[:\-]\s*([^\n]+)/i) ||
    lines.find((l) => l.length >= 3 && l.length <= 48 && /[a-zA-Z]{3}/.test(l) && !/(invoice|bill|tax|gst|date|no\.|phone|address)/i.test(l)) ||
    '';

  const billNumber = firstMatch(text, /(?:bill|invoice|inv)\s*(?:no\.?|number|#)\s*[:\-]?\s*([A-Za-z0-9][\w\-\/]{0,24})/i);
  const billDate =
    parseLooseDate(firstMatch(text, /(?:date|dt)\s*[:\-]?\s*([^\n]+)/i)) ||
    parseLooseDate(firstMatch(text, /(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/));

  const vehicleCharge = Number.isFinite(
    lastAmount(/(?:vehicle|transport|freight|cartage|delivery|loading)\s*(?:charge|charges|amount|rs\.?)?\s*[:\-]?\s*(?:rs\.?|₹)?\s*(\d[\d,]*(?:\.\d{1,2})?)/i, text)
  )
    ? lastAmount(/(?:vehicle|transport|freight|cartage|delivery|loading)\s*(?:charge|charges|amount|rs\.?)?\s*[:\-]?\s*(?:rs\.?|₹)?\s*(\d[\d,]*(?:\.\d{1,2})?)/i, text)
    : 0;

  let printedTotal = lastAmount(/(?:grand\s*total|net\s*amount|total\s*amount|total)\s*[:\-]?\s*(?:rs\.?|₹)?\s*(\d[\d,]*(?:\.\d{1,2})?)/i, text);
  if (!Number.isFinite(printedTotal)) printedTotal = 0;

  const parsedLines = lines
    .map((l, i) => parseBillLine(l, i))
    .filter((l): l is SupplierBillLine => !!l && (l.rollSizeFt > 0 || l.quantity > 0));

  // Never treat the printed purchase total as material quantity/cost
  // double-count: lines are independent records of stock.
  const flags: string[] = [];
  if (!supplierName) flags.push('Supplier name could not be read.');
  if (!billNumber) flags.push('Bill number could not be read.');
  if (!billDate) flags.push('Bill date could not be read.');
  if (parsedLines.length === 0) flags.push('No material lines found — enter them manually.');
  if (parsedLines.some((l) => (l.flags || []).includes('ambiguous-unit'))) {
    flags.push('Some rates may be per roll or per foot — please confirm.');
  }

  return {
    supplierName,
    billNumber,
    billDate,
    lines: parsedLines,
    vehicleCharge: round2(vehicleCharge),
    printedTotal: round2(printedTotal),
    rawText: text,
    flags
  };
}

/** Empty manual line for the Stock In form. */
export function emptyBillLine(index = 0): SupplierBillLine {
  return {
    key: `line-${Date.now().toString(36)}-${index}`,
    materialType: 'Flex',
    description: '',
    rollSizeFt: 10,
    quantity: 1,
    rate: 0,
    rateUnit: 'roll',
    amount: 0
  };
}
