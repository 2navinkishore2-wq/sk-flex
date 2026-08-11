// @vitest-environment jsdom
/* Frame Price Settings tests (demo/localStorage backend):
 * editing sizes and rates, adding/deleting rows, empty = not offered (null),
 * duplicate-size prevention, persistence after reopen, and the calculator
 * consuming the same saved table (one source of truth). */
import { beforeEach, describe, expect, it } from 'vitest';
import { LocalDataService } from './services/localService';
import { saveFramePrices, listFramePrices, validateFramePrice, type FramePriceInput, type FramePriceRowInput } from './services/settings';
import { calcFrameAmount, findFramePrice, framePriceFor } from './lib/billing';
import type { FramePrice } from './lib/types';

async function setup() {
  const svc = new LocalDataService();
  await svc.signInDemo('Shop Owner');
  return { svc };
}

function rowInput(f: FramePrice): FramePriceRowInput {
  return {
    id: f.id,
    size: f.size,
    beading: f.beading,
    oneInch: f.oneInch,
    onePointFiveInch: f.onePointFiveInch,
    twoInch: f.twoInch,
    active: f.active
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('frame price settings', () => {
  it('changing a rate persists after closing/reopening the app', async () => {
    const { svc } = await setup();
    const row = (await listFramePrices(svc)).find((r) => r.size === '12x18')!;
    await saveFramePrices(svc, [{ ...rowInput(row), beading: 300 }]);
    // reopen = a fresh service instance reads localStorage again
    const reopened = await listFramePrices(new LocalDataService());
    expect(reopened.find((r) => r.size === '12x18')?.beading).toBe(300);
    expect(reopened.find((r) => r.size === '12x18')?.oneInch).toBe(350); // untouched
  });

  it('changing the SIZE is saved (12x18 -> 12x14)', async () => {
    const { svc } = await setup();
    const row = (await listFramePrices(svc)).find((r) => r.size === '12x18')!;
    await saveFramePrices(svc, [{ ...rowInput(row), size: '12x14' }]);
    const after = await listFramePrices(new LocalDataService());
    expect(after.some((p) => p.size === '12x14')).toBe(true);
    expect(after.some((p) => p.size === '12x18')).toBe(false);
  });

  it('duplicate sizes are rejected', async () => {
    const { svc } = await setup();
    const a = (await listFramePrices(svc)).find((r) => r.size === '8x6')!;
    const b = (await listFramePrices(svc)).find((r) => r.size !== '8x6')!;
    await expect(
      saveFramePrices(svc, [
        { ...rowInput(a), size: '8x6' },
        { ...rowInput(b), size: '8x6' }
      ])
    ).rejects.toThrow(/already exists/i);
  });

  it('empty price stays null — never converted to 0', async () => {
    const { svc } = await setup();
    const row = (await listFramePrices(svc)).find((r) => r.size === '12x18')!;
    await saveFramePrices(svc, [{ ...rowInput(row), beading: null, onePointFiveInch: null }]);
    const saved = (await listFramePrices(new LocalDataService())).find((r) => r.size === '12x18')!;
    expect(saved.beading).toBeNull();
    expect(saved.onePointFiveInch).toBeNull();
    expect(saved.oneInch).toBe(350);
  });

  it('adds a new size row and deletes an existing one in one save', async () => {
    const { svc } = await setup();
    const before = await listFramePrices(svc);
    const row = before.find((r) => r.size === '36x48')!;
    const keep = before.filter((r) => r.id !== row.id).map(rowInput);
    await saveFramePrices(
      svc,
      [...keep, { size: '12x12', beading: 150, oneInch: 220, onePointFiveInch: null, twoInch: null, active: true }],
      [row.id]
    );
    const after = await listFramePrices(new LocalDataService());
    expect(after.some((p) => p.size === '12x12')).toBe(true);
    expect(after.some((p) => p.size === '36x48')).toBe(false);
    expect(after).toHaveLength(before.length); // 18 kept + 1 added - 1 deleted
  });

  it('validates size and price fields', () => {
    const base: FramePriceInput = { size: '12x18', beading: null, oneInch: null, onePointFiveInch: null, twoInch: null, active: true };
    expect(validateFramePrice({ ...base, size: '' })).toMatch(/empty/i);
    expect(validateFramePrice({ ...base, size: 'abc' })).toMatch(/12x18/i);
    expect(validateFramePrice({ ...base, beading: -5 })).toMatch(/positive/i);
    expect(validateFramePrice({ ...base, beading: 0 })).toMatch(/positive/i);
    expect(validateFramePrice(base)).toBeNull();
    expect(validateFramePrice({ ...base, twoInch: 450 })).toBeNull();
  });

  it('calculator uses the saved table — changing a rate changes the billed price', async () => {
    const { svc } = await setup();
    // Reference value: 12x18 Beeding = ₹255
    expect(framePriceFor(await listFramePrices(svc), '12x18', 'beading')).toBe(255);
    await saveFramePrices(svc, [
      { ...rowInput((await listFramePrices(svc)).find((r) => r.size === '12x18')!), beading: 310 }
    ]);
    const after = await listFramePrices(svc);
    expect(framePriceFor(after, '12x18', 'beading')).toBe(310);
    expect(findFramePrice(after, '12x18')?.beading).toBe(310);
    expect(calcFrameAmount(framePriceFor(after, '12x18', 'beading')!, 2)).toBe(620);
    // An unoffered thickness stays null for the calculator too.
    expect(framePriceFor(after, '8x6', 'twoInch')).toBeNull();
  });
});
