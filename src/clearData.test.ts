// @vitest-environment jsdom
/* "Clear Data (All)" — unit tests for the shared helper and the demo/local
 * backend wipe. Cloud data and the Firebase auth session must survive; every
 * app-owned byte must go. */
import { describe, expect, it, vi } from 'vitest';
import { clearAllLocalData } from './lib/clearData';
import { LocalDataService } from './services/localService';
import type { DataService } from './services/data';

describe('clearAllLocalData — "Clear Data (All)"', () => {
  it('calls the backend wipe and removes every app-owned localStorage key, keeping auth + cloud', async () => {
    localStorage.setItem('skfb:local:v1', '{"collections":{}}');
    localStorage.setItem('skfb:diag:events', '[{"t":1,"e":"boot"}]');
    localStorage.setItem('skfb:auth:demo', '{"uid":"demo-user"}');
    localStorage.setItem('firebase:authUser:AIzaSyTest:[DEFAULT]', '{"uid":"u1"}'); // must survive
    localStorage.setItem('other-app-key', 'keep'); // must survive

    const svc = { clearLocalData: vi.fn(async () => undefined) } as unknown as DataService;
    await clearAllLocalData(svc);

    expect(svc.clearLocalData).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('skfb:local:v1')).toBeNull();
    expect(localStorage.getItem('skfb:diag:events')).toBeNull();
    expect(localStorage.getItem('skfb:auth:demo')).toBeNull();
    // Firebase auth session (firebase:* keys) is deliberately kept.
    expect(localStorage.getItem('firebase:authUser:AIzaSyTest:[DEFAULT]')).toBe('{"uid":"u1"}');
    expect(localStorage.getItem('other-app-key')).toBe('keep');
  });

  it('a failing backend wipe propagates the error (nothing is silently swallowed)', async () => {
    const svc = { clearLocalData: vi.fn(async () => Promise.reject(new Error('storage locked'))) } as unknown as DataService;
    await expect(clearAllLocalData(svc)).rejects.toThrow('storage locked');
  });
});

describe('LocalDataService.clearLocalData — demo/local mode wipes the whole database', () => {
  it('removes the store and the demo session; the app is empty afterwards', async () => {
    localStorage.setItem('skfb:auth:demo', '{"uid":"demo-user","name":"Demo"}');
    const svc = new LocalDataService();
    // Constructor seeds the frame-rates table — local data now exists.
    expect(localStorage.getItem('skfb:local:v1')).not.toBeNull();
    await svc.add('customers', { name: 'Ramesh', phone: '9876543210' });
    expect((await svc.query('customers')).length).toBe(1);

    await svc.clearLocalData();

    expect(localStorage.getItem('skfb:local:v1')).toBeNull();
    expect(localStorage.getItem('skfb:auth:demo')).toBeNull();
    expect(svc.getAuthUser()).toBeNull();
    expect(await svc.query('customers')).toEqual([]);
  });
});
