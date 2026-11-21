/* SK Flex Billing — Electron main process (Windows EXE)
 *
 * The built web app (dist/) is served over a tiny local HTTP server
 * (http://localhost:PORT). This gives the app a stable secure origin
 * (localhost) so Firebase Auth popup sign-in, Firestore offline
 * persistence (IndexedDB) and downloads behave exactly like the web build.
 *
 * The ORIGIN HOST must be `localhost` (not the 127.0.0.1 IP literal):
 * Firebase Web Auth validates the app origin against the project's
 * "Authorized domains" list before opening the Google popup, matching
 * hostnames exactly (IP entries require an exact hostname match).
 * `localhost` is a default authorized domain in every Firebase project,
 * whereas `127.0.0.1` is only allowed if explicitly added in the console
 * — without it the EXE fails Google Sign-In with auth/unauthorized-domain.
 */
const { app, BrowserWindow, shell, Menu, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const googleAuth = require('./googleAuth.cjs');
const http = require('http');
const fs = require('fs');
const path = require('path');

const DIST_DIR = path.join(__dirname, '..', 'dist');

// FIXED local-server port (was random on every launch). The app origin is
// `http://localhost:PORT`, and Chromium partitions localStorage/IndexedDB by
// ORIGIN INCLUDING THE PORT. With a random port every EXE start produced a
// fresh origin, so the persisted Firebase Auth session (and the Firestore
// offline cache) never survived a restart — the user had to do Google
// Sign-In again every time. A stable port keeps the origin identical across
// launches: Firebase Auth restores the session automatically via
// onAuthStateChanged and the user lands straight back in their account.
//
// If the fixed port is already taken (e.g. a second instance), the app falls
// back to a random free port and keeps working — only persistence across
// restarts is unavailable in that rare case.
const APP_PORT = 38991;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json'
};

function startServer(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url, 'http://127.0.0.1');
        let pathname = decodeURIComponent(url.pathname);
        if (pathname === '/' || pathname === '') pathname = '/index.html';
        const filePath = path.normalize(path.join(DIST_DIR, pathname));
        if (!filePath.startsWith(path.normalize(DIST_DIR))) {
          res.writeHead(403);
          res.end('Forbidden');
          return;
        }
        fs.readFile(filePath, (err, data) => {
          if (err) {
            res.writeHead(404);
            res.end('Not found');
            return;
          }
          res.writeHead(200, {
            'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
            'Cache-Control': 'no-cache'
          });
          res.end(data);
        });
      } catch (e) {
        res.writeHead(500);
        res.end('Server error');
      }
    });
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

let win = null;
// Origin of the app's own page; Google sign-in requests are only accepted from it.
let APP_URL = '';

/* ----------------------------------------------------------------
   Updates (electron-updater → GitHub releases)
   ---------------------------------------------------------------- */

function versionGt(a, b) {
  const pa = String(a || '').replace(/^v/i, '').split(/[+-]/)[0].split('.').map((n) => Number(n) || 0);
  const pb = String(b || '').replace(/^v/i, '').split(/[+-]/)[0].split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

function setupUpdater() {
  ipcMain.handle('skflex:update-check', async () => {
    if (!app.isPackaged) {
      return { state: 'up-to-date', version: app.getVersion() };
    }
    try {
      const result = await autoUpdater.checkForUpdates();
      const latest = result && result.updateInfo ? result.updateInfo.version : '';
      const installed = app.getVersion();
      if (latest && versionGt(latest, installed)) {
        const notes = result.updateInfo.releaseNotes;
        return {
          state: 'update-available',
          version: latest,
          notes: typeof notes === 'string' ? notes : '',
          releaseUrl: `https://github.com/2navinkishore2-wq/sk-flex/releases/tag/v${latest}`
        };
      }
      return { state: 'up-to-date', version: installed };
    } catch (e) {
      return { state: 'error', error: (e && e.message) || 'Update check failed' };
    }
  });

  ipcMain.handle('skflex:update-download', async () => {
    if (!app.isPackaged) return { ok: false, error: 'Updates are only checked in the installed app.' };
    try {
      await autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e && e.message) || 'Download failed' };
    }
  });

  ipcMain.handle('skflex:update-install', async () => {
    if (!app.isPackaged) return { ok: false, error: 'Updates are only installed in the installed app.' };
    try {
      // Give the IPC reply a chance to reach the renderer before quitting.
      setImmediate(() => autoUpdater.quitAndInstall(false, true));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e && e.message) || 'Install failed' };
    }
  });

  if (!app.isPackaged) return;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('download-progress', (p) => {
    if (win) win.webContents.send('skflex:update-progress', { percent: p.percent || 0, state: 'downloading' });
  });
  autoUpdater.on('update-downloaded', () => {
    if (win) win.webContents.send('skflex:update-progress', { percent: 100, state: 'downloaded' });
  });
  autoUpdater.on('error', (e) => {
    console.error('[updater]', e && e.message ? e.message : e);
  });
}

/* ----------------------------------------------------------------
   Google sign-in (system browser + PKCE loopback)
   ---------------------------------------------------------------- */

function setupGoogleAuth() {
  ipcMain.handle('skflex:google-signin', async (event, opts) => {
    // Only our own page may start a sign-in. The OAuth client id is a public
    // value, so the renderer sends it; the token exchange stays in main.
    const senderUrl = (event.senderFrame && event.senderFrame.url) || '';
    if (APP_URL && !senderUrl.startsWith(APP_URL)) {
      return { ok: false, code: 'UNEXPECTED_ORIGIN', error: 'Sign-in request came from an unexpected origin.' };
    }
    const clientId = String((opts && opts.clientId) || '').trim();
    if (!clientId) {
      return { ok: false, code: 'NOT_CONFIGURED', error: 'No Google desktop OAuth client ID is configured.' };
    }
    try {
      const { idToken } = await googleAuth.signInWithSystemBrowser({
        clientId,
        loginHint: opts && opts.loginHint,
        openExternal: (url) => shell.openExternal(url)
      });
      // Requirement: the app regains focus once the browser completes.
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      }
      return { ok: true, idToken };
    } catch (e) {
      const code = (e && e.code) || 'FAILED';
      const message = (e && e.message) || 'Google sign-in failed.';
      // Message only — never the token, never the raw provider response body.
      console.error('[google-auth]', code, message);
      return { ok: false, code, error: message };
    }
  });
}

async function createWindow() {
  // Try the fixed port first so the session origin stays stable between runs.
  let server;
  try {
    server = await startServer(APP_PORT);
  } catch (e) {
    if (e && e.code !== 'EADDRINUSE') throw e;
    // Port busy (another instance is running): use any free port. This
    // instance keeps working; persistence belongs to the first instance.
    server = await startServer(0);
  }
  const port = server.address().port;
  // Bind stays on loopback (127.0.0.1) for security; the app ORIGIN uses
  // `localhost` so Firebase Auth's authorized-domain check passes.
  const url = `http://localhost:${port}/`;
  APP_URL = url;

  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'SK Flex Billing',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Read by the preload script so Settings → About can show the installed
      // version without an async IPC round trip.
      additionalArguments: [`--app-version=${app.getVersion()}`]
    }
  });

  win.setMenuBarVisibility(false);
  Menu.setApplicationMenu(null);

  // Allow Firebase/Google auth popups (they postMessage the result back);
  // everything else opens in the system browser.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    const isAuth =
      target.includes('firebaseapp.com') ||
      target.includes('accounts.google.com') ||
      target.includes('googleapis.com') ||
      target.includes('google.com');
    if (isAuth) {
      return { action: 'allow' };
    }
    shell.openExternal(target);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, target) => {
    // Keep the app pinned to our local origin.
    if (!target.startsWith(url)) {
      event.preventDefault();
      shell.openExternal(target);
    }
  });

  win.loadURL(url);
}

app.whenReady().then(() => {
  setupUpdater();
  setupGoogleAuth();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
