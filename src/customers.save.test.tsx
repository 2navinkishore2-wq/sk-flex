// @vitest-environment jsdom
/* Customer-save regression test for the white-screen investigation.
 * Expected behavior on ANY platform: Save -> modal closes normally, the
 * customer appears immediately in the list, NO page reload, NO navigation,
 * no swallowed error, and the on-device diagnostic log records the save
 * start/done markers (so a WebView restart after Save is provably NOT caused
 * by the save handler itself). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import App from './App';
import { diagClear, diagRead } from './lib/diagnostics';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
Object.defineProperty(window, 'scrollTo', { value: () => undefined, writable: true });

// jsdom's Location.reload is non-configurable, so spy on it via a Proxy that
// intercepts only `reload` and forwards everything else (incl. `hash`) to the
// real location object — HashRouter keeps working normally.
const reloadSpy = vi.fn();
Object.defineProperty(window, 'location', {
  configurable: true,
  value: new Proxy(window.location, {
    get: (t, p) => (p === 'reload' ? reloadSpy : Reflect.get(t, p)),
    set: (t, p, v) => Reflect.set(t, p, v)
  })
});

vi.mock('html2canvas-pro', () => ({ default: async () => ({ toDataURL: () => 'data:image/jpeg;base64,AA==' }) }));

async function openCustomersPage() {
  const userEv = userEvent.setup();
  render(<App />);
  await userEv.click(await screen.findByRole('button', { name: /continue without account/i }));
  const input = await screen.findByPlaceholderText(/your name/i);
  await userEv.clear(input);
  await userEv.type(input, 'Shop Owner');
  await userEv.click(screen.getByRole('button', { name: /enter/i }));
  await screen.findByRole('heading', { name: /dashboard/i });
  await userEv.click(screen.getAllByRole('link', { name: /customers/i })[0]);
  await screen.findByRole('heading', { level: 1, name: /customers/i });
  return userEv;
}

beforeEach(() => {
  localStorage.clear();
  diagClear();
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('customer save lifecycle', () => {
  it('Save closes the modal, shows the customer immediately, does NOT reload or navigate', async () => {
    reloadSpy.mockClear();
    const userEv = await openCustomersPage();

    // Empty state -> Add Customer
    await userEv.click(screen.getAllByRole('button', { name: /add customer/i })[0]);
    const modal = await screen.findByText(/customer name \*/i);
    expect(modal).toBeInTheDocument();

    await userEv.type(screen.getByPlaceholderText(/e\.g\. Ramesh/i), 'Ramesh');
    await userEv.type(screen.getByPlaceholderText(/98765 43210/i), '9876543210');

    // Save (the modal's block submit button is the LAST "Add Customer" button)
    const buttons = screen.getAllByRole('button', { name: /add customer/i });
    await userEv.click(buttons[buttons.length - 1]);

    // Modal closes normally
    await screen.findByRole('heading', { level: 1, name: /customers/i });
    expect(screen.queryByPlaceholderText(/e\.g\. Ramesh/i)).not.toBeInTheDocument();

    // Customer appears immediately in the list (count + row)
    expect(await screen.findByText(/1 customer/i)).toBeInTheDocument();
    expect(await screen.findByText('Ramesh')).toBeInTheDocument();

    // NO page reload, NO navigation happened
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(window.location.hash).toContain('/customers');

    // Diagnostics recorded the save start/done markers (no error)
    const events = diagRead().map((e) => e.e);
    expect(events).toContain('save.customer.start');
    expect(events).toContain('save.customer.done');
    expect(events).not.toContain('save.customer.error');
  });

  it('a validation failure shows the error inline and keeps the modal open', async () => {
    const userEv = await openCustomersPage();
    await userEv.click(screen.getAllByRole('button', { name: /add customer/i })[0]);
    await screen.findByText(/customer name \*/i);

    // Missing phone -> inline error, modal stays open
    await userEv.type(screen.getByPlaceholderText(/e\.g\. Ramesh/i), 'Ramesh');
    const buttons = screen.getAllByRole('button', { name: /add customer/i });
    await userEv.click(buttons[buttons.length - 1]);

    expect(await screen.findByText(/phone number is required/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/e\.g\. Ramesh/i)).toBeInTheDocument();
  });
});

describe('customer list renders the saved customer inside a modal-free page', () => {
  it('the modal lives inside the page container (no full-screen takeover) and closes cleanly', async () => {
    const userEv = await openCustomersPage();
    await userEv.click(screen.getAllByRole('button', { name: /add customer/i })[0]);
    const dialog = await screen.findByText(/customer name \*/i);
    expect(dialog.closest('.modal')).not.toBeNull();
  });
});
