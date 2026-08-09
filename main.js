const { app, BrowserWindow, ipcMain, dialog, shell, session, net } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');

const offlinePolicy = require('./offline-policy.js');
const cloudConfig = require('./cloud-config.json');

// Keep a global reference of the window object
let mainWindow = null;

// OAuth loopback resources
let oauthServer = null;
let authWin = null;

// Create the main application window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'SK Flex Billing',
    icon: path.join(__dirname, 'assets', 'logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      allowRunningInsecureContent: false
    },
    show: false,
    backgroundColor: '#FAF7F2'
  });

  // Load the main HTML file
  mainWindow.loadFile('index.html');

  // Show window when ready to avoid flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Handle external links - open in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Handle window close
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Enable offline mode - block all network requests except local assets and
// the Google endpoints needed for cloud backup/sync.
function enableOfflineMode() {
  offlinePolicy.installOfflineBlocking(session.defaultSession);
}

/* =========================================================
   Google OAuth (PKCE) + Drive access — main process only.
   Tokens are stored in userData/cloud-tokens.json (0600).
   ========================================================= */
function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function sha256B64url(str) {
  return base64url(crypto.createHash('sha256').update(str).digest());
}
function tokenFile() {
  return path.join(app.getPath('userData'), 'cloud-tokens.json');
}
function loadTokens() {
  try { return JSON.parse(fs.readFileSync(tokenFile(), 'utf8')); } catch (e) { return null; }
}
function saveTokens(tokens) {
  fs.writeFileSync(tokenFile(), JSON.stringify(tokens, null, 2), { mode: 0o600 });
}
function clearTokens() {
  try { fs.unlinkSync(tokenFile()); } catch (e) {}
}
function oauthScope() {
  return cloudConfig.scope + ' openid email profile';
}

/* OAuth client secret — main-process-only, never exposed to the renderer.
   The Google Web OAuth token endpoint requires client_secret on code and
   refresh exchanges. Loaded from SKFLEX_GOOGLE_CLIENT_SECRET env var first,
   then from a local JSON file in userData (oauth-client-secret.json). This
   file is outside the repo, outside the packaged files, and never printed. */
function oauthClientSecretFile() {
  return path.join(app.getPath('userData'), 'oauth-client-secret.json');
}
function oauthClientSecret() {
  const fromEnv = process.env.SKFLEX_GOOGLE_CLIENT_SECRET;
  if (fromEnv) return fromEnv;
  try {
    const raw = fs.readFileSync(oauthClientSecretFile(), 'utf8');
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed.clientSecret === 'string' && parsed.clientSecret) ? parsed.clientSecret : '';
  } catch (e) {
    return '';
  }
}
function requireOauthClientSecret() {
  const secret = oauthClientSecret();
  if (!secret) {
    throw new Error('Google OAuth client secret is not configured (set SKFLEX_GOOGLE_CLIENT_SECRET or add userData/oauth-client-secret.json)');
  }
  return secret;
}

async function fetchUserInfo(accessToken) {
  devLog('OAuth', 'fetchUserInfo: start');
  try {
    const r = await net.fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: 'Bearer ' + accessToken },
      redirect: 'follow'
    });
    devLog('OAuth', 'fetchUserInfo: status ' + r.status);
    return r.ok ? await r.json() : null;
  } catch (e) {
    devLog('OAuth', 'fetchUserInfo: error ' + e.message);
    return null;
  }
}

function devLog(tag, msg) {
  if (process.env.SKFLEX_DEBUG || process.env.NODE_ENV === 'development') {
    console.log('[SK Flex ' + tag + '] ' + msg);
  }
}

async function refreshTokens() {
  const t = loadTokens();
  if (!t || !t.refreshToken) return null;
  devLog('OAuth', 'Refreshing access token');
  try {
    const body = new URLSearchParams({
      client_id: cloudConfig.electron.clientId,
      client_secret: requireOauthClientSecret(),
      refresh_token: t.refreshToken,
      grant_type: 'refresh_token'
    }).toString();
    devLog('OAuth', 'refreshTokens: client_secret_configured=' + (oauthClientSecret().length > 0) + ' (value never logged)');
    const r = await net.fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      redirect: 'follow'
    });
    devLog('OAuth', 'refreshTokens: status ' + r.status);
    if (!r.ok) return null;
    const data = await r.json();
    if (!data.access_token) return null;
    const next = {
      accessToken: data.access_token,
      refreshToken: t.refreshToken,
      expiry: Date.now() + (data.expires_in || 3600) * 1000,
      account: t.account || null
    };
    saveTokens(next);
    return next;
  } catch (e) {
    devLog('OAuth', 'refreshTokens: error ' + (e && e.message ? e.message : String(e)));
    return null;
  }
}

async function getValidAccessToken() {
  let t = loadTokens();
  if (!t || !t.accessToken) return null;
  if (t.expiry && Date.now() > t.expiry - 60000) {
    t = await refreshTokens();
    if (!t) return null;
  }
  return t.accessToken;
}

function stopOauthServer() {
  if (oauthServer) {
    try { oauthServer.close(); } catch (e) {}
    oauthServer = null;
  }
}

async function exchangeCode(code, verifier) {
  const endpoint = 'https://oauth2.googleapis.com/token';
  const clientSecret = requireOauthClientSecret();
  const params = {
    code: code,
    client_id: cloudConfig.electron.clientId,
    client_secret: clientSecret,
    redirect_uri: cloudConfig.electron.redirectUri,
    grant_type: 'authorization_code',
    code_verifier: verifier
  };
  devLog('OAuth', 'exchangeCode: endpoint=' + endpoint);
  devLog('OAuth', 'exchangeCode: client_id=' + params.client_id);
  devLog('OAuth', 'exchangeCode: redirect_uri=' + params.redirect_uri);
  devLog('OAuth', 'exchangeCode: grant_type=' + params.grant_type);
  devLog('OAuth', 'exchangeCode: code_verifier_present=' + (typeof params.code_verifier === 'string' && params.code_verifier.length > 0) +
    ' code_verifier_length=' + (typeof params.code_verifier === 'string' ? params.code_verifier.length : 0));
  devLog('OAuth', 'exchangeCode: client_secret_configured=' + (!!clientSecret && clientSecret.length > 0) + ' (value never logged)');
  if (typeof code === 'string' && code.length) {
    devLog('OAuth', 'exchangeCode: code_length=' + code.length + ' code_head=' + code.slice(0, 4) + ' code_tail=' + code.slice(-4));
  } else {
    devLog('OAuth', 'exchangeCode: code_missing_or_not_string');
  }

  const body = new URLSearchParams(params).toString();
  const r = await net.fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    redirect: 'follow'
  });
  devLog('OAuth', 'exchangeCode: HTTP status=' + r.status);
  if (!r.ok) {
    const text = await r.text();
    devLog('OAuth', 'exchangeCode: response body (redacted)=' + oauthRedact(text));
    const errInfo = oauthErrorInfo(text);
    if (errInfo) {
      devLog('OAuth', 'exchangeCode: google_error=' + errInfo.error + (errInfo.description ? ' description=' + errInfo.description : ''));
      throw new Error('Token exchange failed: HTTP ' + r.status + ' (' + errInfo.error + (errInfo.description ? ': ' + errInfo.description : '') + ')');
    }
    throw new Error('Token exchange failed: HTTP ' + r.status);
  }
  return r.json();
}

function oauthRedact(text) {
  return String(text)
    .replace(/access_token=[^&\s]*/g, 'access_token=[REDACTED]')
    .replace(/refresh_token=[^&\s]*/g, 'refresh_token=[REDACTED]')
    .replace(/id_token=[^&\s]*/g, 'id_token=[REDACTED]')
    .replace(/"access_token"\s*:\s*"[^"]*"/g, '"access_token":"[REDACTED]"')
    .replace(/"refresh_token"\s*:\s*"[^"]*"/g, '"refresh_token":"[REDACTED]"')
    .replace(/"id_token"\s*:\s*"[^"]*"/g, '"id_token":"[REDACTED]"');
}

function oauthErrorInfo(text) {
  try {
    const data = JSON.parse(text);
    if (data && data.error) {
      return {
        error: String(data.error),
        description: data.error_description ? String(data.error_description) : null
      };
    }
  } catch (e) {}
  return null;
}

async function signInGoogle() {
  devLog('OAuth', 'signInGoogle: start');
  const existing = await getValidAccessToken();
  if (existing) {
    const cached = loadTokens();
    const info = await fetchUserInfo(existing);
    const acc = (info && info.email) ? {
      sub: info.sub || '',
      email: info.email || '',
      name: info.name || '',
      picture: info.picture || ''
    } : (cached && cached.account) || null;
    if (acc) {
      try {
        const next = loadTokens();
        next.account = acc;
        saveTokens(next);
      } catch (e) {}
    }
    return { signedIn: true, email: acc ? acc.email : '', name: acc ? acc.name : '', picture: acc ? acc.picture : '', sub: acc ? acc.sub : '' };
  }
  devLog('OAuth', 'signInGoogle: starting full OAuth flow, skipping existing-token path');

  const verifier = base64url(crypto.randomBytes(48));
  const challenge = sha256B64url(verifier);
  const state = base64url(crypto.randomBytes(16));

  const authUrl =
    'https://accounts.google.com/o/oauth2/v2/auth' +
    '?client_id=' + encodeURIComponent(cloudConfig.electron.clientId) +
    '&redirect_uri=' + encodeURIComponent(cloudConfig.electron.redirectUri) +
    '&response_type=code' +
    '&scope=' + encodeURIComponent(oauthScope()) +
    '&code_challenge=' + encodeURIComponent(challenge) +
    '&code_challenge_method=S256' +
    '&state=' + encodeURIComponent(state) +
    '&access_type=offline' +
    '&prompt=consent';

  let settled = false;
  let resolveCode, rejectCode;
  const codePromise = new Promise((res, rej) => { resolveCode = res; rejectCode = rej; });

  stopOauthServer();
  const server = http.createServer((req, res) => {
    let code = null;
    let msg = 'Invalid response. You can close this window.';
    let oauthErr = null;
    try {
      const url = new URL(req.url, cloudConfig.electron.redirectUri);
      devLog('OAuth', 'Loopback request: ' + req.url);
      if (url.pathname === '/oauth/callback') {
        const gotState = url.searchParams.get('state');
        oauthErr = url.searchParams.get('error');
        devLog('OAuth', 'Callback state-match: ' + (gotState === state) + ' hasCode: ' + !!url.searchParams.get('code') + ' oauthErr: ' + oauthErr);
        if (oauthErr) {
          msg = 'Sign-in was cancelled or failed. You can close this window.';
        } else if (!url.searchParams.get('code') || gotState !== state) {
          msg = 'Invalid sign-in response. You can close this window.';
        } else {
          code = url.searchParams.get('code');
          msg = 'Sign-in successful! You can close this window now.';
        }
      }
    } catch (e) {
      oauthErr = e.message;
      devLog('OAuth', 'Callback parsing error: ' + e.message);
    }
    try {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#FAF7F2">' +
        '<div style="text-align:center"><h3 style="color:#A5171E">' + msg + '</h3>' +
        '<p style="color:#6E625C">You can close this window.</p></div></body></html>');
    } catch (e) {}
    if (settled) return;
    settled = true;
    stopOauthServer();
    try { if (authWin && !authWin.isDestroyed()) authWin.close(); } catch (e) {}
    if (code) resolveCode(code);
    else rejectCode(new Error(oauthErr || 'OAuth callback failed'));
  });
  server.on('error', (e) => {
    if (!settled) { settled = true; rejectCode(new Error('Could not start sign-in server: ' + e.message)); }
  });
  oauthServer = server;
  await new Promise((res) => server.listen(cloudConfig.electron.authPort, '127.0.0.1', res));
  devLog('OAuth', 'Loopback server listening on 127.0.0.1:' + cloudConfig.electron.authPort);

  const oauthSession = session.fromPartition('skflex-oauth', { cache: true });
  authWin = new BrowserWindow({
    width: 560,
    height: 680,
    show: true,
    parent: mainWindow || undefined,
    modal: !!mainWindow,
    title: 'Sign in with Google',
    webPreferences: {
      session: oauthSession,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });
  authWin.on('closed', () => {
    devLog('OAuth', 'Auth window closed');
    if (!settled) { settled = true; stopOauthServer(); rejectCode(new Error('Sign-in was cancelled')); }
    authWin = null;
  });
  try {
    await authWin.loadURL(authUrl);
    devLog('OAuth', 'Auth window loaded Google sign-in URL');
  } catch (e) {
    devLog('OAuth', 'Auth window loadURL error: ' + e.message);
    if (!settled) { settled = true; stopOauthServer(); rejectCode(new Error('Could not open Google sign-in')); }
  }

  const code = await codePromise;
  devLog('OAuth', 'Authorization code received from loopback');
  const tokenData = await exchangeCode(code, verifier);
  if (!tokenData.access_token) throw new Error('Token exchange failed');
  console.log('[OAuth Scope Diagnostic] tokenData.scope:', tokenData.scope);
  devLog('OAuth', 'DIAGNOSTIC granted token scope: ' + (tokenData.scope || '(none returned by Google)'));
  devLog('OAuth', 'Sign-in completed, persisting tokens');
  const info = await fetchUserInfo(tokenData.access_token);
  devLog('OAuth', 'userinfo: ' + (info && info.email ? info.email : '(none, token-only sign-in)'));
  const account = (info && info.email) ? {
    sub: info.sub || '',
    email: info.email || '',
    name: info.name || '',
    picture: info.picture || ''
  } : null;
  saveTokens({
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token || null,
    expiry: Date.now() + (tokenData.expires_in || 3600) * 1000,
    account: account
  });
  devLog('OAuth', 'Tokens persisted to userData/cloud-tokens.json');

  return {
    signedIn: true,
    email: account ? account.email : '',
    name: account ? account.name : '',
    picture: account ? account.picture : '',
    sub: account ? account.sub : ''
  };
}

// IPC handlers for desktop features
ipcMain.handle('print-invoice', async (event, htmlContent) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { success: false, error: 'Window not found' };
    
    // Create a hidden window for printing
    const printWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });
    
    await printWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent));
    await printWindow.webContents.print({ silent: false, printBackground: true });
    printWindow.close();
    
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('save-pdf', async (event, { data, filename }) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { success: false, error: 'Window not found' };
    
    const result = await dialog.showSaveDialog(win, {
      title: 'Save PDF',
      defaultPath: path.join(app.getPath('documents'), filename || 'invoice.pdf'),
      filters: [
        { name: 'PDF Files', extensions: ['pdf'] }
      ]
    });
    
    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true };
    }
    
    fs.writeFileSync(result.filePath, Buffer.from(data, 'base64'));
    return { success: true, filePath: result.filePath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('save-file', async (event, { data, filename, filters, isBase64 }) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { success: false, error: 'Window not found' };
    
    const result = await dialog.showSaveDialog(win, {
      title: 'Save File',
      defaultPath: path.join(app.getPath('documents'), filename || 'file'),
      filters: filters || [
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    
    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true };
    }
    
    // If data is base64-encoded, decode it before writing
    const fileData = isBase64 ? Buffer.from(data, 'base64') : data;
    fs.writeFileSync(result.filePath, fileData);
    return { success: true, filePath: result.filePath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-app-path', () => {
  return {
    userData: app.getPath('userData'),
    documents: app.getPath('documents'),
    downloads: app.getPath('downloads')
  };
});

ipcMain.handle('open-external', async (event, url) => {
  try {
    await shell.openExternal(url);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

/* =========================================================
   Cloud backup/sync IPC handlers
   ========================================================= */
ipcMain.handle('cloud:sign-in', async () => {
  try {
    const result = await signInGoogle();
    devLog('OAuth', 'cloud:sign-in resolved: signedIn=' + result.signedIn + ' email=' + (result.email || '(empty)'));
    return result;
  } catch (e) {
    devLog('OAuth', 'cloud:sign-in threw: ' + e.message);
    return { signedIn: false, error: e.message };
  }
});

ipcMain.handle('cloud:sign-out', async () => {
  devLog('OAuth', 'Signing out, clearing tokens');
  clearTokens();
  return { signedIn: false };
});

ipcMain.handle('cloud:get-auth-state', async () => {
  const token = await getValidAccessToken();
  if (!token) { devLog('OAuth', 'get-auth-state: no valid token'); return { signedIn: false }; }
  devLog('OAuth', 'get-auth-state: has valid token');
  const cached = loadTokens();
  const info = await fetchUserInfo(token);
  const acc = (info && info.email) ? {
    sub: info.sub || '',
    email: info.email || '',
    name: info.name || '',
    picture: info.picture || ''
  } : (cached && cached.account) || null;
  return {
    signedIn: true,
    email: acc ? acc.email : '',
    name: acc ? acc.name : '',
    picture: acc ? acc.picture : '',
    sub: acc ? acc.sub : ''
  };
});

ipcMain.handle('cloud:get-access-token', async () => {
  return await getValidAccessToken();
});

ipcMain.handle('cloud:get-config', async () => {
  return {
    app: cloudConfig.app,
    schema: cloudConfig.schema,
    fileName: cloudConfig.fileName,
    scope: cloudConfig.scope,
    electron: {
      clientId: cloudConfig.electron.clientId,
      redirectUri: cloudConfig.electron.redirectUri,
      authPort: cloudConfig.electron.authPort
    },
    android: cloudConfig.android || {}
  };
});

ipcMain.handle('cloud:request', async (event, url, options) => {
  try {
    if (!offlinePolicy.isAllowlisted(String(url))) {
      return { status: 0, ok: false, data: null, error: 'URL not allowed: ' + String(url) };
    }
    const token = await getValidAccessToken();
    if (!token) return { status: 401, ok: false, data: null, error: 'Not signed in' };
    const opts = options || {};
    const headers = Object.assign({}, opts.headers || {}, { Authorization: 'Bearer ' + token });
    const res = await net.fetch(url, {
      method: opts.method || 'GET',
      headers,
      body: opts.body !== undefined ? opts.body : undefined,
      redirect: 'follow'
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }

    if (!res.ok) {
      console.log('[Drive Request Non-2xx Response]');
      console.log('  HTTP status:', res.status);
      if (data && data.error) {
        console.log('  data.error.code:', data.error.code);
        console.log('  data.error.message:', data.error.message);
        if (Array.isArray(data.error.errors)) {
          data.error.errors.forEach((err, idx) => {
            console.log(`  data.error.errors[${idx}].reason:`, err.reason);
            console.log(`  data.error.errors[${idx}].domain:`, err.domain);
          });
        }
      } else {
        console.log('  raw body:', text);
      }
    }

    return { status: res.status, ok: res.ok, data };
  } catch (e) {
    return { status: 0, ok: false, data: null, error: e.message };
  }
});

ipcMain.handle('debug:check-allowlist', async (event, url) => {
  return { url: String(url), allowed: offlinePolicy.isAllowlisted(String(url)) };
});

// App lifecycle
app.whenReady().then(() => {
  enableOfflineMode();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
