/**
 * Native Android Google Sign-In bridge.
 *
 * The app's web/Windows build authenticates with the Firebase JS SDK popup
 * flow. Inside the Capacitor Android WebView that flow is unreliable (the
 * OAuth redirect/popup round-trip through the WebView is the classic cause of
 * "APK Google Sign-In doesn't work"). So on Android we obtain a Google ID
 * token natively (Credential Manager) and hand it to the SAME Firebase JS SDK
 * via signInWithCredential. Because Firebase federates by Google account, the
 * resulting Firebase UID is identical to the one the web popup produces for the
 * same account — one user, one UID, one users/{uid} data scope.
 *
 * This module is only ever invoked on the native platform; on web it is never
 * imported (the plugin is code-split via dynamic import).
 */

import { isNative } from './platform';

/** Public Web OAuth client ID (client_type 3) of the Firebase/Google project. */
export function nativeWebClientId(): string {
  return (import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID || '').trim();
}

/** True when we are on Android AND the native bridge is configured. */
export function isNativeGoogleConfigured(): boolean {
  return isNative() && !!nativeWebClientId();
}

export interface NativeGoogleUser {
  idToken: string;
  email?: string | null;
  name?: string | null;
}

export class NativeGoogleSignInError extends Error {
  /** 'CANCELLED' | 'NO_ID_TOKEN' | 'NOT_CONFIGURED' | 'FAILED' */
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'NativeGoogleSignInError';
    this.code = code;
  }
}

/**
 * Sign in with the OS Google account and return the ID token. The caller
 * exchanges the token with Firebase via signInWithCredential.
 */
export async function signInWithNativeGoogle(): Promise<NativeGoogleUser> {
  const webClientId = nativeWebClientId();
  if (!isNative()) {
    throw new NativeGoogleSignInError('Native Google sign-in is only available on Android.', 'NOT_CONFIGURED');
  }
  if (!webClientId) {
    throw new NativeGoogleSignInError(
      'VITE_GOOGLE_WEB_CLIENT_ID is not set. Add your project Web OAuth client ID to .env to enable native Google sign-in.',
      'NOT_CONFIGURED'
    );
  }
  try {
    // Code-split so the web/Electron bundle never pulls in the plugin.
    const { SocialLogin } = await import('@capgo/capacitor-social-login');
    await SocialLogin.initialize({ google: { webClientId } });
    // No custom scopes: the plugin already requests email/profile/openid, which
    // is what we need for the Firebase ID token. (Passing custom scopes would
    // require modifying MainActivity per the plugin docs.)
    const res = await SocialLogin.login({ provider: 'google', options: {} });
    if (res.provider !== 'google' || res.result.responseType !== 'online') {
      throw new NativeGoogleSignInError('Native Google sign-in did not return an online credential.', 'NO_ID_TOKEN');
    }
    const idToken = res.result.idToken;
    if (!idToken) {
      throw new NativeGoogleSignInError('Native Google sign-in returned no ID token.', 'NO_ID_TOKEN');
    }
    return {
      idToken,
      email: res.result.profile?.email ?? null,
      name: res.result.profile?.name ?? null
    };
  } catch (e) {
    if (e instanceof NativeGoogleSignInError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    // TEMP-DIAG: log the raw plugin rejection (message + code) — visible in
    // Logcat under the Chromium tag. Contains no tokens/secrets.
    const rawCode = (e as { code?: unknown })?.code;
    console.error('[auth-diagnostic] capacitor-google plugin error:', msg, rawCode ? `code=${rawCode}` : '');
    // Credential Manager reports cancellation inside the message; be liberal.
    if (/cancel/i.test(msg)) {
      throw new NativeGoogleSignInError('Native Google sign-in was cancelled.', 'CANCELLED');
    }
    throw new NativeGoogleSignInError(`Native Google sign-in failed: ${msg}`, 'FAILED');
  }
}

/** Best-effort native sign-out; Firebase sign-out remains the source of truth. */
export async function signOutNativeGoogle(): Promise<void> {
  if (!isNative()) return;
  try {
    const { SocialLogin } = await import('@capgo/capacitor-social-login');
    await SocialLogin.logout({ provider: 'google' });
  } catch {
    // Ignore — clearing the Firebase session is what protects the data.
  }
}