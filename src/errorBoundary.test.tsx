// @vitest-environment jsdom
/* White-screen diagnostics tests:
 *  - ErrorBoundary: an uncaught React render error must NOT unmount the app
 *    into a blank white screen — it renders a recoverable panel and records
 *    the error in the on-device diagnostic log.
 *  - installDiagnostics: window errors and unhandled rejections are captured
 *    into the persistent localStorage ring buffer (survives a reload).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ErrorBoundary } from './components/ErrorBoundary';
import { diagClear, diagRead, diagLog, installDiagnostics } from './lib/diagnostics';

function Bomb(): never {
  throw new Error('render-exploded');
}

beforeEach(() => {
  localStorage.clear();
  diagClear();
  // React logs boundary-caught errors to console.error — silence that noise.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('catches a render error, shows a recoverable panel (not a blank screen), and logs it', () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    );

    // The boundary UI is visible instead of a white screen.
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    expect(screen.getByText(/render-exploded/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reload app/i })).toBeInTheDocument();

    // The error is persisted for post-restart inspection.
    const events = diagRead();
    expect(events.some((e) => e.e === 'react.errorboundary' && (e.d || '').includes('render-exploded'))).toBe(true);
  });

  it('renders children normally when nothing throws', () => {
    render(
      <ErrorBoundary>
        <div>all-good</div>
      </ErrorBoundary>
    );
    expect(screen.getByText('all-good')).toBeInTheDocument();
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
  });
});

describe('installDiagnostics', () => {
  it('captures window errors and unhandled rejections into the persistent buffer', () => {
    const stop = installDiagnostics();

    const errEvt = new Event('error') as ErrorEvent;
    (errEvt as unknown as { message: string }).message = 'boom-error';
    (errEvt as unknown as { filename: string }).filename = 'app.js';
    window.dispatchEvent(errEvt);

    const rejEvt = new Event('unhandledrejection');
    (rejEvt as unknown as { reason: unknown }).reason = new Error('boom-rejection');
    window.dispatchEvent(rejEvt);

    const events = diagRead().map((e) => e.e);
    expect(events).toContain('window.error');
    expect(events).toContain('unhandledrejection');
    expect(events).toContain('viewport:boot');

    stop();
  });

  it('diagLog persists entries and diagClear empties them', () => {
    diagLog('test.marker', { x: 1 });
    expect(diagRead().some((e) => e.e === 'test.marker')).toBe(true);
    diagClear();
    expect(diagRead()).toEqual([]);
  });
});
