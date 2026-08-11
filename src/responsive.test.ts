// @vitest-environment node
/* Responsive layout regression tests. These mirror the media rules in
 * src/theme.css (via src/lib/responsive.ts) and pin the behavior that fixes
 * the landscape bug: touch devices (pointer: coarse) must NEVER get the
 * desktop centered 1180px column, and touch devices in landscape must get the
 * mobile chrome regardless of CSS width. Desktop (fine pointer) keeps the
 * centered column. */
import { describe, expect, it } from 'vitest';
import { resolveResponsiveLayout, type DeviceViewport } from './lib/responsive';

const phone = (w: number, h: number, coarse = true): DeviceViewport => ({ width: w, height: h, coarsePointer: coarse });

describe('portrait phones — unchanged mobile layout', () => {
  it('typical phone portrait (411x914) uses mobile chrome + full width', () => {
    expect(resolveResponsiveLayout(phone(411, 914))).toEqual({ chrome: 'mobile', pageWidth: 'full' });
  });

  it('phone portrait at 480x1040 still mobile + full width', () => {
    expect(resolveResponsiveLayout(phone(480, 1040))).toEqual({ chrome: 'mobile', pageWidth: 'full' });
  });
});

describe('landscape phones — full width, mobile chrome, at ANY CSS width', () => {
  it('narrow landscape phone (914x411) is mobile + full width', () => {
    expect(resolveResponsiveLayout(phone(914, 411))).toEqual({ chrome: 'mobile', pageWidth: 'full' });
  });

  it('wide landscape phone (1067x480, the previous fix range) is mobile + full width', () => {
    expect(resolveResponsiveLayout(phone(1067, 480))).toEqual({ chrome: 'mobile', pageWidth: 'full' });
  });

  it('landscape phone above 1279 CSS px (1549x832 @DPR1.25) is mobile + full width — THE regression this fix addresses', () => {
    expect(resolveResponsiveLayout(phone(1549, 832))).toEqual({ chrome: 'mobile', pageWidth: 'full' });
  });

  it('landscape phone at ~1936x1040 CSS (DPR 1.0 device) is mobile + full width — the video device case', () => {
    expect(resolveResponsiveLayout(phone(1936, 1040))).toEqual({ chrome: 'mobile', pageWidth: 'full' });
  });

  it('landscape phone at 1291x693 (DPR1.5) is mobile + full width', () => {
    expect(resolveResponsiveLayout(phone(1291, 693))).toEqual({ chrome: 'mobile', pageWidth: 'full' });
  });
});

describe('desktop — centered 1180px column preserved', () => {
  it('desktop 1440x900 keeps desktop chrome + centered 1180px column', () => {
    expect(resolveResponsiveLayout(phone(1440, 900, false))).toEqual({ chrome: 'desktop', pageWidth: 'centered-1180' });
  });

  it('desktop 1920x1080 keeps desktop chrome + centered 1180px column', () => {
    expect(resolveResponsiveLayout(phone(1920, 1080, false))).toEqual({ chrome: 'desktop', pageWidth: 'centered-1180' });
  });

  it('desktop 1366x768 keeps desktop chrome + centered 1180px column', () => {
    expect(resolveResponsiveLayout(phone(1366, 768, false))).toEqual({ chrome: 'desktop', pageWidth: 'centered-1180' });
  });
});

describe('tablets — sensible, full-width, never the narrow column', () => {
  it('large tablet landscape (1366x1024 CSS, coarse) uses mobile chrome + full width', () => {
    expect(resolveResponsiveLayout(phone(1366, 1024))).toEqual({ chrome: 'mobile', pageWidth: 'full' });
  });

  it('large tablet portrait (1024x1366 CSS, coarse) keeps desktop chrome but full-width page (no 1180 column)', () => {
    expect(resolveResponsiveLayout(phone(1024, 1366))).toEqual({ chrome: 'desktop', pageWidth: 'full' });
  });

  it('tablet landscape 1280x800 uses mobile chrome + full width (touch device)', () => {
    expect(resolveResponsiveLayout(phone(1280, 800))).toEqual({ chrome: 'mobile', pageWidth: 'full' });
  });
});

describe('no device class may regress to a narrow centered column on touch', () => {
  it('coarse pointer NEVER yields centered-1180, at any width/orientation', () => {
    const cases: Array<[number, number]> = [
      [914, 411],
      [1040, 480],
      [1067, 480],
      [1200, 540],
      [1280, 800],
      [1366, 1024],
      [1549, 832],
      [1936, 1040],
      [2400, 1200]
    ];
    for (const [w, h] of cases) {
      expect(resolveResponsiveLayout(phone(w, h)).pageWidth, `coarse ${w}x${h}`).toBe('full');
    }
  });

  it('fine pointer at the same sizes keeps the desktop centered column', () => {
    expect(resolveResponsiveLayout(phone(1936, 1040, false)).pageWidth).toBe('centered-1180');
  });
});
