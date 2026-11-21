/**
 * SK Flex Billing — appearance themes.
 *
 * Fifteen selectable presets. "SK Classic" is the original blue-and-white
 * dashboard and is the default. Every preset is expressed purely as CSS custom
 * properties (see theme.css), so switching only sets `data-theme` on <html>:
 * instant, no reload, and printed invoices stay on their own fixed palette.
 *
 * The selected id is cached locally for instant startup (read before React
 * renders) and synced through the signed-in account's settings document.
 */

export interface ThemeSwatch {
  bg: string;
  card: string;
  brand: string;
  nav: string;
}

export interface ThemeDef {
  id: string;
  name: string;
  description: string;
  /** 'light' | 'dark' — used for the preview label and native status bar tint. */
  tone: 'light' | 'dark';
  swatch: ThemeSwatch;
}

export const THEME_STORAGE_KEY = 'skfb:theme';
export const DEFAULT_THEME_ID = 'sk-classic';

export const THEMES: ThemeDef[] = [
  {
    id: 'sk-classic',
    name: 'SK Classic',
    description: 'The original blue-and-white dashboard.',
    tone: 'light',
    swatch: { bg: '#f1f5f9', card: '#ffffff', brand: '#2563eb', nav: '#0f172a' }
  },
  {
    id: 'sk-studio',
    name: 'SK Studio',
    description: 'Warm paper surfaces, serif headings, softer cards.',
    tone: 'light',
    swatch: { bg: '#f5efe6', card: '#fffdf8', brand: '#b45309', nav: '#2b2118' }
  },
  {
    id: 'sk-midnight',
    name: 'SK Midnight',
    description: 'Deep navy workspace with calm blue accents.',
    tone: 'dark',
    swatch: { bg: '#0b1220', card: '#141f36', brand: '#3b82f6', nav: '#070d18' }
  },
  {
    id: 'sky-glass',
    name: 'Sky Glass',
    description: 'Airy frosted panels over a soft sky gradient.',
    tone: 'light',
    swatch: { bg: '#e8f2ff', card: '#ffffff', brand: '#0284c7', nav: '#0c3c5c' }
  },
  {
    id: 'arctic-white',
    name: 'Arctic White',
    description: 'Near-white minimal UI with hairline borders.',
    tone: 'light',
    swatch: { bg: '#fbfcfd', card: '#ffffff', brand: '#0f172a', nav: '#ffffff' }
  },
  {
    id: 'ocean-teal',
    name: 'Ocean Teal',
    description: 'Cool teal accents on a pale aqua canvas.',
    tone: 'light',
    swatch: { bg: '#eef7f6', card: '#ffffff', brand: '#0f766e', nav: '#0b3b39' }
  },
  {
    id: 'graphite',
    name: 'Graphite',
    description: 'Neutral charcoal with compact, dense rows.',
    tone: 'dark',
    swatch: { bg: '#16181c', card: '#1e2127', brand: '#9ca3af', nav: '#0e1013' }
  },
  {
    id: 'royal-indigo',
    name: 'Royal Indigo',
    description: 'Rich indigo panels with violet highlights.',
    tone: 'light',
    swatch: { bg: '#f2f1fb', card: '#ffffff', brand: '#4338ca', nav: '#1e1b4b' }
  },
  {
    id: 'neon-night',
    name: 'Neon Night',
    description: 'Black canvas with electric cyan accents.',
    tone: 'dark',
    swatch: { bg: '#07090d', card: '#10151c', brand: '#22d3ee', nav: '#04060a' }
  },
  {
    id: 'forest',
    name: 'Forest',
    description: 'Deep green navigation and an earthy canvas.',
    tone: 'light',
    swatch: { bg: '#f0f5ef', card: '#ffffff', brand: '#15803d', nav: '#14301f' }
  },
  {
    id: 'copper',
    name: 'Copper',
    description: 'Burnished copper accents on warm stone.',
    tone: 'light',
    swatch: { bg: '#f6f0ea', card: '#fffaf5', brand: '#b45309', nav: '#3b2418' }
  },
  {
    id: 'plum',
    name: 'Plum',
    description: 'Muted plum surfaces with dusty rose accents.',
    tone: 'light',
    swatch: { bg: '#f6f0f6', card: '#fffbfe', brand: '#9333ea', nav: '#3b1d3d' }
  },
  {
    id: 'counter-compact',
    name: 'Counter Compact',
    description: 'Small type and tight rows for busy billing counters.',
    tone: 'light',
    swatch: { bg: '#f4f6f8', card: '#ffffff', brand: '#1d4ed8', nav: '#111827' }
  },
  {
    id: 'high-contrast',
    name: 'High Contrast',
    description: 'Maximum legibility: black, white and bold borders.',
    tone: 'light',
    swatch: { bg: '#ffffff', card: '#ffffff', brand: '#000000', nav: '#000000' }
  },
  {
    id: 'print-shop',
    name: 'Print Shop',
    description: 'Ink-on-newsprint look with monospaced numbers.',
    tone: 'light',
    swatch: { bg: '#f2efe6', card: '#fbf8ef', brand: '#111111', nav: '#242424' }
  }
];

export const THEME_IDS = THEMES.map((t) => t.id);

export function isThemeId(id: unknown): id is string {
  return typeof id === 'string' && THEME_IDS.includes(id);
}

export function getTheme(id: string): ThemeDef {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

/** Read the locally cached theme (safe in Node/tests without localStorage). */
export function loadCachedTheme(): string {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemeId(v)) return v;
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_THEME_ID;
}

export function cacheTheme(id: string): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, isThemeId(id) ? id : DEFAULT_THEME_ID);
  } catch {
    /* storage unavailable — the theme still applies for this session */
  }
}

/**
 * Apply a theme instantly by setting `data-theme` on the document root.
 * All colours, type, radii and density come from theme.css.
 */
export function applyTheme(id: string): void {
  if (typeof document === 'undefined') return;
  const theme = getTheme(id);
  document.documentElement.setAttribute('data-theme', theme.id);
  document.documentElement.style.colorScheme = theme.tone === 'dark' ? 'dark' : 'light';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme.swatch.nav);
}
