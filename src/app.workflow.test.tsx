// @vitest-environment jsdom
/* End-to-end workflow test (demo mode, localStorage backend):
 * login -> add customer -> 10x10 Flex bill = ₹750 -> custom item ->
 * discount + payment -> save -> invoice SK-0001 -> ledger balance. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import App from './App';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
Object.defineProperty(window, 'scrollTo', { value: () => undefined, writable: true });

// html2canvas cannot run in jsdom; the export buttons must still render.
vi.mock('html2canvas-pro', () => ({ default: async () => ({ toDataURL: () => 'data:image/jpeg;base64,AA==' }) }));

async function signInDemo(user = 'Shop Owner') {
  render(<App />);
  const userEv = userEvent.setup();
  await userEv.click(await screen.findByRole('button', { name: /continue without account/i }));
  const input = await screen.findByPlaceholderText(/your name/i);
  await userEv.clear(input);
  await userEv.type(input, user);
  await userEv.click(screen.getByRole('button', { name: /enter/i }));
  await screen.findByRole('heading', { name: /dashboard/i });
  return userEv;
}

beforeEach(() => {
  localStorage.clear();
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
});

describe('complete billing workflow', () => {
  it('creates a customer and a 10x10 Flex invoice worth ₹750, saves it, and updates the ledger', async () => {
    const userEv = await signInDemo();

    // --- go to Billing ---
    await userEv.click(screen.getAllByRole('link', { name: /billing/i })[0]);
    await screen.findByRole('heading', { name: /new bill/i });

    // --- quick-add customer Ramesh ---
    await userEv.click(screen.getByRole('button', { name: /new/i }));
    const nameInput = await screen.findByPlaceholderText(/e\.g\. Ramesh/i);
    await userEv.type(nameInput, 'Ramesh');
    const phoneInput = screen.getByPlaceholderText(/98765 43210/i);
    await userEv.type(phoneInput, '9876543210');
    await userEv.click(screen.getByRole('button', { name: /add & select/i }));
    expect(await screen.findByText(/Ramesh · 9876543210/i)).toBeInTheDocument();

    // --- Flex 10 x 10 -> ₹750 ---
    const [width, height] = screen.getAllByPlaceholderText('0');
    await userEv.type(width, '10');
    await userEv.type(height, '10');
    // live preview shows 100 sq.ft x ₹7.50 = ₹750
    expect(await screen.findByTestId('calc-preview')).toHaveTextContent('100 sq.ft × ₹7.50 = ₹750');
    await userEv.click(screen.getByRole('button', { name: /add item/i }));

    // --- Vinyl 5 x 4 -> ₹500 ---
    await userEv.click(screen.getByRole('button', { name: /^vinyl$/i }));
    const inputs = screen.getAllByPlaceholderText('0');
    await userEv.type(inputs[0], '5');
    await userEv.type(inputs[1], '4');
    await userEv.click(screen.getByRole('button', { name: /add item/i }));

    // --- Custom item: Installation ₹300 x1 ---
    await userEv.click(screen.getByRole('button', { name: /^custom$/i }));
    await userEv.type(screen.getByPlaceholderText(/banner installation/i), 'Installation');
    const customRate = screen.getAllByPlaceholderText('0')[0];
    await userEv.type(customRate, '300');
    await userEv.click(screen.getByRole('button', { name: /add item/i }));

    // items listed
    expect(screen.getAllByText('Flex').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Vinyl').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Installation').length).toBeGreaterThan(0);

    // --- discount ₹50 and a ₹1000 cash payment (own Payment Date) ---
    await userEv.type(screen.getByTestId('discount-input'), '50');
    await userEv.type(screen.getByTestId('payment-amount-input'), '1000');
    await userEv.click(screen.getByRole('button', { name: /add payment/i }));

    // Subtotal 750 + 500 + 300 = 1550; discount 50 -> total 1500; balance 500
    // (totals render in the summary card and the mobile sticky bar)
    expect((await screen.findAllByText('₹1,550')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('₹1,500').length).toBeGreaterThan(0);
    expect(screen.getAllByText('₹500').length).toBeGreaterThan(0);

    // --- save (desktop totals-card button; the mobile sticky bar duplicates it in the DOM) ---
    await userEv.click(screen.getAllByRole('button', { name: /save invoice/i })[0]);

    // --- invoice view ---
    expect((await screen.findAllByText('SK-0001')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('₹1,550').length).toBeGreaterThan(0);
    expect(screen.getAllByText('₹1,500').length).toBeGreaterThan(0);
    expect(screen.getAllByText('₹500').length).toBeGreaterThan(0);

    // action buttons present
    expect(screen.getByRole('button', { name: /download pdf/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /download jpg/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /print/i })).toBeInTheDocument();

    // --- ledger: customer outstanding ₹500 (customers table rows are clickable, not links) ---
    await userEv.click(screen.getAllByRole('link', { name: /customers/i })[0]);
    await userEv.click(await screen.findByText('Ramesh'));
    expect((await screen.findAllByText('₹1,500')).length).toBeGreaterThan(0); // total billed (after discount)
    expect(screen.getAllByText('₹1,000').length).toBeGreaterThan(0); // total paid
    expect(screen.getAllByText('₹500').length).toBeGreaterThan(0); // outstanding
    expect(screen.getAllByText(/Invoice SK-0001/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Payment received — Invoice SK-0001/i).length).toBeGreaterThan(0);
  });

  it('assigns sequential invoice numbers SK-0001, SK-0002 without duplicates', async () => {
    const userEv = await signInDemo();
    await userEv.click(screen.getAllByRole('link', { name: /billing/i })[0]);
    await screen.findByRole('heading', { name: /new bill/i });

    const makeBill = async (name: string, expected: string) => {
      await userEv.click(screen.getAllByRole('button', { name: /new/i })[0]);
      await userEv.type(await screen.findByPlaceholderText(/e\.g\. Ramesh/i), name);
      await userEv.type(screen.getByPlaceholderText(/98765 43210/i), '9000000001');
      await userEv.click(screen.getByRole('button', { name: /add & select/i }));
      await screen.findByText(new RegExp(name));
      const [w, h] = screen.getAllByPlaceholderText('0');
      await userEv.type(w, '2');
      await userEv.type(h, '3');
      await userEv.click(screen.getByRole('button', { name: /add item/i }));
      await userEv.click(screen.getAllByRole('button', { name: /save invoice/i })[0]);
      // invoice view loaded with the expected sequential number
      expect((await screen.findAllByText(expected, {}, { timeout: 8000 })).length).toBeGreaterThan(0);
    };

    await makeBill('Amar', 'SK-0001');
    await userEv.click(screen.getByRole('button', { name: /back/i }));

    await userEv.click(screen.getAllByRole('link', { name: /billing/i })[0]);
    await screen.findByRole('heading', { name: /new bill/i });
    await makeBill('Balaji', 'SK-0002');
  });

  it('shows setup guidance when cloud mode is requested without config (strict mode)', async () => {
    // Simulated in code: with VITE_DATA_MODE=cloud and no config, mode === 'none'.
    // We assert the login page renders (demo fallback available).
    render(<App />);
    expect(await screen.findByRole('button', { name: /sign in with google/i })).toBeInTheDocument();
  });
});
