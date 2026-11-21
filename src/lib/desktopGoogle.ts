/**
 * Windows (Electron) Google sign-in bridge.
 *
 * The desktop app never authenticates inside an embedded browser window. The
 * main process opens the SYSTEM browser at Google's OAuth consent screen, waits
 * on a loopback callback (PKCE, state-validated), exchanges the code and hands
 * back a Google ID token. That token is exchanged with the Firebase JS SDK via
 * signInWithCredential, which federates the SAME Firebase account — same uid
 * and the same users/{uid} data — as the web popup and the Android flow.
 */

import { isElectron } from './platform';

/** Public OAuth *desktop* client id (installed-app client type). */
export function desktopClientId(): string {
  return (import.meta.env.VITE_GOOGLE_DESKTOP_CLIENT_ID || '').trim();
}

export function isDesktopGoogleConfigured(): boolean {
  return isElectron() && !!desktopClientId() && !!window.skFlexBilling?.auth;
}

export class DesktopGoogleSignInError extends Error {
  /** 'CANCELLED' | 'NOT_CONFIGURED' | 'TIMEOUT' | 'FAILED' */
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'DesktopGoogleSignInError';
    this.code = code;
  }
}

export async function signInWithDesktopGoogle(): Promise<{ idToken: string }> {
  const api = typeof window !== 'undefined' ? window.skFlexBilling?.auth : undefined;
  if (!api) {
    throw new DesktopGoogleSignInError(
      'Desktop sign-in is only available in the Windows app.',
      'NOT_CONFIGURED'
    );
  }
  const res = await api.googleSignIn({ clientId: desktopClientId() });
  if (!res || !res.ok || !res.idToken) {
    const code = res?.code || 'FAILED';
    const message = res?.error || 'Google sign-in failed.';
    throw new DesktopGoogleSignInError(message, code);
  }
  return { idToken: res.idToken };
}
