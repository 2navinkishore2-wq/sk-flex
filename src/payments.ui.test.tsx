// @vitest-environment jsdom
/* UI regression tests for the payment changes:
 *  - \"Receive Payment\" on the customer page has NO \"Select Invoice\" field
 *  - any amount is accepted (no balance cap) and overpayment becomes credit
 *  - the recorded payment appears in the payment history with its own date
 */
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

vi.mock('html2canvas-pro', () => ({ default: async () => ({ toDataURL: () => 'data:image/jpeg;base64,AA==' }) }));

async function createCustomerAndBill(userEv: ReturnType<typeof userEvent.setup>, name: string, phone: string) {
  await userEv.click(screen.getAllByRole('link', { name: /billing/i })[0]);
  await screen.findByRole('heading', { name: /new bill/i });
  await userEv.click(screen.getAllByRole('button', { name: /new/i })[0]);
  await userEv.type(await screen.findByPlaceholderText(/e\.g\. Ramesh/i), name);
  await userEv.type(screen.getByPlaceholderText(/98765 43210/i), phone);
  await userEv.click(screen.getByRole('button', { name: /add & select/i }));
  await screen.findByText(new RegExp(name));
  const [w, h] = screen.getAllByPlaceholderText('0');
  await userEv.type(w, '10');
  await userEv.type(h, '10');
  await userEv.click(screen.getByRole('button', { name: /add item/i }));
  await userEv.click(screen.getAllByRole('button', { name: /save invoice/i })[0]);
  await screen.findByRole('heading', { name: /invoice/i });
  await userEv.click(screen.getByRole('button', { name: /back/i }));
}

async function openCustomerPage(userEv: ReturnType<typeof userEvent.setup>, name: string) {
  await userEv.click(screen.getAllByRole('link', { name: /customers/i })[0]);
  await userEv.click(await screen.findByText(name));
  await screen.findByRole('heading', { name: new RegExp(name) });
}

beforeEach(() => {
  localStorage.clear();
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
});

describe('Receive Payment — no invoice selection, no amount cap', () => {
  it('the customer payment modal has no invoice selector and accepts an overpayment', async () => {
    const userEv = userEvent.setup();
    render(<App />);
    await userEv.click(await screen.findByRole('button', { name: /preview sk flex/i }));
    await screen.findByRole('heading', { name: /dashboard/i });

    await createCustomerAndBill(userEv, 'Ramesh', '9876543210'); // 10x10 Flex = ₹750
    await openCustomerPage(userEv, 'Ramesh');

    // Open Receive Payment.
    await userEv.click(screen.getByRole('button', { name: /receive payment/i }));

    // NO invoice selector anywhere in the modal.
    const modal = await screen.findByText(/enter the full amount actually received/i);
    expect(modal).toBeInTheDocument();
    expect(screen.queryByLabelText('Invoice')).not.toBeInTheDocument();
    expect(screen.queryByText(/select invoice/i)).not.toBeInTheDocument();

    // Enter MORE than the ₹750 balance — must be accepted in full.
    const amountInput = screen.getByPlaceholderText('0');
    await userEv.type(amountInput, '2000');
    await userEv.click(screen.getByRole('button', { name: /save payment/i }));

    // Payment recorded: history shows the full ₹2,000 with its own date.
    expect((await screen.findAllByText('₹2,000')).length).toBeGreaterThan(0);
    // The account is in credit: the stat card clearly shows the advance credit.
    expect(await screen.findByText('Advance Credit')).toBeInTheDocument();
    expect(screen.getByText('₹1,250')).toBeInTheDocument();
  });
});
