import type { BusinessSettings, ProductKey, ProductRates } from './types';

export const APP_NAME = 'SK Flex Billing';
export const APP_TAGLINE = 'Flex • Star • Sunpack • Vinyl • Frame';
export const BRAND_COLOR = '#0f172a';

export interface ProductDef {
  key: ProductKey;
  name: string;
  unit: string;
  defaultRate: number;
  dimensionBased: boolean;
  hint: string;
}

export const PRODUCTS: ProductDef[] = [
  { key: 'FLEX', name: 'Flex', unit: 'sq.ft', defaultRate: 7.5, dimensionBased: true, hint: 'Width × Height' },
  { key: 'STAR', name: 'Star', unit: 'sq.ft', defaultRate: 25, dimensionBased: true, hint: 'Width × Height' },
  { key: 'SUNPACK', name: 'Sunpack', unit: 'sq.ft', defaultRate: 25, dimensionBased: true, hint: 'Width × Height' },
  { key: 'VINYL', name: 'Vinyl', unit: 'sq.ft', defaultRate: 25, dimensionBased: true, hint: 'Width × Height' },
  { key: 'FRAME', name: 'Frame', unit: 'sq.ft', defaultRate: 0, dimensionBased: true, hint: 'Width × Height (rate from Frame Rate Table)' },
  { key: 'CUSTOM', name: 'Custom', unit: 'Nos.', defaultRate: 0, dimensionBased: false, hint: 'Any item / service' }
];

export const DEFAULT_RATES: ProductRates = {
  flex: 7.5,
  vinyl: 25,
  star: 25,
  sunpack: 25
};

export const DEFAULT_SETTINGS: BusinessSettings = {
  address: '',
  phone: '',
  email: '',
  gst: '',
  invoicePrefix: 'SK',
  footer: 'Thank you for your business!',
  paymentNote: 'Balance payment is expected within 30 days.'
};

export const PAYMENT_METHODS = ['Cash', 'UPI', 'Card', 'Bank Transfer', 'Other'];

export const VALIDATION = {
  phonePattern: /^[+]?[\d\s-]{8,15}$/
};
