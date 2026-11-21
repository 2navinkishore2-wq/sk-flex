import type { AppearanceSettings, BusinessSettings, FramePrice, ProductRates } from '../lib/types';
import { DEFAULT_RATES, DEFAULT_SETTINGS } from '../lib/constants';
import { nowISO } from '../lib/format';
import { FRAME_THICKNESS_COLUMNS, normalizeFrameSize, type FrameThicknessKey } from '../lib/billing';
import type { DataService } from './data';

const BUSINESS_DOC = 'business';
const RATES_DOC = 'rates';
const APPEARANCE_DOC = 'appearance';

export async function getBusinessSettings(svc: DataService): Promise<BusinessSettings> {
  const doc = await svc.get<{ id: string } & Partial<BusinessSettings>>('settings', BUSINESS_DOC);
  return { ...DEFAULT_SETTINGS, ...(doc ? omitId(doc) : {}) };
}

export async function saveBusinessSettings(svc: DataService, s: BusinessSettings): Promise<void> {
  await svc.set('settings', BUSINESS_DOC, {
    address: s.address,
    phone: s.phone,
    email: s.email,
    gst: s.gst,
    invoicePrefix: (s.invoicePrefix || 'SK').trim(),
    footer: s.footer,
    paymentNote: s.paymentNote,
    showRateOnInvoice: !!s.showRateOnInvoice
  });
}

export async function getProductRates(svc: DataService): Promise<ProductRates> {
  const doc = await svc.get<{ id: string } & Partial<ProductRates>>('settings', RATES_DOC);
  return { ...DEFAULT_RATES, ...(doc ? omitId(doc) : {}) };
}

export async function saveProductRates(svc: DataService, rates: ProductRates): Promise<void> {
  const clean: ProductRates = {
    flex: Number(rates.flex) || DEFAULT_RATES.flex,
    vinyl: Number(rates.vinyl) || DEFAULT_RATES.vinyl,
    star: Number(rates.star) || DEFAULT_RATES.star,
    sunpack: Number(rates.sunpack) || DEFAULT_RATES.sunpack
  };
  await svc.set('settings', RATES_DOC, clean as unknown as Record<string, unknown>);
}

/* ------------------------------------------------------------- appearance */

/** Read the account's saved theme (null when never chosen on any device). */
export async function getAppearance(svc: DataService): Promise<AppearanceSettings | null> {
  const doc = await svc.get<{ id: string } & Partial<AppearanceSettings>>('settings', APPEARANCE_DOC);
  if (!doc || typeof doc.theme !== 'string') return null;
  return { theme: doc.theme };
}

/** Persist the selected theme to the signed-in account (syncs across devices). */
export async function saveAppearance(svc: DataService, settings: AppearanceSettings): Promise<void> {
  await svc.set('settings', APPEARANCE_DOC, { theme: settings.theme });
}

// ----------------------------------------------------------------- frame prices

export type { FrameThicknessKey };


export interface FramePriceInput {
  size: string;
  beading: number | null;
  oneInch: number | null;
  onePointFiveInch: number | null;
  twoInch: number | null;
  active: boolean;
}

/** One editable row; `id` is present for existing rows, absent for new ones. */
export interface FramePriceRowInput extends FramePriceInput {
  id?: string;
}

/**
 * Validate one row. `existingSizes` are the OTHER sizes in the same table
 * (used to prevent accidental duplicates). Prices must be null or positive.
 */
export function validateFramePrice(
  input: FramePriceInput,
  existingSizes: string[] = []
): string | null {
  const size = normalizeFrameSize(input.size);
  if (!size) return 'Size cannot be empty.';
  if (!/^\d+x\d+$/.test(size)) return 'Size must look like "12x18" (width × height in inches).';
  if (existingSizes.some((s) => normalizeFrameSize(s) === size)) {
    return `Size "${input.size.trim()}" already exists.`;
  }
  for (const [label, v] of FRAME_THICKNESS_COLUMNS.map((c) => [c.label, input[c.key]] as const)) {
    if (v !== null && (!Number.isFinite(v) || v <= 0)) {
      return `${label} must be a positive number, or empty when not offered.`;
    }
  }
  return null;
}

function sizeArea(size: string): number {
  const [w, h] = size.split('x').map(Number);
  return (Number.isFinite(w) ? w : 0) * (Number.isFinite(h) ? h : 0);
}

/** Frame prices ordered by size (smallest area first). */
export async function listFramePrices(svc: DataService): Promise<FramePrice[]> {
  const list = await svc.query<FramePrice>('frameRates');
  return list.sort((a, b) => sizeArea(a.size) - sizeArea(b.size) || a.size.localeCompare(b.size));
}

export async function addFramePrice(svc: DataService, input: FramePriceInput): Promise<void> {
  const err = validateFramePrice(input);
  if (err) throw new Error(err);
  await svc.add('frameRates', {
    size: normalizeFrameSize(input.size),
    beading: input.beading,
    oneInch: input.oneInch,
    onePointFiveInch: input.onePointFiveInch,
    twoInch: input.twoInch,
    active: input.active
  });
}

export async function updateFramePrice(svc: DataService, id: string, input: FramePriceInput): Promise<void> {
  const err = validateFramePrice(input);
  if (err) throw new Error(err);
  await svc.set('frameRates', id, {
    size: normalizeFrameSize(input.size),
    beading: input.beading,
    oneInch: input.oneInch,
    onePointFiveInch: input.onePointFiveInch,
    twoInch: input.twoInch,
    active: input.active,
    updatedAt: nowISO()
  });
}

export async function deleteFramePrice(svc: DataService, id: string): Promise<void> {
  await svc.delete('frameRates', id);
}

/**
 * Save a whole frame-price table in one action: validates everything first
 * (so a bad row never partially saves), then updates existing rows, adds new
 * ones and removes deleted ids.
 */
export async function saveFramePrices(
  svc: DataService,
  rows: FramePriceRowInput[],
  deletedIds: string[] = []
): Promise<void> {
  const normalized = rows.map((r) => ({ ...r, size: normalizeFrameSize(r.size) }));
  for (let i = 0; i < normalized.length; i++) {
    // Every OTHER row's size (by index, so equal sizes can't cancel out).
    const others = normalized.filter((_, j) => j !== i).map((x) => x.size);
    const err = validateFramePrice(normalized[i], others);
    if (err) throw new Error(err);
  }
  for (const r of normalized) {
    if (r.id) await updateFramePrice(svc, r.id, r);
    else await addFramePrice(svc, r);
  }
  for (const id of deletedIds) {
    await svc.delete('frameRates', id);
  }
}

function omitId<T>(doc: T & { id: string }): Omit<T, 'id'> {
  const { id: _id, ...rest } = doc;
  return rest;
}
