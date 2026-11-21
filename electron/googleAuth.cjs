/* SK Flex Billing — desktop Google Sign-In.
 *
 * Installed desktop applications must not be authenticated inside an embedded
 * browser window, and they cannot use the web popup flow either (the popup
 * needs a Firebase "authorized domain" and the app origin, and it breaks in a
 * packaged Electron shell). The supported flow for an installed app is:
 *
 *   1. the app opens the SYSTEM BROWSER at Google's authorize endpoint,
 *   2. the user picks their existing Google account there,
 *   3. Google redirects to a loopback URL (http://127.0.0.1:<port>) that this
 *      app listens on for exactly one callback,
 *   4. the app verifies `state` (CSRF) and exchanges the authorization code for
 *      tokens using PKCE (RFC 7636) — no client secret is involved or stored,
 *   5. the returned Google ID token is handed to the Firebase JS SDK via
 *      signInWithCredential(), which federates the SAME Firebase user (same
 *      uid, same users/{uid} data) as the web popup produced before.
 *
 * This module only ever containing public values: the OAuth *desktop* client id
 * is embedded in the app by design. Tokens never touch disk or logs.
 */
'use strict';

const { createHash, randomBytes, timingSafeEqual } = require('crypto');
const http = require('http');

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const SCOPES = 'openid email profile';
const DEFAULT_TIMEOUT_MS = 180000;
// Fixed loopback redirect for the installed app. A fixed port lets the SAME
// public web OAuth client work when no separate "Desktop app" client exists:
// its authorized redirect URI is simply
//   http://127.0.0.1:38992/oauth2callback
// (38991 is the app's own page server, so never reuse it here).
const DEFAULT_REDIRECT_PORT = 38992;
const REDIRECT_PATH = '/oauth2callback';

function base64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** PKCE verifier + S256 challenge (RFC 7636). */
function createPkcePair() {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function createState() {
  return base64url(randomBytes(24));
}

/** Build the Google authorize URL for the loopback redirect. */
function buildAuthUrl({ clientId, redirectUri, challenge, state, loginHint }) {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  // Always let the user choose the account (shop owners often have several).
  url.searchParams.set('prompt', 'select_account');
  if (loginHint) url.searchParams.set('login_hint', loginHint);
  return url.toString();
}

/**
 * Ask Google up front whether it accepts `redirectUri` for this client.
 *
 * A WEB OAuth client only accepts redirect URIs that are registered in the
 * Google Cloud console. When one is not registered, Google stops at its own
 * "Access blocked / redirect_uri_mismatch" page: the browser never comes back to
 * the loopback listener and the user only sees a timeout minutes later. One
 * unauthenticated GET (no cookies, no tokens) tells us before we open anything.
 *
 * Returns { ok: true } when the URI is accepted (or when the probe itself could
 * not run — the real flow then reports the true error).
 */
async function probeRedirectUri({ clientId, redirectUri }) {
  if (typeof fetch !== 'function') return { ok: true };
  try {
    // A REAL PKCE challenge: Google validates it before the redirect URI, and an
    // invalid one would mask the mismatch we are looking for.
    const { challenge } = createPkcePair();
    const url = buildAuthUrl({ clientId, redirectUri, challenge, state: 'probe' });
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'SKFlexBilling (Windows)' }
    });
    const body = await res.text();
    // Google redirects to /signin/oauth/error?authError=<base64>. The code we
    // care about (redirect_uri_mismatch) lives in that decoded payload.
    let haystack = `${res.url}\n${body}`;
    const errParam = /[?&]authError=([^&]+)/.exec(res.url);
    if (errParam) {
      try {
        haystack += `\n${Buffer.from(decodeURIComponent(errParam[1]), 'base64').toString('utf8')}`;
      } catch {
        /* not base64 — the raw URL is still checked */
      }
    }
    if (/invalid_client/i.test(haystack)) {
      return {
        ok: false,
        code: 'INVALID_CLIENT_ID',
        message: 'Google rejected this OAuth client ID. Check the OAuth client under the sk-flex-billing project.'
      };
    }
    if (/redirect_uri_mismatch/i.test(haystack)) {
      return {
        ok: false,
        code: 'REDIRECT_URI_NOT_REGISTERED',
        message: `Google does not accept ${redirectUri} for this OAuth client.`,
        redirectUri
      };
    }
    return { ok: true };
  } catch {
    return { ok: true };
  }
}

/**
 * Validate the loopback callback. Throws on a missing/mismatched state (a
 * hostile or stale callback is never exchanged) or on a provider error.
 */
function parseCallback(query, expectedState) {
  const state = String(query.state || '');
  const a = Buffer.from(state);
  const b = Buffer.from(String(expectedState || ''));
  const stateOk = a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
  if (!stateOk) throw Object.assign(new Error('Sign-in callback was rejected (state mismatch).'), { code: 'STATE_MISMATCH' });
  if (query.error) {
    const err = String(query.error_description || query.error);
    throw Object.assign(new Error(err), {
      code: /access_denied/i.test(String(query.error)) ? 'CANCELLED' : 'PROVIDER_ERROR'
    });
  }
  const code = String(query.code || '');
  if (!code) throw Object.assign(new Error('Sign-in callback carried no authorization code.'), { code: 'NO_CODE' });
  return { code };
}

function callbackPage(ok, message) {
  const color = ok ? '#0b1a33' : '#7f1d1d';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${ok ? 'SK Flex Billing' : 'Sign-in failed'}</title>
<style>
 html,body{margin:0;height:100%;font-family:'Segoe UI',system-ui,sans-serif;background:${color};color:#fff;
 display:flex;align-items:center;justify-content:center}
 .box{text-align:center;max-width:440px;padding:32px}
 .logo{width:64px;height:64px;border-radius:18px;background:linear-gradient(135deg,#1d4ed8,#0b1a33);
 display:flex;align-items:center;justify-content:center;font-weight:800;font-size:26px;letter-spacing:.5px;margin:0 auto 20px}
 h1{font-size:20px;margin:0 0 10px;font-weight:700}
 p{font-size:14px;line-height:1.5;color:#c7d2fe;margin:0}
</style></head><body><div class="box"><div class="logo">SK</div>
<h1>${ok ? 'Signed in' : 'Sign-in failed'}</h1><p>${message}</p></div></body></html>`;
}

/** Exchange the authorization code for tokens (PKCE — no client secret). */
async function exchangeCode({ code, clientId, redirectUri, verifier }) {
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: verifier
  }).toString();
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const text = await res.text();
  let json = {};
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) {
    // Google's error codes only — never echo the response body (may hold tokens).
    const reason = json && (json.error_description || json.error);
    throw Object.assign(new Error(reason ? String(reason) : `Token exchange failed (HTTP ${res.status}).`), {
      code: 'TOKEN_EXCHANGE_FAILED'
    });
  }
  if (!json || !json.id_token) {
    throw Object.assign(new Error('Google returned no ID token.'), { code: 'NO_ID_TOKEN' });
  }
  // Return ONLY the ID token: Firebase exchanges it for a session; the access
  // and refresh tokens are not needed and are dropped here.
  return { idToken: String(json.id_token) };
}

/**
 * Run the full flow. `openExternal` is Electron's shell.openExternal.
 * Resolves { idToken } — the caller must never log or persist it.
 */
async function signInWithSystemBrowser({
  clientId,
  loginHint,
  openExternal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  redirectPort = DEFAULT_REDIRECT_PORT,
  redirectPath = REDIRECT_PATH
}) {
  if (!clientId) {
    throw Object.assign(new Error('No Google desktop OAuth client ID is configured.'), { code: 'NOT_CONFIGURED' });
  }
  if (typeof openExternal !== 'function') {
    throw Object.assign(new Error('System browser is unavailable.'), { code: 'NO_BROWSER' });
  }

  const { verifier, challenge } = createPkcePair();
  const state = createState();

  const redirectUri = `http://127.0.0.1:${redirectPort}${redirectPath}`;

  // Refuse before opening the browser when Google would reject the redirect:
  // a policy error page never calls back, so waiting would only time out.
  const probe = await probeRedirectUri({ clientId, redirectUri });
  if (!probe.ok) {
    throw Object.assign(new Error(probe.message), { code: probe.code, redirectUri });
  }

  // Loopback listener on the FIXED redirect URL. A "Desktop app" OAuth client
  // accepts any loopback port; a web client accepts this exact address once it
  // is listed under Authorized Redirect URIs.
  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', (e) => {
      if (e && e.code === 'EADDRINUSE') {
        reject(
          Object.assign(
            new Error(
              `Port ${redirectPort} is already in use. Close the other SK Flex Billing window and try again.`
            ),
            { code: 'PORT_IN_USE' }
          )
        );
      } else {
        reject(e);
      }
    });
    server.listen(redirectPort, '127.0.0.1', resolve);
  });

  const result = new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        server.close();
      } catch {
        /* already closed */
      }
      if (err) reject(err);
      else resolve(value);
    };

    const timer = setTimeout(
      () => finish(Object.assign(new Error('Sign-in timed out. Please try again.'), { code: 'TIMEOUT' })),
      timeoutMs
    );
    if (typeof timer.unref === 'function') timer.unref();

    server.on('request', async (req, res) => {
      if (req.method !== 'GET') {
        res.writeHead(405).end();
        return;
      }
      const url = new URL(req.url, redirectUri);
      if (url.pathname !== redirectPath) {
        res.writeHead(404).end();
        return;
      }
      const query = Object.fromEntries(url.searchParams.entries());
      const reply = (ok, message) => {
        // Exactly one response per callback — writing twice throws in Node and
        // would crash the Electron main process after a failed token exchange.
        if (res.headersSent || res.writableEnded) return;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(callbackPage(ok, message));
      };
      try {
        const { code } = parseCallback(query, state);
        // Exchange FIRST, then answer the browser, so the user only sees
        // "Signed in" when a usable token was actually obtained.
        let tokens;
        try {
          tokens = await exchangeCode({ code, clientId, redirectUri, verifier });
        } catch (e) {
          reply(false, 'Google could not complete the sign-in. Return to SK Flex Billing and try again.');
          finish(e);
          return;
        }
        reply(true, 'You can close this window and return to SK Flex Billing.');
        finish(null, tokens);
      } catch (e) {
        reply(false, 'Return to SK Flex Billing and try again.');
        finish(e);
      }
    });
  });

  const authUrl = buildAuthUrl({ clientId, redirectUri, challenge, state, loginHint });
  await openExternal(authUrl);
  return result;
}

module.exports = {
  AUTH_ENDPOINT,
  TOKEN_ENDPOINT,
  DEFAULT_REDIRECT_PORT,
  REDIRECT_PATH,
  base64url,
  createPkcePair,
  createState,
  buildAuthUrl,
  probeRedirectUri,
  parseCallback,
  exchangeCode,
  signInWithSystemBrowser
};
