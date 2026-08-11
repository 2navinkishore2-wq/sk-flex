// @vitest-environment jsdom
/* Regression test for the cloud live-collection fix (AppContext):
 * FirestoreDataService.basePath is '' until Firebase Auth resolves the
 * session (users/{uid}). The useLiveCollection effect must NOT create a
 * listener while basePath is empty, MUST attach one once basePath is set, must
 * deliver documents into the context, and must cleanly unsubscribe on
 * sign-out / user change. This is what keeps customers/invoices visible after
 * Google sign-in on the APK. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AppProvider, useApp } from './store/AppContext';
import type { AuthUser } from './lib/types';

// Controllable fake backend: basePath starts '' (signed out), flips to
// users/{uid} on login, back to '' on logout. watch() records subscriptions.
const fake = vi.hoisted(() => {
  const watchers: Array<{ name: string; cb: (items: unknown[]) => void; active: boolean }> = [];
  const authCbs: Array<(u: AuthUser | null) => void> = [];
  let basePath = '';
  return {
    watchers,
    authCbs,
    login() {
      basePath = 'users/u1';
      authCbs.forEach((cb) =>
        cb({ uid: 'u1', name: 'Alice', email: 'a@x.com', photoURL: null, isDemo: false })
      );
    },
    logout() {
      basePath = '';
      authCbs.forEach((cb) => cb(null));
    },
    reset() {
      watchers.length = 0;
      authCbs.length = 0;
      basePath = '';
    },
    getBasePath: () => basePath
  };
});

vi.mock('./services/index', () => ({
  createService: () => ({
    service: {
      kind: 'firestore',
      isCloud: true,
      get basePath() {
        return fake.getBasePath();
      },
      getAuthUser: () => null,
      onAuthChange: (cb: (u: AuthUser | null) => void) => {
        fake.authCbs.push(cb);
        return () => undefined;
      },
      watch: (name: string, _spec: unknown, cb: (items: unknown[]) => void) => {
        const w = { name, cb, active: true };
        fake.watchers.push(w);
        return () => {
          w.active = false;
        };
      },
      onSyncStatusChange: () => () => undefined,
      onConnectivityChange: () => () => undefined,
      onSyncErrorChange: () => () => undefined,
      getSyncStatus: () => 'synced',
      getLastSyncError: () => null,
      isOnline: () => true,
      signInGoogle: async () => {
        fake.login();
      },
      signInDemo: async () => undefined,
      signOut: async () => {
        fake.logout();
      }
    },
    mode: 'cloud',
    configured: true
  })
}));

function Probe() {
  const { user, customers } = useApp();
  return (
    <div>
      <span data-testid="user">{user ? user.name : 'signed-out'}</span>
      <span data-testid="count">{customers.length}</span>
      {customers.map((c) => (
        <span key={c.id} data-testid={`customer-${c.id}`}>{c.name}</span>
      ))}
    </div>
  );
}

afterEach(() => {
  cleanup();
  fake.reset();
});

describe('useLiveCollection cloud subscription lifecycle', () => {
  it('attaches no listener before auth, attaches all six after basePath resolves, and delivers documents', async () => {
    render(
      <AppProvider>
        <Probe />
      </AppProvider>
    );

    // Signed out: no Firestore listeners at all.
    expect(fake.watchers.length).toBe(0);
    expect(screen.getByTestId('count').textContent).toBe('0');

    // Sign in: basePath becomes users/{uid} -> every live collection subscribes.
    await act(async () => {
      fake.login();
    });

    await waitFor(() => expect(fake.watchers.length).toBe(6));
    const names = fake.watchers.map((w) => w.name).sort();
    expect(names).toEqual(['customers', 'frameRates', 'invoices', 'ledger', 'payments', 'settings']);
    expect(fake.watchers.every((w) => w.active)).toBe(true);

    // A delivered document flows into the context -> the UI list updates.
    act(() => {
      const c = fake.watchers.find((w) => w.name === 'customers')!;
      c.cb([
        { id: 'c1', name: 'SYNC_TEST_CUSTOMER_001', phone: '123', address: '', email: '', createdAt: '', updatedAt: '' }
      ]);
    });
    expect(screen.getByTestId('count').textContent).toBe('1');
    expect(screen.getByTestId('customer-c1').textContent).toBe('SYNC_TEST_CUSTOMER_001');
  });

  it('unsubscribes every listener on sign-out and re-subscribes fresh on sign-in', async () => {
    render(
      <AppProvider>
        <Probe />
      </AppProvider>
    );

    await act(async () => {
      fake.login();
    });
    await waitFor(() => expect(fake.watchers.length).toBe(6));

    // Sign out: basePath '' -> all previous listeners are unsubscribed and
    // the context is cleared (no stale data from the old user).
    await act(async () => {
      fake.logout();
    });
    await waitFor(() => expect(fake.watchers.every((w) => !w.active)).toBe(true));
    expect(screen.getByTestId('user').textContent).toBe('signed-out');
    expect(screen.getByTestId('count').textContent).toBe('0');

    // Sign in again: fresh subscriptions, none duplicated from the old session.
    await act(async () => {
      fake.login();
    });
    await waitFor(() => expect(fake.watchers.filter((w) => w.active).length).toBe(6));
    expect(fake.watchers.filter((w) => w.active).length).toBe(6);
  });
});
