const { contextBridge, ipcRenderer } = require('electron');

// The main process passes the packaged app version as a Chromium argument so
// the renderer can show "Installed version" synchronously (no IPC round trip).
const versionArg = process.argv.find((a) => a.startsWith('--app-version='));
const appVersion = versionArg ? versionArg.split('=')[1] : undefined;

contextBridge.exposeInMainWorld('skFlexBilling', {
  platform: process.platform,
  isElectron: true,
  version: appVersion,
  auth: {
    // Desktop Google sign-in runs in the SYSTEM browser (PKCE + loopback); the
    // main process performs the token exchange and returns only an ID token.
    googleSignIn: (opts) => ipcRenderer.invoke('skflex:google-signin', opts)
  },
  update: {
    check: () => ipcRenderer.invoke('skflex:update-check'),
    download: () => ipcRenderer.invoke('skflex:update-download'),
    install: () => ipcRenderer.invoke('skflex:update-install'),
    onProgress: (cb) => {
      const listener = (_event, payload) => cb(payload);
      ipcRenderer.on('skflex:update-progress', listener);
      return () => ipcRenderer.removeListener('skflex:update-progress', listener);
    }
  }
});
