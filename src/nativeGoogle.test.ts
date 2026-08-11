// @vitest-environment jsdom
/**
 * Bridge-boundary tests for src/lib/nativeGoogle.ts.
 *
 * These mock the Capacitor plugin layer (@capgo/capacitor-social-login) and the
 * platform detection (isNative) to verify that the wrapper correctly extracts
 * the ID token, normalises errors (cancellation vs failure), and refuses to
 * operate when not on Android or when the env var is missing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// hoisted mocks so the vi.mock factory can reference them
const mocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  login: vi.fn(),
  logout: vi.fn()
}));

vi.mock('@capgo/capacitor-social-login', () => ({
  SocialLogin: {
    initialize: mocks.initialize,
    login: mocks.login,
    logout: mocks.logout
  }
}));

vi.mock('./lib/platform', () => ({
  isNative: vi.fn()
}));

import { isNative } from './lib/platform';
import {
  signInWithNativeGoogle,
  signOutNativeGoogle,
  isNativeGoogleConfigured,
  NativeGoogleSignInError
} from './lib/nativeGoogle';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('isNativeGoogleConfigured', () => {
  it('returns false when not on native', () => {
    vi.mocked(isNative).mockReturnValue(false);
    expect(isNativeGoogleConfigured()).toBe(false);
  });

  it('returns false when webClientId env is missing', () => {
    vi.mocked(isNative).mockReturnValue(true);
    // The real .env exists now, so explicitly clear the var for this case.
    vi.stubEnv('VITE_GOOGLE_WEB_CLIENT_ID', '');
    expect(isNativeGoogleConfigured()).toBe(false);
  });

  it('returns true when on native and webClientId is set', () => {
    vi.mocked(isNative).mockReturnValue(true);
    vi.stubEnv('VITE_GOOGLE_WEB_CLIENT_ID', '123456-web.apps.googleusercontent.com');
    expect(isNativeGoogleConfigured()).toBe(true);
  });
});

describe('signInWithNativeGoogle', () => {
  it('throws NOT_CONFIGURED when not on native', async () => {
    vi.mocked(isNative).mockReturnValue(false);
    await expect(signInWithNativeGoogle()).rejects.toThrow(NativeGoogleSignInError);
    await expect(signInWithNativeGoogle()).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
  });

  it('throws NOT_CONFIGURED when webClientId is missing', async () => {
    vi.mocked(isNative).mockReturnValue(true);
    // The real .env exists now, so explicitly clear the var for this case.
    vi.stubEnv('VITE_GOOGLE_WEB_CLIENT_ID', '');
    await expect(signInWithNativeGoogle()).rejects.toThrow(NativeGoogleSignInError);
    await expect(signInWithNativeGoogle()).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
  });

  it('calls plugin initialize + login and returns the idToken from the result', async () => {
    vi.mocked(isNative).mockReturnValue(true);
    vi.stubEnv('VITE_GOOGLE_WEB_CLIENT_ID', '123456-web.apps.googleusercontent.com');

    mocks.initialize.mockResolvedValue(undefined);
    mocks.login.mockResolvedValue({
      provider: 'google',
      result: {
        idToken: 'google-id-token-xyz',
        responseType: 'online',
        accessToken: { token: 'at-123' },
        profile: { email: 'alice@gmail.com', name: 'Alice', id: '12345', familyName: null, givenName: null, imageUrl: null }
      }
    });

    const user = await signInWithNativeGoogle();
    expect(mocks.initialize).toHaveBeenCalledWith({
      google: { webClientId: '123456-web.apps.googleusercontent.com' }
    });
    expect(mocks.login).toHaveBeenCalledWith({ provider: 'google', options: {} });
    expect(user.idToken).toBe('google-id-token-xyz');
    expect(user.email).toBe('alice@gmail.com');
    expect(user.name).toBe('Alice');
  });

  it('throws NO_ID_TOKEN when plugin returns offline response', async () => {
    vi.mocked(isNative).mockReturnValue(true);
    vi.stubEnv('VITE_GOOGLE_WEB_CLIENT_ID', '123456-web.apps.googleusercontent.com');

    mocks.initialize.mockResolvedValue(undefined);
    mocks.login.mockResolvedValue({
      provider: 'google',
      result: { serverAuthCode: 'sac-123', responseType: 'offline' }
    });

    await expect(signInWithNativeGoogle()).rejects.toMatchObject({ code: 'NO_ID_TOKEN' });
  });

  it('normalises cancellation (case-insensitive) to CANCELLED error', async () => {
    vi.mocked(isNative).mockReturnValue(true);
    vi.stubEnv('VITE_GOOGLE_WEB_CLIENT_ID', '123456-web.apps.googleusercontent.com');
    mocks.initialize.mockResolvedValue(undefined);
    mocks.login.mockRejectedValue(new Error('User cancelled the flow'));

    await expect(signInWithNativeGoogle()).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('wraps non-cancellation plugin errors as FAILED', async () => {
    vi.mocked(isNative).mockReturnValue(true);
    vi.stubEnv('VITE_GOOGLE_WEB_CLIENT_ID', '123456-web.apps.googleusercontent.com');
    mocks.initialize.mockResolvedValue(undefined);
    mocks.login.mockRejectedValue(new Error('10: Developer console is not set up correctly'));

    await expect(signInWithNativeGoogle()).rejects.toMatchObject({ code: 'FAILED' });
  });
});

describe('signOutNativeGoogle', () => {
  it('calls plugin logout when native', async () => {
    vi.mocked(isNative).mockReturnValue(true);
    mocks.logout.mockResolvedValue(undefined);
    await signOutNativeGoogle();
    expect(mocks.logout).toHaveBeenCalledWith({ provider: 'google' });
  });

  it('does nothing when not native (best-effort)', async () => {
    vi.mocked(isNative).mockReturnValue(false);
    await signOutNativeGoogle();
    expect(mocks.logout).not.toHaveBeenCalled();
  });

  it('does not throw when plugin logout fails', async () => {
    vi.mocked(isNative).mockReturnValue(true);
    mocks.logout.mockRejectedValue(new Error('Network'));
    await expect(signOutNativeGoogle()).resolves.toBeUndefined();
  });
});