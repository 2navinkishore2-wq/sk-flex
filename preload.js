const { contextBridge, ipcRenderer } = require('electron');

// Expose safe, minimal APIs to the renderer process
contextBridge.exposeInMainWorld('skflex', {
  // Print the invoice content
  printInvoice: (htmlContent) => ipcRenderer.invoke('print-invoice', htmlContent),
  
  // Save a PDF file
  savePdf: (data, filename) => ipcRenderer.invoke('save-pdf', { data, filename }),
  
  // Save any file (for backup/export)
  saveFile: (data, filename, filters, isBase64) => ipcRenderer.invoke('save-file', { data, filename, filters, isBase64 }),
  
  // Get application paths
  getAppPath: () => ipcRenderer.invoke('get-app-path'),
  
  // Open external URL in default browser
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  
  // Google Drive cloud backup/sync (handled securely in the main process)
  cloud: {
    // Start the PKCE OAuth sign-in flow. Resolves with { signedIn, email }.
    signIn: () => ipcRenderer.invoke('cloud:sign-in'),
    
    // Sign out and clear stored tokens.
    signOut: () => ipcRenderer.invoke('cloud:sign-out'),
    
    // Check whether a user is currently signed in.
    getAuthState: () => ipcRenderer.invoke('cloud:get-auth-state'),
    
    // Get a valid (possibly refreshed) access token.
    getAccessToken: () => ipcRenderer.invoke('cloud:get-access-token'),
    
    // Get the public cloud config (client IDs, redirect URI, etc).
    getConfig: () => ipcRenderer.invoke('cloud:get-config'),
    
    // Perform an authenticated HTTPS request to a allowlisted Google endpoint.
    // Resolves with { status, ok, data, error }.
    request: (url, options) => ipcRenderer.invoke('cloud:request', url, options)
  },
  
  // Check if running in Electron
  isElectron: true
});
