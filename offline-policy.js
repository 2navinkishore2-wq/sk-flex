/* =========================================================
   SK FLEX — offline-policy.js
   Shared network allowlist used by the Electron main process.
   The app is offline-first: everything is blocked except local
   assets and the Google endpoints needed for cloud backup/sync.
   Loaded in Node (CommonJS); also imported by tests.
   ========================================================= */
"use strict";

var ALLOWED_HOSTS = [
  'www.googleapis.com',
  'content.googleapis.com',
  'drive.google.com',
  'oauth2.googleapis.com',
  'accounts.google.com',
  'ssl.gstatic.com',
  'openidconnect.googleapis.com',
  'lh3.googleusercontent.com'
];

function isAllowlisted(url) {
  if (!url) return false;
  if (url.indexOf('file://') === 0 || url.indexOf('data:') === 0 || url.indexOf('about:') === 0) return true;
  try {
    var u = new URL(url);
    if (u.protocol !== 'https:') return false;
    return ALLOWED_HOSTS.indexOf(u.hostname) !== -1;
  } catch (e) {
    return false;
  }
}

function installOfflineBlocking(ses) {
  ses.webRequest.onBeforeRequest(function (details, callback) {
    callback(isAllowlisted(details.url) ? {} : { cancel: true });
  });
  return {
    isAllowlisted: isAllowlisted,
    getAllowedHosts: function () { return ALLOWED_HOSTS.slice(); }
  };
}

module.exports = {
  isAllowlisted: isAllowlisted,
  installOfflineBlocking: installOfflineBlocking,
  ALLOWED_HOSTS: ALLOWED_HOSTS
};
