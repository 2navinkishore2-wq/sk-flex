// @vitest-environment jsdom
/* Auth-flow unit tests with mocked Firebase modules (real Google sign-in needs
 * a real project — verified separately by scripts/verify-cloud.ts and the
 * emulator). Covers: session restore on reload, signed-out state, signed-in
 * state, user isolation (users/{uid} scoping), sign-out, sign-in again,
 * profile-doc creation exactly once per user (popup + redirect + restore),
 * the Android redirect path, and the AppContext authLoading fix (no login
 * flash while Firebase restores a session). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { FirestoreDataService, type FirebaseConfig } from './services/firestoreService';


// ---- hoisted mocks so the vi.mock factories can reference them ----
const mocks = vi.hoisted(() => {
  const authStateCallbacks: Array<(u: unknown) => void> = [];
  return {
    authStateCallbacks,
    getDoc: vi.fn(),
    setDoc: vi.fn(),
    doc: vi.fn(),
    collection: vi.fn(),
    signInWithPopup: vi.fn(),
    signInWithRedirect: vi.fn(),
    getRedirectResult: vi.fn(() => Promise.resolve(null)),
    signOut: vi.fn(() => Promise.resolve()),
    onAuthStateChanged: vi.fn()
  };
});

vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(() => ({ name: '[DEFAULT]' })),
  getApp: vi.fn(() => ({ name: '[DEFAULT]' })),
  getApps: vi.fn(() => [])
}));

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({})),
  GoogleAuthProvider: class {
    static credential(idToken: string) {
      return { idToken, providerId: 'google.com' };
    }
    setCustomParameters() {}
  },
  signInWithPopup: mocks.signInWithPopup,
  signInWithRedirect: mocks.signInWithRedirect,
  signInWithCredential: vi.fn(() => Promise.resolve({ user: fbUser('alice') })),
  getRedirectResult: mocks.getRedirectResult,
  onAuthStateChanged: vi.fn((_auth: unknown, cb: (u: unknown) => void) => {
    mocks.authStateCallbacks.push(cb);
    return () => {};
  }),
  signOut: mocks.signOut,
  connectAuthEmulator: vi.fn()
}));

// Isolate auth behavior from the frame-rate seeder (which has its own tests
// in billing.dates.test.tsx); otherwise each sign-in also writes 19 seed rows.
vi.mock('./lib/frameRates', () => ({
  seedFramePricesIfEmpty: vi.fn(async () => {}),
  SK_PHOTO_FRAME_PRICES: []
}));

// Hoist the native credential class so the mock factory and tests share it.
const NativeGoogleSignInErrorMock = vi.hoisted(() => {
  return class extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = 'NativeGoogleSignInError';
      this.code = code;
    }
  };
});

vi.mock('./lib/nativeGoogle', () => ({
  signInWithNativeGoogle: vi.fn(),
  signOutNativeGoogle: vi.fn(),
  isNativeGoogleConfigured: vi.fn(() => false),
  NativeGoogleSignInError: NativeGoogleSignInErrorMock
}));
// Re-import the mocked module for test assertions.
import { signInWithNativeGoogle, signOutNativeGoogle, isNativeGoogleConfigured, NativeGoogleSignInError } from './lib/nativeGoogle';

vi.mock('firebase/firestore', () => {
  class MockTimestamp {
    toDate() {
      return new Date();
    }
  }
  return {
    initializeFirestore: vi.fn(() => ({})),
    persistentLocalCache: vi.fn(() => ({})),
    persistentMultipleTabManager: vi.fn(() => ({})),
    persistentSingleTabManager: vi.fn(() => ({})),
    memoryLocalCache: vi.fn(() => ({})),
    connectFirestoreEmulator: vi.fn(),
    collection: (...a: unknown[]) => mocks.collection(...a),
    doc: (...a: unknown[]) => mocks.doc(...a),
    getDoc: (...a: unknown[]) => mocks.getDoc(...a),
    getDocs: vi.fn(async () => ({ docs: [] })),
    setDoc: (...a: unknown[]) => mocks.setDoc(...a),
    deleteDoc: vi.fn(async () => undefined),
    query: vi.fn(() => ({})),
    where: vi.fn(() => ({})),
    orderBy: vi.fn(() => ({})),
    limit: vi.fn(() => ({})),
    onSnapshot: vi.fn(() => () => {}),
    runTransaction: vi.fn(),
    serverTimestamp: vi.fn(() => new MockTimestamp()),
    Timestamp: MockTimestamp,
    onSnapshotsInSync: vi.fn(() => () => {})
  };
});

const CONFIG: FirebaseConfig = {
  apiKey: 'AIzaSy-test-key',
  authDomain: 'sk-flex-billing-test.firebaseapp.com',
  projectId: 'sk-flex-billing-test',
  storageBucket: 'sk-flex-billing-test.appspot.com',
  messagingSenderId: '123456789012',
  appId: '1:123456789012:web:abcdef'
};

function fbUser(uid: string, email = `${uid}@gmail.com`) {
  return { uid, displayName: 'Test User', email, photoURL: null };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authStateCallbacks.length = 0;
  mocks.doc.mockImplementation((_db: unknown, ...segments: unknown[]) => ({ path: segments.join('/') }));
  mocks.collection.mockImplementation((_db: unknown, ...segments: unknown[]) => ({ path: segments.join('/') }));
  mocks.getDoc.mockResolvedValue({ exists: () => false }); // profile doc missing -> gets created
  mocks.setDoc.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('FirestoreDataService auth session lifecycle', () => {
  it('restores an existing session on page reload: user, basePath, and profile doc ensured', async () => {
    const svc = new FirestoreDataService(CONFIG);
    const listener = vi.fn();
    svc.onAuthChange(listener);
    expect(svc.getAuthUser()).toBeNull(); // unknown until Firebase resolves

    // Firebase restores the session asynchronously after reload:
    mocks.authStateCallbacks[0](fbUser('alice'));
    await flush();

    expect(svc.getAuthUser()?.uid).toBe('alice');
    expect(svc.basePath).toBe('users/alice');
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ uid: 'alice', isDemo: false }));
    // The profile doc is ensured on the session-restore path too (getDoc saw no doc -> setDoc).
    expect(mocks.setDoc).toHaveBeenCalledTimes(1);
    expect(mocks.setDoc.mock.calls[0][0]).toEqual({ path: 'users/alice' });
    expect(mocks.setDoc.mock.calls[0][1]).toEqual(expect.objectContaining({ name: 'Test User', email: 'alice@gmail.com' }));
  });

  it('signed-out state: null user, empty basePath, no profile writes', async () => {
    const svc = new FirestoreDataService(CONFIG);
    mocks.authStateCallbacks[0](null);
    await flush();
    expect(svc.getAuthUser()).toBeNull();
    expect(svc.basePath).toBe('');
    expect(mocks.setDoc).not.toHaveBeenCalled();
  });

  it('sign-in again after sign-out: same user scope, existing profile is NOT duplicated', async () => {
    const svc = new FirestoreDataService(CONFIG);
    mocks.authStateCallbacks[0](fbUser('alice'));
    await flush();
    expect(mocks.setDoc).toHaveBeenCalledTimes(1); // created on first sign-in

    // Now the profile exists:
    mocks.getDoc.mockResolvedValue({ exists: () => true });
    mocks.setDoc.mockClear();

    mocks.authStateCallbacks[0](null); // sign-out
    expect(svc.getAuthUser()).toBeNull();
    expect(svc.basePath).toBe('');

    mocks.authStateCallbacks[0](fbUser('alice')); // sign-in again
    await flush();
    expect(svc.getAuthUser()?.uid).toBe('alice');
    expect(svc.basePath).toBe('users/alice');
    expect(mocks.setDoc).not.toHaveBeenCalled(); // existing profile -> no duplicate write
  });

  it('user isolation: each account is scoped to its own users/{uid} basePath', () => {
    const svc = new FirestoreDataService(CONFIG);
    mocks.authStateCallbacks[0](fbUser('alice'));
    expect(svc.basePath).toBe('users/alice');
    mocks.authStateCallbacks[0](fbUser('bob'));
    expect(svc.basePath).toBe('users/bob');
    expect(svc.basePath).not.toBe('users/alice');
  });

  it('profile doc is ensured exactly once per user across repeated auth emissions', async () => {
    new FirestoreDataService(CONFIG);
    mocks.authStateCallbacks[0](fbUser('alice'));
    await flush();
    mocks.authStateCallbacks[0](fbUser('alice')); // e.g. a refresh of the auth token re-emits
    await flush();
    expect(mocks.setDoc).toHaveBeenCalledTimes(1);
  });

  it('Web popup sign-in: signs in and the session callback wires user + profile', async () => {
    const svc = new FirestoreDataService(CONFIG);
    mocks.signInWithPopup.mockResolvedValue({ user: fbUser('alice') });
    const user = await svc.signInWithGoogle();
    expect(user.uid).toBe('alice');
    // The auth-state handler (not the sign-in call itself) owns the session:
    expect(svc.getAuthUser()).toBeNull();
    mocks.authStateCallbacks[0](fbUser('alice'));
    await flush();
    expect(svc.getAuthUser()?.uid).toBe('alice');
    expect(svc.basePath).toBe('users/alice');
    expect(mocks.setDoc).toHaveBeenCalledTimes(1);
  });

  it('Android redirect flow: uses signInWithRedirect and resolves the session on the return trip', async () => {
    (window as unknown as Record<string, unknown>).Capacitor = { isNativePlatform: () => true };
    try {
      const svc = new FirestoreDataService(CONFIG);
      // setupAuth wired getRedirectResult for the native return trip:
      expect(mocks.getRedirectResult).toHaveBeenCalled();
      mocks.signInWithRedirect.mockResolvedValue(undefined);
      const p = svc.signInWithGoogle();
      expect(mocks.signInWithRedirect).toHaveBeenCalled();
      // signInWithGoogle registers its auth-state listener a microtask after the
      // call returns; let it settle, then simulate the WebView return trip.
      await flush();
      for (const cb of mocks.authStateCallbacks) cb(fbUser('alice'));
      await flush();
      await expect(p).resolves.toEqual(expect.objectContaining({ uid: 'alice' }));
      expect(svc.getAuthUser()?.uid).toBe('alice');
      expect(svc.basePath).toBe('users/alice');
      expect(mocks.setDoc).toHaveBeenCalledTimes(1); // profile ensured on return too
    } finally {
      delete (window as unknown as Record<string, unknown>).Capacitor;
    }
  });

  it('signOut clears the session scope', async () => {
    const svc = new FirestoreDataService(CONFIG);
    mocks.authStateCallbacks[0](fbUser('alice'));
    await flush();
    await svc.signOut();
    expect(mocks.signOut).toHaveBeenCalled();
    expect(signOutNativeGoogle).toHaveBeenCalled();
    mocks.authStateCallbacks[0](null); // Firebase emits the signed-out state
    expect(svc.getAuthUser()).toBeNull();
    expect(svc.basePath).toBe('');
  });
});

describe('native Google sign-in on Android', () => {
  beforeEach(() => {
    (window as unknown as Record<string, unknown>).Capacitor = { isNativePlatform: () => true };
    vi.mocked(isNativeGoogleConfigured).mockReturnValue(false);
    vi.mocked(signInWithNativeGoogle).mockReset();
    vi.mocked(signOutNativeGoogle).mockReset();
    // Pretend the profile doc already exists (no duplicate writes).
    mocks.getDoc.mockResolvedValue({ exists: () => true });
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).Capacitor;
  });

  it('native path succeeds: idToken exchanged, same UID, basePath, profile ensured once', async () => {
    vi.mocked(isNativeGoogleConfigured).mockReturnValue(true);
    vi.mocked(signInWithNativeGoogle).mockResolvedValue({
      idToken: 'google-id-token-abc',
      email: 'alice@gmail.com',
      name: 'Alice'
    });
    // signInWithCredential resolves with the same Firebase user:
    mocks.signInWithPopup.mockResolvedValue({ user: fbUser('alice') });

    const svc = new FirestoreDataService(CONFIG);
    const user = await svc.signInWithGoogle();

    expect(user.uid).toBe('alice');
    expect(user.isDemo).toBe(false);
    // The native bridge was called:
    expect(signInWithNativeGoogle).toHaveBeenCalledTimes(1);
    // signInWithRedirect was NOT called — native path succeeded:
    expect(mocks.signInWithRedirect).not.toHaveBeenCalled();

    // The auth-state listener will eventually wire the session:
    mocks.authStateCallbacks[0](fbUser('alice'));
    await flush();
    expect(svc.getAuthUser()?.uid).toBe('alice');
    expect(svc.basePath).toBe('users/alice');
  });

  it('native cancellation throws code CANCELLED, does NOT fall back to redirect', async () => {
    vi.mocked(isNativeGoogleConfigured).mockReturnValue(true);
    vi.mocked(signInWithNativeGoogle).mockRejectedValue(
      new NativeGoogleSignInError('Native Google sign-in was cancelled.', 'CANCELLED')
    );

    const svc = new FirestoreDataService(CONFIG);
    await expect(svc.signInWithGoogle()).rejects.toThrow('cancelled');
    expect(signInWithNativeGoogle).toHaveBeenCalledTimes(1);
    // No redirect fallback for cancellation:
    expect(mocks.signInWithRedirect).not.toHaveBeenCalled();
  });

  it('native failure (e.g. SHA-1 not configured) falls back to signInWithRedirect', async () => {
    vi.mocked(isNativeGoogleConfigured).mockReturnValue(true);
    vi.mocked(signInWithNativeGoogle).mockRejectedValue(
      new NativeGoogleSignInError(
        'Google Sign-In failed: 10: Developer console is not set up correctly',
        'FAILED'
      )
    );
    mocks.signInWithRedirect.mockResolvedValue(undefined);

    const svc = new FirestoreDataService(CONFIG);
    // Redirect flow: fires the promise that waits for onAuthStateChanged.
    const p = svc.signInWithGoogle();
    expect(signInWithNativeGoogle).toHaveBeenCalledTimes(1);
    // Flush so the async function's microtask reaches signInWithRedirect:
    await flush();
    expect(mocks.signInWithRedirect).toHaveBeenCalledTimes(1);
    // Simulate redirect return trip:
    for (const cb of mocks.authStateCallbacks) cb(fbUser('alice'));
    await flush();
    await expect(p).resolves.toEqual(expect.objectContaining({ uid: 'alice' }));
  });

  it('native not configured (no web client ID) uses redirect path directly', async () => {
    vi.mocked(isNativeGoogleConfigured).mockReturnValue(false);
    mocks.signInWithRedirect.mockResolvedValue(undefined);

    const svc = new FirestoreDataService(CONFIG);
    const p = svc.signInWithGoogle();
    expect(signInWithNativeGoogle).not.toHaveBeenCalled();
    expect(mocks.signInWithRedirect).toHaveBeenCalledTimes(1);
    await flush();
    for (const cb of mocks.authStateCallbacks) cb(fbUser('alice'));
    await flush();
    await expect(p).resolves.toEqual(expect.objectContaining({ uid: 'alice' }));
  });

  it('signOut also calls native logout', async () => {
    vi.mocked(isNativeGoogleConfigured).mockReturnValue(true);
    const svc = new FirestoreDataService(CONFIG);
    mocks.authStateCallbacks[0](fbUser('alice'));
    await flush();
    await svc.signOut();
    expect(mocks.signOut).toHaveBeenCalled();
    expect(signOutNativeGoogle).toHaveBeenCalled();
  });
});

describe('AppContext authLoading (login-flash fix)', () => {
  it('stays in Loading until Firebase restores the session, then shows the user', async () => {
    // Force the cloud backend by stubbing env BEFORE AppContext is imported
    // (createService runs at module load).
    vi.stubEnv('VITE_DATA_MODE', 'cloud');
    vi.stubEnv('VITE_FIREBASE_API_KEY', CONFIG.apiKey);
    vi.stubEnv('VITE_FIREBASE_AUTH_DOMAIN', CONFIG.authDomain);
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', CONFIG.projectId);
    vi.stubEnv('VITE_FIREBASE_STORAGE_BUCKET', CONFIG.storageBucket);
    vi.stubEnv('VITE_FIREBASE_MESSAGING_SENDER_ID', CONFIG.messagingSenderId);
    vi.stubEnv('VITE_FIREBASE_APP_ID', CONFIG.appId);

    const { AppProvider, useApp } = await import('./store/AppContext');
    function Probe() {
      const { authLoading, user } = useApp();
      return <div data-testid="probe">{authLoading ? 'loading' : user ? `user:${user.uid}` : 'signed-out'}</div>;
    }
    render(
      <AppProvider>
        <Probe />
      </AppProvider>
    );
    // No login flash: still Loading while Firebase restores the session.
    expect(screen.getByTestId('probe').textContent).toBe('loading');

    act(() => {
      mocks.authStateCallbacks[0](fbUser('alice'));
    });
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('user:alice'));
  });
});
