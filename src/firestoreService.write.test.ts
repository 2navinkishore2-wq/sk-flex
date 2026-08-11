// @vitest-environment jsdom
/* Unit tests for the Firestore write path (raceLocalWrite in
 * src/services/firestoreService.ts). The real Web SDK is mocked so the
 * behavior can be pinned deterministically:
 *  - add() resolves once the write is applied to the LOCAL cache (never hangs
 *    waiting for the server — this is what keeps Save responsive offline)
 *  - a real server rejection (permission denied etc.) still rejects the save
 *    AND surfaces as a sync error (never an unhandled rejection)
 *  - documents are stamped with createdAt/updatedAt server timestamps
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  initializeApp: vi.fn(() => ({ name: '[DEFAULT]' })),
  getApps: vi.fn(() => []),
  getApp: vi.fn(() => ({ name: '[DEFAULT]' })),
  initializeFirestore: vi.fn(() => ({ name: 'db' })),
  persistentLocalCache: vi.fn(() => ({})),
  persistentMultipleTabManager: vi.fn(() => ({})),
  persistentSingleTabManager: vi.fn(() => ({})),
  memoryLocalCache: vi.fn(() => ({})),
  connectFirestoreEmulator: vi.fn(),
  connectAuthEmulator: vi.fn(),
  collection: vi.fn((db: unknown, ...path: string[]) => ({ type: 'collection', db, path })),
  doc: vi.fn((c: unknown, ...seg: string[]) => ({ type: 'doc', c, seg, id: 'test-auto-id' })),
  getDoc: vi.fn(),
  getDocs: vi.fn(async () => ({ docs: [] })),
  setDoc: vi.fn(),
  deleteDoc: vi.fn(),
  query: vi.fn((...a: unknown[]) => ({ type: 'query', a })),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  onSnapshot: vi.fn(),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(() => ({ __serverTimestamp: true })),
  Timestamp: class Timestamp {
    seconds: number;
    nanoseconds: number;
    constructor(seconds: number, nanoseconds: number) {
      this.seconds = seconds;
      this.nanoseconds = nanoseconds;
    }
    toDate() {
      return new Date(0);
    }
  },
  onSnapshotsInSync: vi.fn(() => () => undefined),
  getAuth: vi.fn(() => ({})),
  GoogleAuthProvider: vi.fn(),
  signInWithPopup: vi.fn(),
  signInWithRedirect: vi.fn(),
  signInWithCredential: vi.fn(),
  getRedirectResult: vi.fn(),
  onAuthStateChanged: vi.fn(() => () => undefined),
  signOut: vi.fn(),
  isNative: vi.fn(() => false)
}));

vi.mock('firebase/app', () => ({
  initializeApp: mocks.initializeApp,
  getApp: mocks.getApp,
  getApps: mocks.getApps
}));

vi.mock('firebase/auth', () => ({
  getAuth: mocks.getAuth,
  GoogleAuthProvider: mocks.GoogleAuthProvider,
  signInWithPopup: mocks.signInWithPopup,
  signInWithRedirect: mocks.signInWithRedirect,
  signInWithCredential: mocks.signInWithCredential,
  getRedirectResult: mocks.getRedirectResult,
  onAuthStateChanged: mocks.onAuthStateChanged,
  signOut: mocks.signOut,
  connectAuthEmulator: mocks.connectAuthEmulator
}));

vi.mock('firebase/firestore', () => ({
  initializeFirestore: mocks.initializeFirestore,
  persistentLocalCache: mocks.persistentLocalCache,
  persistentMultipleTabManager: mocks.persistentMultipleTabManager,
  persistentSingleTabManager: mocks.persistentSingleTabManager,
  memoryLocalCache: mocks.memoryLocalCache,
  connectFirestoreEmulator: mocks.connectFirestoreEmulator,
  collection: mocks.collection,
  doc: mocks.doc,
  getDoc: mocks.getDoc,
  getDocs: mocks.getDocs,
  setDoc: mocks.setDoc,
  deleteDoc: mocks.deleteDoc,
  query: mocks.query,
  where: mocks.where,
  orderBy: mocks.orderBy,
  limit: mocks.limit,
  onSnapshot: mocks.onSnapshot,
  runTransaction: mocks.runTransaction,
  serverTimestamp: mocks.serverTimestamp,
  Timestamp: mocks.Timestamp,
  onSnapshotsInSync: mocks.onSnapshotsInSync
}));

vi.mock('./lib/platform', () => ({ isNative: mocks.isNative }));

import { FirestoreDataService, type FirebaseConfig } from './services/firestoreService';

const cfg: FirebaseConfig = {
  apiKey: 'AIzaSyTest',
  authDomain: 'test.firebaseapp.com',
  projectId: 'test-project',
  storageBucket: 'test.appspot.com',
  messagingSenderId: '1',
  appId: '1:1:web:test'
};

// A fake snapshot that looks like the local-cache state right after a write.
const localWriteSnapshot = {
  exists: () => true,
  metadata: { hasPendingWrites: true, fromCache: true }
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default: the write never resolves server-side (offline simulation), so
  // only the local-cache path can resolve raceLocalWrite.
  mocks.setDoc.mockReturnValue(new Promise(() => undefined));
  // Record onSnapshot registrations so tests can drive the local-cache event.
  const registrations: Array<{ cb: (s: unknown) => void; errCb: (e: unknown) => void }> = [];
  mocks.onSnapshot.mockImplementation((_ref: unknown, cb: (s: unknown) => void, errCb: (e: unknown) => void) => {
    registrations.push({ cb, errCb });
    return () => undefined;
  });
  (mocks.onSnapshot as unknown as { _regs: typeof registrations })._regs = registrations;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeService(): FirestoreDataService {
  const svc = new FirestoreDataService(cfg);
  svc.basePath = 'users/u1'; // simulate a signed-in session (auth callback is mocked, not fired)
  return svc;
}

describe('raceLocalWrite (FirestoreDataService.add)', () => {
  it('resolves via the local cache without waiting for the server, and stamps timestamps', async () => {
    const svc = makeService();
    const promise = svc.add('customers', { name: 'Ramesh', phone: '9876543210' });

    // Drive the local-cache snapshot event -> raceLocalWrite resolves.
    const regs = (mocks.onSnapshot as unknown as { _regs: Array<{ cb: (s: unknown) => void; errCb: (e: unknown) => void }> })._regs;
    expect(regs.length).toBe(1); // exactly ONE doc-level listener for the write
    regs[0].cb(localWriteSnapshot);

    const id = await promise;
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);

    // setDoc was called with the data + server timestamps on the user scope.
    expect(mocks.setDoc).toHaveBeenCalledTimes(1);
    const [ref, data] = mocks.setDoc.mock.calls[0];
    expect((ref as { type: string }).type).toBe('doc');
    expect(data).toMatchObject({
      name: 'Ramesh',
      phone: '9876543210',
      createdAt: { __serverTimestamp: true },
      updatedAt: { __serverTimestamp: true }
    });

    // Sync status returns to 'synced' after the write settles.
    expect(svc.getSyncStatus()).toBe('synced');
  });

  it('a server rejection rejects the save AND fires the sync-error diagnostics (no unhandled rejection)', async () => {
    mocks.setDoc.mockRejectedValue(new Error('Missing or insufficient permissions.'));
    const svc = makeService();
    const syncErrors: Array<string | null> = [];
    svc.onSyncErrorChange((m) => syncErrors.push(m));

    // The save itself rejects (the UI shows the inline form error)…
    await expect(svc.add('customers', { name: 'Ramesh', phone: '9876543210' })).rejects.toThrow();

    // …the sync-error diagnostics fired with the sanitized message…
    expect(syncErrors.some((m) => m !== null && m.includes('permissions'))).toBe(true);
    // …and the pill stays on "error" — the write's own cleanup must not flip
    // it back to green and hide the failure (regression guard for done()).
    expect(svc.getSyncStatus()).toBe('error');
    expect(svc.getLastSyncError()).toContain('permissions');
  });

  it('write resolution does not depend on the server when local cache applies first', async () => {
    // Even if the server promise NEVER settles, add() must resolve locally.
    const svc = makeService();
    const promise = svc.add('customers', { name: 'A', phone: '1' });
    const regs = (mocks.onSnapshot as unknown as { _regs: Array<{ cb: (s: unknown) => void; errCb: (e: unknown) => void }> })._regs;
    regs[0].cb(localWriteSnapshot);
    await expect(promise).resolves.toBeTypeOf('string');
  });
});
