import type { DataService } from '../services/data';

/**
 * The REAL SK Photo Frame price list (supplied by the shop owner, from the
 * printed reference table). Sizes are photo sizes in inches; each column is
 * a frame-width/thickness option with a FIXED price per frame. `null` means
 * that thickness is NOT offered for that size — nothing is invented and no
 * missing price is converted to 0.
 */
export interface FramePriceSeed {
  size: string;
  beading: number | null;
  oneInch: number | null;
  onePointFiveInch: number | null;
  twoInch: number | null;
}

export const SK_PHOTO_FRAME_PRICES: FramePriceSeed[] = [
  { size: '8x6', beading: 70, oneInch: 130, onePointFiveInch: null, twoInch: null },
  { size: '10x8', beading: 110, oneInch: 175, onePointFiveInch: null, twoInch: null },
  { size: '12x8', beading: 125, oneInch: 200, onePointFiveInch: 240, twoInch: null },
  { size: '12x10', beading: 170, oneInch: 250, onePointFiveInch: 290, twoInch: null },
  { size: '10x15', beading: 190, oneInch: 260, onePointFiveInch: 300, twoInch: null },
  { size: '12x15', beading: 225, oneInch: 275, onePointFiveInch: 330, twoInch: null },
  { size: '12x18', beading: 255, oneInch: 350, onePointFiveInch: 400, twoInch: 450 },
  { size: '12x24', beading: 420, oneInch: 560, onePointFiveInch: 610, twoInch: 660 },
  { size: '12x30', beading: 500, oneInch: 675, onePointFiveInch: 775, twoInch: 825 },
  { size: '12x36', beading: 620, oneInch: 740, onePointFiveInch: 835, twoInch: 940 },
  { size: '16x20', beading: 565, oneInch: 670, onePointFiveInch: 770, twoInch: 910 },
  { size: '16x24', beading: 675, oneInch: 775, onePointFiveInch: 880, twoInch: 1020 },
  { size: '18x24', beading: 760, oneInch: 870, onePointFiveInch: 970, twoInch: 1120 },
  { size: '20x24', beading: 850, oneInch: 950, onePointFiveInch: 1050, twoInch: 1200 },
  { size: '20x30', beading: 1050, oneInch: 1160, onePointFiveInch: 1310, twoInch: 1600 },
  { size: '24x36', beading: 1515, oneInch: 1720, onePointFiveInch: 2110, twoInch: 2500 },
  { size: '30x40', beading: 2150, oneInch: 2680, onePointFiveInch: 2850, twoInch: 3350 },
  { size: '36x40', beading: 2550, oneInch: 3200, onePointFiveInch: 3500, twoInch: 3950 },
  { size: '36x48', beading: 3050, oneInch: 3850, onePointFiveInch: 4300, twoInch: 4800 }
];

/** Old (pre size-table) flat row: had `rate`/`minSize` and no `size` key. */
function isOldShape(doc: Record<string, unknown>): boolean {
  return !('size' in doc) && ('rate' in doc || 'minSize' in doc || 'rateType' in doc);
}

/**
 * Ensures the user-scoped frameRates collection holds the canonical size
 * table. Rules:
 *  - empty collection            -> seed the full reference table
 *  - old flat-row shape present  -> replace with the size table (migration)
 *  - already the size table      -> leave untouched (user edits preserved)
 * Best-effort; returns rows added (0 when already populated or failed).
 */
export async function seedFramePricesIfEmpty(svc: DataService): Promise<number> {
  try {
    const existing = await svc.query<Record<string, unknown> & { id: string }>('frameRates');
    const hasOld = existing.some(isOldShape);
    if (existing.length > 0 && !hasOld) return 0;
    if (hasOld) {
      // Migrate: the old 68 flat rows become the 19-row size table.
      for (const doc of existing) await svc.delete('frameRates', doc.id);
    }
    let added = 0;
    for (const p of SK_PHOTO_FRAME_PRICES) {
      await svc.add('frameRates', {
        size: p.size,
        beading: p.beading,
        oneInch: p.oneInch,
        onePointFiveInch: p.onePointFiveInch,
        twoInch: p.twoInch,
        active: true
      });
      added += 1;
    }
    return added;
  } catch {
    return 0;
  }
}
