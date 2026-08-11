/**
 * Responsive layout decision — the single source of truth that mirrors the
 * media rules in src/theme.css. Kept in plain TS so the behavior can be
 * regression-tested for every device class (the CSS cannot be unit-tested
 * directly in jsdom because stylesheet media queries are not evaluated).
 *
 * The rules (in cascade order, later wins):
 *  1. width <= 1023                        -> mobile chrome + full-width page
 *  2. 1024..1279 AND landscape AND h<=640  -> mobile chrome + full-width page (legacy fix)
 *  3. coarse pointer (touch device):
 *       landscape                          -> mobile chrome + full-width page (phone landscape)
 *       portrait                           -> desktop chrome + FULL-width page (no 1180 column on touch devices)
 *  4. fine pointer (desktop)               -> desktop chrome + centered 1180px page
 */
export interface DeviceViewport {
  /** CSS px (window.innerWidth). */
  width: number;
  /** CSS px (window.innerHeight). */
  height: number;
  /** True when the primary pointer is a touch device (media `(pointer: coarse)`). */
  coarsePointer: boolean;
}

export type ChromeLayout = 'mobile' | 'desktop';
export type PageWidth = 'full' | 'centered-1180';

export interface ResponsiveDecision {
  chrome: ChromeLayout;
  pageWidth: PageWidth;
}

export function resolveResponsiveLayout(v: DeviceViewport): ResponsiveDecision {
  const landscape = v.width > v.height;
  if (v.width <= 1023) return { chrome: 'mobile', pageWidth: 'full' };
  if (v.width >= 1024 && v.width <= 1279 && landscape && v.height <= 640) {
    return { chrome: 'mobile', pageWidth: 'full' };
  }
  if (v.coarsePointer) {
    if (landscape) return { chrome: 'mobile', pageWidth: 'full' };
    return { chrome: 'desktop', pageWidth: 'full' };
  }
  return { chrome: 'desktop', pageWidth: 'centered-1180' };
}
