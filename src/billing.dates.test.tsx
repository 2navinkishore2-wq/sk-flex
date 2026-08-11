// @vitest-environment jsdom
/* Bill Date + Cash Payment date tests (demo/localStorage backend):
 * bill dates (today / earlier / unchanged after reload), per-payment dates,
 * multiple payments on one invoice, offline preservation, export uses the
 * saved Bill Date, and legacy invoices without the new field never crash. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import App from './App';
import { LocalDataService } from './services/localService';
import { createInvoice } from './services/invoices';
import { recordPayment } from './services/payments';
import { createCustomer } from './services/customers';
import { InvoiceDocument } from './components/InvoiceDocument';
import { DEFAULT_SETTINGS } from './lib/constants';
import { formatDate, todayISO } from './lib/format';
import { SK_PHOTO_FRAME_PRICES } from './lib/frameRates';
import type { Customer, FramePrice, Invoice, InvoiceDraft, Payment } from './lib/types';

// html2canvas cannot run in jsdom; the export buttons must still render.
vi.mock('html2canvas-pro', () => ({ default: async () => ({ toDataURL: () => 'data:image/jpeg;base64,AA==' }) }));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
Object.defineProperty(window, 'scrollTo', { value: () => undefined, writable: true });

const STORE_KEY = 'skfb:local:v1';

async function setup() {
  const svc = new LocalDataService();
  await svc.signInDemo('Shop Owner');
  const customer = await createCustomer(svc, { name: 'Mani', phone: '9876543210', address: 'Main Road', email: '' });
  return { svc, customer };
}

function draft(customer: Customer, over: Partial<InvoiceDraft> = {}): InvoiceDraft {
  return {
    customerId: customer.id,
    customer: { name: customer.name, phone: customer.phone, address: customer.address },
    items: [{ key: 'it1', product: 'FLEX', label: 'Flex', width: 10, height: 10, area: 100, unit: 'sq.ft', qty: 1, rate: 7.5, amount: 750 }],
    discountType: 'amount',
    discountValue: 0,
    paid: 0,
    date: todayISO(),
    ...over
  };
}

const custom2000 = [{ key: 'it1', product: 'CUSTOM' as const, label: 'Photo Frame', qty: 1, rate: 2000, amount: 2000, unit: 'Nos.', note: 'Custom' }];

function makeInvoice(over: Partial<Invoice> = {}): Invoice {
  return {
    id: 'inv1',
    number: 'SK-0001',
    date: '2026-08-06',
    customerId: 'c1',
    customer: { name: 'Mani', phone: '9876543210', address: '' },
    items: [{ key: 'it1', product: 'FLEX', label: 'Flex', width: 10, height: 10, area: 100, unit: 'sq.ft', qty: 1, rate: 7.5, amount: 750 }],
    subtotal: 750,
    discountType: 'amount',
    discountValue: 0,
    discount: 0,
    total: 750,
    paid: 0,
    balance: 750,
    status: 'credit',
    version: 1,
    createdAt: '2026-08-06T10:00:00.000Z',
    updatedAt: '2026-08-06T10:00:00.000Z',
    ...over
  };
}

async function reloadInvoices(): Promise<Invoice[]> {
  return new LocalDataService().query<Invoice>('invoices');
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('Bill Date', () => {
  it('1 — creates an invoice with today\'s Bill Date', async () => {
    const { svc, customer } = await setup();
    const inv = await createInvoice(svc, draft(customer, { date: todayISO() }));
    expect(inv.date).toBe(todayISO());
  });

  it('2 — creates an invoice with an earlier Bill Date (bill belongs to that date)', async () => {
    const { svc, customer } = await setup();
    const inv = await createInvoice(svc, draft(customer, { date: '2026-08-06' }));
    expect(inv.date).toBe('2026-08-06');
    expect(inv.createdAt).not.toBe('2026-08-06T00:00:00.000Z'); // creation time ≠ bill date
  });

  it('3 — Bill Date remains unchanged after reload/sync', async () => {
    const { svc, customer } = await setup();
    await createInvoice(svc, draft(customer, { date: '2026-08-06' }));
    const loaded = await reloadInvoices();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].date).toBe('2026-08-06');
  });

  it('6 — Bill Date and Payment Date stay independent (payment never overwrites it)', async () => {
    const { svc, customer } = await setup();
    const inv = await createInvoice(svc, draft(customer, { date: '2026-08-10' }));
    await recordPayment(svc, inv, { invoiceId: inv.id, amount: 500, date: '2026-08-15', method: 'Cash', note: '' });
    const reloaded = (await reloadInvoices())[0];
    expect(reloaded.date).toBe('2026-08-10'); // still the Bill Date
    const pays = await new LocalDataService().query<Payment>('payments');
    expect(pays[0].date).toBe('2026-08-15'); // the Payment Date it was actually received
  });
});

describe('Cash payments with their own dates', () => {
  it('4 — records a cash payment on a date different from the Bill Date', async () => {
    const { svc, customer } = await setup();
    const inv = await createInvoice(svc, draft(customer, { date: '2026-08-10' }));
    await recordPayment(svc, inv, { invoiceId: inv.id, amount: 500, date: '2026-08-12', method: 'Cash', note: '' });
    const pays = await new LocalDataService().query<Payment>('payments');
    expect(pays).toHaveLength(1);
    expect(pays[0].date).toBe('2026-08-12');
    expect((await reloadInvoices())[0].date).toBe('2026-08-10');
  });

  it('5 — multiple payments on different dates stay ONE invoice with full totals', async () => {
    const { svc, customer } = await setup();
    const inv = await createInvoice(svc, draft(customer, { date: '2026-08-10', items: custom2000 }));
    await recordPayment(svc, inv, { invoiceId: inv.id, amount: 500, date: '2026-08-10', method: 'Cash', note: '' });
    await recordPayment(svc, inv, { invoiceId: inv.id, amount: 500, date: '2026-08-12', method: 'Cash', note: '' });
    await recordPayment(svc, inv, { invoiceId: inv.id, amount: 1000, date: '2026-08-15', method: 'Cash', note: '' });

    const pays = await new LocalDataService().query<Payment>('payments');
    expect(pays.map((p) => p.date).sort()).toEqual(['2026-08-10', '2026-08-12', '2026-08-15']);

    const invoices = await reloadInvoices();
    expect(invoices).toHaveLength(1); // NOT three invoices
    const [reloaded] = invoices;
    expect(reloaded.total).toBe(2000);
    expect(reloaded.paid).toBe(2000);
    expect(reloaded.balance).toBe(0);
    expect(reloaded.status).toBe('paid');
  });
});

describe('Offline preservation (local backend)', () => {
  it('7 — offline invoice creation preserves the Bill Date in storage and after reload', async () => {
    const { svc, customer } = await setup();
    await createInvoice(svc, draft(customer, { date: '2026-08-06' }));
    // Raw offline storage keeps the Bill Date verbatim…
    const raw = JSON.parse(localStorage.getItem(STORE_KEY)!);
    const storedInvoices = Object.values(raw.collections.invoices) as Record<string, unknown>[];
    expect(storedInvoices[0].date).toBe('2026-08-06');
    // …and a fresh session (device reopen) still shows it.
    expect((await reloadInvoices())[0].date).toBe('2026-08-06');
  });

  it('8 — offline payment creation preserves the Payment Date', async () => {
    const { svc, customer } = await setup();
    const inv = await createInvoice(svc, draft(customer, { date: '2026-08-10' }));
    await recordPayment(svc, inv, { invoiceId: inv.id, amount: 400, date: '2026-08-14', method: 'Cash', note: '' });
    const raw = JSON.parse(localStorage.getItem(STORE_KEY)!);
    const storedPays = Object.values(raw.collections.payments) as Record<string, unknown>[];
    expect(storedPays[0].date).toBe('2026-08-14');
    const pays = await new LocalDataService().query<Payment>('payments');
    expect(pays[0].date).toBe('2026-08-14');
  });
});

describe('Invoice document / export', () => {
  it('9 — export/print shows the SAVED Bill Date, never the device date', () => {
    const saved = '2026-08-06';
    const payments: Payment[] = [
      { id: 'p1', customerId: 'c1', invoiceId: 'inv1', invoiceNumber: 'SK-0001', amount: 500, date: '2026-09-10', method: 'Cash', note: '', createdAt: '2026-09-10T09:00:00.000Z' },
      { id: 'p2', customerId: 'c1', invoiceId: 'inv1', invoiceNumber: 'SK-0001', amount: 250, date: '2026-09-12', method: 'Cash', note: '', createdAt: '2026-09-12T09:00:00.000Z' }
    ];
    render(<InvoiceDocument invoice={makeInvoice({ date: saved })} business={DEFAULT_SETTINGS} payments={payments} />);
    expect(screen.getByText('Bill Date')).toBeInTheDocument();
    // The Bill Date cell itself shows the saved date and NOT the device date.
    const billDateRow = screen.getByText('Bill Date').closest('div')!;
    expect(billDateRow).toHaveTextContent('6 Aug 2026');
    expect(billDateRow).not.toHaveTextContent(formatDate(todayISO()));
    // Payment history shows each payment's own date, separate from the Bill Date.
    expect(screen.getByText('Payment History')).toBeInTheDocument();
    expect(screen.getByText('10 Sep 2026')).toBeInTheDocument();
    expect(screen.getByText('12 Sep 2026')).toBeInTheDocument();
  });
});

describe('Frame price table (real SK Photo Frame price list)', () => {
  it('seeds the exact reference table on first demo sign-in, and never duplicates it', async () => {
    const { svc } = await setup();
    const prices = await svc.query<FramePrice>('frameRates');
    expect(prices.length).toBe(SK_PHOTO_FRAME_PRICES.length);
    expect(SK_PHOTO_FRAME_PRICES.length).toBe(19); // 19 sizes in the reference table
    expect(prices.every((p) => p.active)).toBe(true);
    const bySize = (s: string) => prices.find((p) => p.size === s)!;
    // Spot-check values straight from the supplied reference table.
    expect(bySize('8x6')).toMatchObject({ beading: 70, oneInch: 130, onePointFiveInch: null, twoInch: null });
    expect(bySize('12x18')).toMatchObject({ beading: 255, oneInch: 350, onePointFiveInch: 400, twoInch: 450 });
    expect(bySize('36x48')).toMatchObject({ beading: 3050, oneInch: 3850, onePointFiveInch: 4300, twoInch: 4800 });
    // A missing price is null, NEVER 0.
    expect(bySize('8x6').onePointFiveInch).toBeNull();
    expect(bySize('10x15').twoInch).toBeNull();
    // A second sign-in must not duplicate the table.
    await svc.signInDemo('Shop Owner');
    const again = await svc.query<FramePrice>('frameRates');
    expect(again.length).toBe(SK_PHOTO_FRAME_PRICES.length);
  });

  it('migrates the old flat-row shape to the size table without touching other data', async () => {
    // Pre-size-table storage: old flat rows + a customer that must survive.
    localStorage.setItem(STORE_KEY, JSON.stringify({
      collections: {
        customers: { c1: { name: 'Mani', phone: '9876543210', address: '', email: '' } },
        frameRates: {
          f1: { label: '8x6', minSize: 0.3333, maxSize: 0.3333, unit: 'sq.ft', rate: 70, rateType: 'fixed', active: true },
          f2: { label: '12x18', minSize: 1.5, maxSize: 1.5, unit: 'sq.ft', rate: 450, rateType: 'fixed', active: true }
        }
      }
    }));
    const svc = new LocalDataService();
    const prices = await svc.query<FramePrice>('frameRates');
    expect(prices.length).toBe(SK_PHOTO_FRAME_PRICES.length);
    expect(prices.every((p) => typeof p.size === 'string' && 'beading' in p && 'twoInch' in p)).toBe(true);
    // Other collections are untouched.
    const customers = await new LocalDataService().query<Customer>('customers');
    expect(customers).toHaveLength(1);
    expect(customers[0].name).toBe('Mani');
  });
});

describe('Backward compatibility', () => {
  it('10 — legacy invoices without the new date field load and render without crashing', async () => {
    // A legacy invoice doc with NO `date` key at all (pre-Bill-Date data).
    const legacyDoc = {
      number: 'SK-0099',
      customerId: 'c1',
      customer: { name: 'Old Customer', phone: '9000000000', address: '' },
      items: [{ key: 'it1', product: 'FLEX', label: 'Flex', width: 4, height: 5, area: 20, unit: 'sq.ft', qty: 1, rate: 7.5, amount: 150 }],
      subtotal: 150,
      discountType: 'amount',
      discountValue: 0,
      discount: 0,
      total: 150,
      paid: 0,
      balance: 150,
      status: 'credit',
      version: 1,
      createdAt: '2026-08-01T10:00:00.000Z',
      updatedAt: '2026-08-01T10:00:00.000Z'
    };
    localStorage.setItem(STORE_KEY, JSON.stringify({ collections: { invoices: { legacy1: legacyDoc } } }));
    const svc = new LocalDataService();
    const invoices = await svc.query<Invoice>('invoices');
    expect(invoices).toHaveLength(1);
    expect(invoices[0].number).toBe('SK-0099');

    // Rendering must not crash; the Bill Date falls back to "—".
    const legacy = { ...makeInvoice(), id: 'legacy1', number: 'SK-0099', date: undefined as unknown as string };
    render(<InvoiceDocument invoice={legacy} business={DEFAULT_SETTINGS} payments={[]} />);
    expect(screen.getByText('SK-0099')).toBeInTheDocument();
    expect(screen.getByText('Bill Date')).toBeInTheDocument();
  });
});

describe('Billing screen Bill Date input', () => {
  it('defaults to today, is editable to an earlier date, and the saved date survives to the invoice view', async () => {
    const userEv = userEvent.setup();
    render(<App />);
    await userEv.click(await screen.findByRole('button', { name: /continue without account/i }));
    const input = await screen.findByPlaceholderText(/your name/i);
    await userEv.clear(input);
    await userEv.type(input, 'Shop Owner');
    await userEv.click(screen.getByRole('button', { name: /enter/i }));
    await screen.findByRole('heading', { name: /dashboard/i });

    await userEv.click(screen.getAllByRole('link', { name: /billing/i })[0]);
    await screen.findByRole('heading', { name: /new bill/i });

    const dateInput = screen.getByTestId('bill-date-input') as HTMLInputElement;
    expect(dateInput.value).toBe(todayISO()); // defaults to today

    // Backdate the bill to 6 Aug 2026.
    fireEvent.change(dateInput, { target: { value: '2026-08-06' } });
    expect((screen.getByTestId('bill-date-input') as HTMLInputElement).value).toBe('2026-08-06');

    // Quick-add customer + one item, then save.
    await userEv.click(screen.getByRole('button', { name: /new/i }));
    await userEv.type(await screen.findByPlaceholderText(/e\.g\. Ramesh/i), 'Mani');
    await userEv.type(screen.getByPlaceholderText(/98765 43210/i), '9876543210');
    await userEv.click(screen.getByRole('button', { name: /add & select/i }));
    await screen.findByText(/Mani · 9876543210/i);
    const [w, h] = screen.getAllByPlaceholderText('0');
    await userEv.type(w, '10');
    await userEv.type(h, '10');
    await userEv.click(screen.getByRole('button', { name: /add item/i }));
    await userEv.click(screen.getAllByRole('button', { name: /save invoice/i })[0]);

    // Invoice view + printed document use the saved Bill Date, not today.
    expect((await screen.findAllByText('6 Aug 2026')).length).toBeGreaterThan(0);
    if ('2026-08-06' !== todayISO()) {
      expect(screen.queryByText(formatDate(todayISO()))).not.toBeInTheDocument();
    }
  });
});
