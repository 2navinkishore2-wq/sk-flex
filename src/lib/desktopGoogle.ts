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

/**
 * Public OAuth client id used by the loopback flow.
 *
 * Preferred: a "Desktop app" client (installed-app type) — Google then accepts
 * any loopback port. Fallback: the existing public WEB client, which works with
 * the app's fixed redirect URI `http://127.0.0.1:38992/oauth2callback` once that
 * exact address is listed under the client's Authorized redirect URIs.
 */
export function desktopClientId(): string {
  return desktopOAuthClient().clientId;
}

/**
 * Which OAuth client the loopback flow will use, and whether it is an installed
 * app ("Desktop") client.
 *
 * A Desktop client accepts the loopback redirect on any port, so the app asks
 * the OS for a free one (the RFC 8252 recommendation). The web-client fallback
 * only works on the fixed, pre-registered address.
 */
export function desktopOAuthClient(): { clientId: string; isInstalledAppClient: boolean } {
  const desktop = (import.meta.env.VITE_GOOGLE_DESKTOP_CLIENT_ID || '').trim();
  if (desktop) return { clientId: desktop, isInstalledAppClient: true };
  return {
    clientId: (import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID || '').trim(),
    isInstalledAppClient: false
  };
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
  const { clientId, isInstalledAppClient } = desktopOAuthClient();
  const res = await api.googleSignIn({ clientId, desktopClient: isInstalledAppClient });
  if (!res || !res.ok || !res.idToken) {
    const code = res?.code || 'FAILED';
    const message = res?.error || 'Google sign-in failed.';
    throw new DesktopGoogleSignInError(message, code);
  }
  return { idToken: res.idToken };
}
