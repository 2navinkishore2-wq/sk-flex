const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('skFlexBilling', {
  platform: process.platform,
  isElectron: true
});
