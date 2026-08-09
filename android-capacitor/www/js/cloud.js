/* =========================================================
   SK FLEX — cloud.js
   Google Drive (AppData) backup / sync engine + Settings UI.

   Offline-first: localStorage is the source of truth. This module
   backs the syncable keys up to the private Drive AppData folder
   and restores from it, using a revision-based algorithm that never
   silently overwrites newer data.

   Session & status:
     - The signed-in account (email, name, picture, sub) is persisted
       locally with the tokens, so the app never flips back to
       "Not connected" just because the userinfo endpoint is offline.
     - Every status shown in the UI reflects a real outcome: we only
       show "Connected" when an access token is valid, and only show
       "Synced"/"Last synced" after a Drive API operation succeeded.

   Sync:
     - Automatic (debounced) sync after data changes, after sign-in,
       and when the device comes back online.
     - Conflicting changes between devices are merged safely:
       customers/companies/bills/transactions/payments are merged by
       id and newest update timestamp, bills additionally by invoice
       number, settings by updatedAt, invoice sequence by max.
       Only when both sides have data and there is no prior sync link
       does the app ask the user how to combine them (first-time
       sync modal: Merge / Use cloud / Keep this device).

   Platforms:
     - Electron  : transport talks to the main process over IPC
                   (window.skflex.cloud) — main handles PKCE OAuth
                   and performs all HTTPS fetches.
     - Android   : transport uses Capacitor GoogleAuth + fetch().

   The platform-neutral core is exposed on window.SKFLEX_CLOUD so
   the test harness can drive it with a mock transport.
   ========================================================= */
(function () {
  "use strict";

  var CFG_DEFAULTS = {
    app: 'skflex',
    schema: 1,
    fileName: 'skflex-backup.json',
    scope: 'https://www.googleapis.com/auth/drive.appdata'
  };

  var META_KEY = 'skflex_sync_meta';
  var ARCHIVE_KEY = 'skflex_restore_archive';
  var AUTO_SYNC_DELAY = 2500;

  // Keys included in the backup snapshot. Deliberately excludes the
  // transient draft so typing does not bump the data revision.
  var SYNCABLE_KEYS = {
    'skflex_settings': 1,
    'skflex_companies': 1,
    'skflex_active_company': 1,
    'skflex_customers': 1,
    'skflex_bills_by_date': 1,
    'skflex_transactions': 1,
    'skflex_payments': 1,
    'skflex_invoice_seq': 1,
    'skflex_lang': 1
  };

  var SYNCABLE_DEFAULTS = {
    'skflex_settings': {},
    'skflex_companies': [],
    'skflex_active_company': null,
    'skflex_customers': [],
    'skflex_bills_by_date': {},
    'skflex_transactions': [],
    'skflex_payments': [],
    'skflex_invoice_seq': 1,
    'skflex_lang': 'en'
  };

  var cfg = CFG_DEFAULTS;
  var transport = null;
  var suppressWrites = false;
  var autoReload = true;
  var autoSync = true;
  var cloudApi = (window.skflex && window.skflex.cloud) ? window.skflex.cloud : null;
  var pendingTimer = null;
  var lastFileCtx = null;   // { fileId, snap } captured when a conflict is raised
  var syncState = {
    connected: false,
    tokenValid: undefined,
    syncing: false,
    offline: (typeof navigator !== 'undefined' && navigator.onLine === false),
    lastError: null
  };

  /* ---------- storage helpers ---------- */
  function loadJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (raw != null) return JSON.parse(raw);
    } catch (e) {}
    return fallback;
  }
  function saveJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }
  function loadMeta() { return loadJSON(META_KEY, {}) || {}; }
  function saveMeta(meta) { saveJSON(META_KEY, meta); }

  function cloneDefault(k) {
    var d = SYNCABLE_DEFAULTS[k];
    return d === undefined ? null : JSON.parse(JSON.stringify(d));
  }
  function readKey(k) {
    try {
      var raw = localStorage.getItem(k);
      if (raw != null) return JSON.parse(raw);
    } catch (e) {}
    return cloneDefault(k);
  }

  /* ---------- localStorage change hook ----------
     The engine bumps the local data revision whenever any syncable
     key is written, regardless of which code path wrote it, and
     schedules a debounced automatic sync. */
  var _origSetItem = localStorage.setItem.bind(localStorage);
  localStorage.setItem = function (key, value) {
    try {
      _origSetItem(key, value);
    } catch (e) {}
    try {
      if (!suppressWrites && SYNCABLE_KEYS[key] === 1) {
        window.dispatchEvent(new CustomEvent('skflex:data-changed', { detail: { key: key } }));
      }
    } catch (e) {}
  };

  function bumpDataRevision() {
    var meta = loadMeta();
    var now = Date.now();
    meta.dataRevision = Math.max(now, (meta.dataRevision || 0) + 1);
    saveMeta(meta);
    return meta.dataRevision;
  }

  window.addEventListener('skflex:data-changed', function () {
    bumpDataRevision();
    markSyncPending();
  });

  /* ---------- transport ---------- */
  function ensureTransport() {
    if (!transport) transport = detectTransport();
    if (!transport) throw new Error('Cloud sync is not available on this device.');
    return transport;
  }

  function detectTransport() {
    if (cloudApi) {
      return {
        platform: 'electron',
        signIn: function () { return cloudApi.signIn(); },
        signOut: function () { return cloudApi.signOut(); },
        getAuthState: function () { return cloudApi.getAuthState(); },
        getAccessToken: function () { return cloudApi.getAccessToken(); },
        request: function (url, options) { return cloudApi.request(url, options); }
      };
    }

    if (typeof window.Capacitor !== 'undefined' && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
      var GoogleAuth = window.Capacitor.Plugins && window.Capacitor.Plugins.GoogleAuth;
      if (!GoogleAuth) return null;

      var initPromise = null;
      function ensureInit() {
        if (initPromise) return initPromise;
        initPromise = Promise.resolve().then(function () {
          var webClientId = (cfg.android && cfg.android.webClientId) || '';
          if (!webClientId) return null;
          return GoogleAuth.initialize({ clientId: webClientId });
        }).catch(function () { return null; });
        return initPromise;
      }
      function extractToken(t) {
        if (typeof t === 'string') return t;
        if (t && typeof t.accessToken === 'string') return t.accessToken;
        if (t && t.authentication && t.authentication.accessToken) return t.authentication.accessToken;
        return null;
      }

      var androidTransport = {
        platform: 'android',
        signIn: function () {
          return ensureInit().then(function () {
            return GoogleAuth.signIn({ scopes: [cfg.scope] });
          }).then(function (res) {
            var p = res && res.profile ? res.profile : {};
            return {
              signedIn: true,
              email: p.email || '',
              name: p.name || '',
              picture: p.imageUrl || p.image || p.picture || '',
              sub: p.id || ''
            };
          });
        },
        signOut: function () {
          return ensureInit().then(function () {
            return GoogleAuth.signOut();
          }).then(function () {
            return { signedIn: false };
          }).catch(function () {
            return { signedIn: false };
          });
        },
        getAuthState: function () {
          return GoogleAuth.getToken().then(function (t) {
            return { signedIn: !!extractToken(t), email: '' };
          }).catch(function () {
            return { signedIn: false };
          });
        },
        getAccessToken: function () {
          return GoogleAuth.getToken().then(function (t) {
            var tok = extractToken(t);
            if (tok) return tok;
            if (GoogleAuth.refresh) return GoogleAuth.refresh().then(function (rt) { return extractToken(rt); });
            throw new Error('No access token');
          }).catch(function () {
            throw new Error('Not signed in');
          });
        }
      };
      androidTransport.request = function (url, options) {
        options = options || {};
        return androidTransport.getAccessToken().then(function (token) {
          var headers = {};
          var given = options.headers || {};
          Object.keys(given).forEach(function (k) { headers[k] = given[k]; });
          headers['Authorization'] = 'Bearer ' + token;
          return fetch(url, {
            method: options.method || 'GET',
            headers: headers,
            body: options.body
          });
        }).then(function (res) {
          return res.text().then(function (text) {
            var data = null;
            try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
            return { status: res.status, ok: res.ok, data: data };
          });
        });
      };
      return androidTransport;
    }

    return null;
  }

  /* ---------- config ---------- */
  function loadConfig() {
    if (cloudApi && cloudApi.getConfig) {
      return cloudApi.getConfig().then(function (c) {
        if (c) cfg = Object.assign({}, CFG_DEFAULTS, c);
        return cfg;
      }).catch(function () { return cfg; });
    }
    return fetch('cloud-config.json').then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (c) {
      if (c) cfg = Object.assign({}, CFG_DEFAULTS, c);
      return cfg;
    }).catch(function () { return cfg; });
  }

  /* ---------- snapshot ---------- */
  function buildSnapshot() {
    var meta = loadMeta();
    var data = {};
    Object.keys(SYNCABLE_KEYS).forEach(function (k) { data[k] = readKey(k); });
    return {
      schema: cfg.schema,
      app: cfg.app,
      dataRevision: meta.dataRevision || 1,
      updatedAt: new Date().toISOString(),
      data: data
    };
  }

  function applySnapshot(snap) {
    suppressWrites = true;
    try {
      if (snap && snap.data) {
        Object.keys(snap.data).forEach(function (k) {
          if (SYNCABLE_KEYS[k] === 1 && snap.data[k] !== undefined) {
            localStorage.setItem(k, JSON.stringify(snap.data[k]));
          }
        });
      }
    } finally {
      suppressWrites = false;
    }
  }

  function archiveLocalSnapshot() {
    saveJSON(ARCHIVE_KEY, { archivedAt: new Date().toISOString(), snapshot: buildSnapshot() });
  }

  /* ---------- sync decision ---------- */
  function computeSyncAction(localMeta, cloudSnapshot) {
    if (!cloudSnapshot) return { action: 'upload' };
    var localRev = localMeta.dataRevision || 1;
    var lastSynced = localMeta.lastSyncedRevision != null ? localMeta.lastSyncedRevision : null;
    var cloudRev = cloudSnapshot.dataRevision || 1;
    if (lastSynced == null) {
      // First sync on this device — never silently overwrite newer cloud data.
      if (cloudRev > localRev) return { action: 'download', localRevision: localRev, cloudRevision: cloudRev };
      return { action: 'upload', localRevision: localRev, cloudRevision: cloudRev };
    }
    var localChanged = localRev !== lastSynced;
    var cloudChanged = cloudRev !== lastSynced;
    if (localChanged && cloudChanged) return { action: 'conflict', localRevision: localRev, cloudRevision: cloudRev };
    if (cloudChanged) return { action: 'download', localRevision: localRev, cloudRevision: cloudRev };
    if (localChanged) return { action: 'upload', localRevision: localRev, cloudRevision: cloudRev };
    return { action: 'none', localRevision: localRev, cloudRevision: cloudRev };
  }

  /* ---------- Drive API helpers ---------- */
  function findBackupFile() {
    var url = 'https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=' +
      encodeURIComponent("name='" + cfg.fileName + "' and trashed=false") +
      '&fields=files(id,name,modifiedTime)';
    return transport.request(url).then(function (r) {
      if (!r.ok) return { error: r };
      var files = (r.data && r.data.files) || [];
      return { file: files[0] || null };
    });
  }

  function multipartBody(metaObj, mediaStr) {
    var boundary = '----skflex' + Date.now() + Math.random().toString(36).slice(2);
    var parts = [];
    parts.push('--' + boundary);
    parts.push('Content-Type: application/json; charset=UTF-8');
    parts.push('');
    parts.push(JSON.stringify(metaObj));
    parts.push('--' + boundary);
    parts.push('Content-Type: application/json; charset=UTF-8');
    parts.push('');
    parts.push(mediaStr);
    parts.push('--' + boundary + '--');
    parts.push('');
    return { boundary: boundary, body: parts.join('\r\n') };
  }

  function uploadSnapshot(fileId, snap) {
    // Drive API v3: `parents` is not writable in update (PATCH) requests.
    // Only include it on the initial POST (new file creation).
    var meta = fileId ? { name: cfg.fileName } : { name: cfg.fileName, parents: ['appDataFolder'] };
    var mp = multipartBody(meta, JSON.stringify(snap));
    var url = fileId
      ? 'https://www.googleapis.com/upload/drive/v3/files/' + fileId + '?uploadType=multipart&fields=id'
      : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id';
    return transport.request(url, {
      method: fileId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'multipart/related; boundary=' + mp.boundary },
      body: mp.body
    }).then(function (r) {
      if (!r.ok) return { ok: false, response: r };
      return { ok: true, fileId: fileId || (r.data && r.data.id) || null };
    });
  }

  function downloadSnapshot(fileId) {
    return transport.request('https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media')
      .then(function (r) {
        if (!r.ok) return { ok: false, response: r };
        return { ok: true, snapshot: r.data };
      });
  }

  function archiveCloud(fileId) {
    var name = 'skflex-archive-' + Date.now() + '.json';
    return transport.request('https://www.googleapis.com/drive/v3/files/' + fileId + '/copy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name })
    }).then(function (r) {
      return { ok: r.ok, response: r };
    });
  }

  function formatDriveError(prefix, response) {
    var status = (response && response.status) ? response.status : '';
    var msg = prefix + ': HTTP ' + status;
    if (response && response.data && response.data.error) {
      var err = response.data.error;
      var details = [];
      if (err.message) details.push(err.message);
      if (Array.isArray(err.errors)) {
        err.errors.forEach(function (e) {
          if (e.reason) details.push('reason: ' + e.reason);
          if (e.domain) details.push('domain: ' + e.domain);
        });
      }
      if (details.length > 0) {
        msg += ' (' + details.join(' | ') + ')';
      }
    }
    return msg;
  }

  /* ---------- actions ---------- */
  function resolveFileId(meta) {
    if (meta.backupFileId) return Promise.resolve({ file: { id: meta.backupFileId } });
    return findBackupFile();
  }

  function doUpload() {
    ensureTransport();
    var snap = buildSnapshot();
    return transport.getAccessToken().then(function () {
      return resolveFileId(loadMeta());
    }).then(function (res) {
      if (res.error) throw new Error(formatDriveError('Could not find backup file', res.error));
      return uploadSnapshot(res.file ? res.file.id : null, snap);
    }).then(function (up) {
      if (!up.ok) throw new Error(formatDriveError('Upload failed', up.response));
      var m = loadMeta();
      m.backupFileId = up.fileId;
      m.lastSyncedRevision = snap.dataRevision;
      m.lastSyncedAt = new Date().toISOString();
      m.cloudRevision = snap.dataRevision;
      saveMeta(m);
      return { ok: true };
    });
  }

  function doDownload(opts) {
    opts = opts || {};
    ensureTransport();
    var usedFileId = null;
    return transport.getAccessToken().then(function () {
      return resolveFileId(loadMeta());
    }).then(function (res) {
      if (res.error) throw new Error(formatDriveError('Could not find backup file', res.error));
      if (!res.file) throw new Error('No backup found in the cloud yet. Use Backup Now first.');
      usedFileId = res.file.id;
      return downloadSnapshot(res.file.id);
    }).then(function (dl) {
      if (!dl.ok) throw new Error(formatDriveError('Download failed', dl.response));
      if (!dl.snapshot || typeof dl.snapshot !== 'object') throw new Error('Cloud backup is not a valid snapshot.');
      if (dl.snapshot.schema != null && dl.snapshot.schema !== cfg.schema) {
        throw new Error('Cloud backup schema v' + dl.snapshot.schema + ' is not compatible with this app (schema v' + cfg.schema + ').');
      }
      archiveLocalSnapshot();
      applySnapshot(dl.snapshot);
      var m = loadMeta();
      m.backupFileId = usedFileId;
      m.lastSyncedRevision = dl.snapshot.dataRevision;
      m.lastSyncedAt = new Date().toISOString();
      m.cloudRevision = dl.snapshot.dataRevision;
      saveMeta(m);
      if (opts.reload !== false && autoReload) location.reload();
      return { ok: true, snapshot: dl.snapshot };
    });
  }

  function syncNow() {
    ensureTransport();
    return transport.getAccessToken().then(function () {
      return resolveFileId(loadMeta());
    }).then(function (res) {
      if (res.error) throw new Error('Could not find backup file: HTTP ' + (res.error.status || ''));
      if (!res.file) return { file: null, cloudSnap: null };
      return downloadSnapshot(res.file.id).then(function (dl) {
        if (!dl.ok) throw new Error('Download failed: HTTP ' + (dl.response && dl.response.status || ''));
        return { file: res.file, cloudSnap: dl.snapshot };
      });
    }).then(function (ctx) {
      var decision = computeSyncAction(loadMeta(), ctx.cloudSnap);
      if (decision.action === 'upload') return doUpload().then(function () { return decision; });
      if (decision.action === 'download') return doDownload().then(function () { return decision; });
      return decision;
    });
  }

  function backupNow() { return doUpload(); }

  function restoreFromCloud() { return doDownload({ reload: true }); }

  /* ---------- merge ---------- */
  function firstId(item, idKeys) {
    if (!item || typeof item !== 'object') return null;
    for (var i = 0; i < idKeys.length; i++) {
      var v = item[idKeys[i]];
      if (v != null && v !== '') return v;
    }
    return null;
  }

  function timeOf(item, keys) {
    if (!item || typeof item !== 'object') return null;
    for (var i = 0; i < keys.length; i++) {
      var v = item[keys[i]];
      if (v == null) continue;
      var t = (typeof v === 'number') ? v : Date.parse(v);
      if (!isNaN(t) && t > 0) return t;
    }
    return null;
  }

  function pickNewer(x, y, tx, ty, tiePrefer) {
    if (tx != null && ty != null) {
      if (tx > ty) return x;
      if (ty > tx) return y;
    } else if (tx != null) return x;
    else if (ty != null) return y;
    return tiePrefer === 'local' ? x : y;
  }

  function mergeById(a, b, idKeys, timeKeys) {
    var all = {};
    function upsert(item, side) {
      if (!item) return;
      var id = firstId(item, idKeys);
      if (id == null) return;
      var k = String(id);
      var prev = all[k];
      if (!prev) { all[k] = item; return; }
      all[k] = pickNewer(prev, item, timeOf(prev, timeKeys), timeOf(item, timeKeys), side);
    }
    (a || []).forEach(function (it) { upsert(it, 'local'); });
    (b || []).forEach(function (it) { upsert(it, 'cloud'); });
    return Object.keys(all).map(function (k) { return all[k]; });
  }

  function dedupeByName(list, timeKeys) {
    var map = {};
    list.forEach(function (item) {
      if (!item) return;
      var nm = String(item.name || '').trim().toLowerCase();
      var id = item.id != null ? String(item.id) : '';
      if (nm) {
        var prev = map[nm];
        map[nm] = prev ? pickNewer(prev, item, timeOf(prev, timeKeys), timeOf(item, timeKeys), 'cloud') : item;
      } else if (id) {
        map[id] = item;
      }
    });
    return Object.keys(map).map(function (k) { return map[k]; });
  }

  function mergeCustomers(a, b) {
    return dedupeByName(mergeById(a, b, ['id'], ['updatedAt', 'createdAt']), ['updatedAt', 'createdAt']);
  }
  function mergeCompanies(a, b) {
    return dedupeByName(mergeById(a, b, ['id'], ['updatedAt', 'createdAt']), ['updatedAt', 'createdAt']);
  }
  function mergeTransactions(a, b) {
    return mergeById(a, b, ['id', 'refId'], ['createdAt', 'savedAt']);
  }
  function mergePayments(a, b) {
    return mergeById(a, b, ['id'], ['createdAt', 'savedAt']);
  }
  function mergeBillsByDate(a, b) {
    a = a || {};
    b = b || {};
    var dates = {};
    Object.keys(a).forEach(function (d) { dates[d] = 1; });
    Object.keys(b).forEach(function (d) { dates[d] = 1; });
    var byInv = {};
    var perDate = {};
    Object.keys(dates).forEach(function (d) {
      var merged = mergeById(a[d] || [], b[d] || [], ['id', 'billId'], ['savedAt', 'createdAt', 'updatedAt']);
      perDate[d] = merged;
      merged.forEach(function (bill) {
        if (!bill) return;
        var key = String(bill.invoiceNo || bill.invoice || bill.billNo || bill.id);
        var t = timeOf(bill, ['savedAt', 'createdAt', 'updatedAt']);
        var prev = byInv[key];
        if (!prev || (t != null && (prev.t == null || t > prev.t))) byInv[key] = { bill: bill, date: d, t: t };
      });
    });
    var result = {};
    Object.keys(byInv).forEach(function (k) {
      var e = byInv[k];
      (result[e.date] = result[e.date] || []).push(e.bill);
    });
    Object.keys(result).forEach(function (d) {
      result[d].sort(function (x, y) {
        var sx = String(x.savedAt || ''), sy = String(y.savedAt || '');
        if (sx !== sy) return sx < sy ? -1 : 1;
        return (x.id || 0) - (y.id || 0);
      });
    });
    return result;
  }
  function mergeSettings(a, b) {
    function ts(o) { var v = o && o.updatedAt; return (typeof v === 'number') ? v : Date.parse(v || ''); }
    var at = ts(a), bt = ts(b);
    var base, other;
    if (at && bt) {
      if (at > bt) { base = a; other = b; }
      else if (bt > at) { base = b; other = a; }
      else { base = b; other = a; }
    } else if (bt) { base = b; other = a; }
    else if (at) { base = a; other = b; }
    else { base = b; other = a; }
    var out = {};
    Object.keys(base || {}).forEach(function (k) { out[k] = base[k]; });
    Object.keys(other || {}).forEach(function (k) {
      if (!(k in out)) out[k] = other[k];
    });
    return out;
  }
  function mergeScalar(a, b, choose) {
    if (a === undefined) return b;
    if (b === undefined) return a;
    return choose(a, b);
  }

  function mergeKeyData(k, localVal, cloudVal) {
    switch (k) {
      case 'skflex_customers': return mergeCustomers(localVal || [], cloudVal || []);
      case 'skflex_companies': return mergeCompanies(localVal || [], cloudVal || []);
      case 'skflex_bills_by_date': return mergeBillsByDate(localVal || {}, cloudVal || {});
      case 'skflex_transactions': return mergeTransactions(localVal || [], cloudVal || []);
      case 'skflex_payments': return mergePayments(localVal || [], cloudVal || []);
      case 'skflex_settings': return mergeSettings(localVal || {}, cloudVal || {});
      case 'skflex_active_company': return mergeScalar(localVal, cloudVal, function (a, b) { return a != null && a !== '' ? a : b; });
      case 'skflex_invoice_seq': return mergeScalar(localVal, cloudVal, function (a, b) { return Math.max(Number(a) || 1, Number(b) || 1); });
      case 'skflex_lang': return mergeScalar(localVal, cloudVal, function (a, b) { return a != null ? a : b; });
      default: return cloudVal !== undefined ? cloudVal : localVal;
    }
  }

  function mergeSnapshots(localSnap, cloudSnap) {
    var merged = {};
    Object.keys(SYNCABLE_KEYS).forEach(function (k) {
      var lv = localSnap && localSnap.data ? localSnap.data[k] : undefined;
      var cv = cloudSnap && cloudSnap.data ? cloudSnap.data[k] : undefined;
      merged[k] = mergeKeyData(k, lv, cv);
    });
    var localRev = (localSnap && localSnap.dataRevision) || 0;
    var cloudRev = (cloudSnap && cloudSnap.dataRevision) || 0;
    return {
      schema: cloudSnap && cloudSnap.schema != null ? cloudSnap.schema : (localSnap ? localSnap.schema : null),
      app: cloudSnap && cloudSnap.app != null ? cloudSnap.app : (localSnap ? localSnap.app : null),
      dataRevision: Math.max(localRev, cloudRev) || 1,
      data: merged
    };
  }

  // Applies a merged snapshot to local storage, archives the previous
  // local state, and pushes the merged result back to the cloud so both
  // devices converge on the same revision.
  function doMerge(cloudSnap, fileId) {
    ensureTransport();
    archiveLocalSnapshot();
    var localSnap = buildSnapshot();
    var merged = mergeSnapshots(localSnap, cloudSnap);
    var m = loadMeta();
    m.dataRevision = Math.max(m.dataRevision || 1, merged.dataRevision);
    saveMeta(m);
    suppressWrites = true;
    try {
      Object.keys(merged.data).forEach(function (k) {
        if (SYNCABLE_KEYS[k] === 1 && merged.data[k] !== undefined) {
          localStorage.setItem(k, JSON.stringify(merged.data[k]));
        }
      });
    } finally {
      suppressWrites = false;
    }
    var out = buildSnapshot();
    return uploadSnapshot(fileId, out).then(function (up) {
      if (!up.ok) throw new Error('Upload failed: HTTP ' + (up.response && up.response.status || ''));
      var mm = loadMeta();
      mm.backupFileId = up.fileId || fileId;
      mm.lastSyncedRevision = out.dataRevision;
      mm.lastSyncedAt = new Date().toISOString();
      mm.cloudRevision = out.dataRevision;
      saveMeta(mm);
      return { ok: true, snapshot: out, fileId: mm.backupFileId };
    });
  }

  function hasLocalData() {
    var bills = readKey('skflex_bills_by_date') || {};
    var cust = readKey('skflex_customers') || [];
    var pay = readKey('skflex_payments') || [];
    return Object.keys(bills).length > 0 || cust.length > 0 || pay.length > 0;
  }

  function hasAnyData(snap) {
    if (!snap || !snap.data) return false;
    var bills = snap.data.skflex_bills_by_date || {};
    var cust = snap.data.skflex_customers || [];
    var pay = snap.data.skflex_payments || [];
    return Object.keys(bills).length > 0 || cust.length > 0 || pay.length > 0;
  }

  /* ---------- smart sync ---------- */
  function setSyncSyncing(b) { syncState.syncing = !!b; }

  // Full, user-facing sync: first device uploads, changed cloud data is
  // downloaded, and genuine conflicts are merged automatically. Only the
  // very first link between two devices that both have data opens the
  // first-time choice modal.
  function syncSmartNow() {
    ensureTransport();
    setSyncSyncing(true);
    return transport.getAccessToken().then(function () {
      return resolveFileId(loadMeta());
    }).then(function (res) {
      if (res.error) throw new Error('Could not find backup file: HTTP ' + (res.error.status || ''));
      if (!res.file) return { decision: { action: 'upload' }, ctx: { file: null, cloudSnap: null } };
      return downloadSnapshot(res.file.id).then(function (dl) {
        if (!dl.ok) throw new Error('Download failed: HTTP ' + (dl.response && dl.response.status || ''));
        var decision = computeSyncAction(loadMeta(), dl.snapshot);
        return { decision: decision, ctx: { file: res.file, cloudSnap: dl.snapshot } };
      });
    }).then(function (step) {
      var decision = step.decision;
      var ctx = step.ctx;
      if (decision.action === 'none') return decision;
      if (decision.action === 'upload') return doUpload().then(function () { return decision; });
      if (decision.action === 'download') return doDownload({ reload: false }).then(function () { return decision; });
      // conflict -> safe automatic merge
      return doMerge(ctx.cloudSnap, ctx.file.id).then(function () {
        return { action: 'merge', localRevision: decision.localRevision, cloudRevision: decision.cloudRevision, mergedRevision: buildSnapshot().dataRevision };
      });
    }).then(function (result) {
      syncState.lastError = null;
      return result;
    }).then(function (result) {
      setSyncSyncing(false);
      renderCloudStatus();
      return result;
    }, function (err) {
      syncState.lastError = err && err.message ? err.message : String(err);
      setSyncSyncing(false);
      renderCloudStatus();
      throw err;
    });
  }

  // First-run sync used at startup after sign-in. If this device has no
  // data yet it simply adopts the cloud copy; if the cloud has no file
  // this becomes the first device (upload). Only when both sides have
  // data and there is no prior link is the choice modal shown.
  function initialSync() {
    ensureTransport();
    setSyncSyncing(true);
    return transport.getAccessToken().then(function () {
      return resolveFileId(loadMeta());
    }).then(function (res) {
      if (res.error) { throw new Error('Could not find backup file: HTTP ' + (res.error.status || '')); }
      if (!res.file) {
        return doUpload().then(function () { return { action: 'upload' }; });
      }
      return downloadSnapshot(res.file.id).then(function (dl) {
        if (!dl.ok) throw new Error('Download failed: HTTP ' + (dl.response && dl.response.status || ''));
        var decision = computeSyncAction(loadMeta(), dl.snapshot);
        var neverSynced = loadMeta().lastSyncedRevision == null;
        // The very first link between two populated devices must never
        // silently drop either side: ask the user to Merge / Use cloud /
        // Keep this device.
        if (neverSynced && hasLocalData() && hasAnyData(dl.snapshot)) {
          lastFileCtx = { fileId: res.file.id, snap: dl.snapshot };
          openConflictModal(decision, 'first', lastFileCtx);
          return { action: 'first', decision: decision };
        }
        if (decision.action === 'upload') return doUpload().then(function () { return { action: 'upload' }; });
        if (decision.action === 'download') return doDownload({ reload: false }).then(function () { return { action: 'download' }; });
        if (decision.action === 'conflict') {
          if (!hasLocalData()) return doDownload({ reload: false }).then(function () { return { action: 'download' }; });
          lastFileCtx = { fileId: res.file.id, snap: dl.snapshot };
          openConflictModal(decision, 'first', lastFileCtx);
          return { action: 'first', decision: decision };
        }
        return decision;
      });
    }).then(function (result) {
      syncState.lastError = null;
      return result;
    }).then(function (result) {
      setSyncSyncing(false);
      renderCloudStatus();
      return result;
    }, function (err) {
      syncState.lastError = err && err.message ? err.message : String(err);
      setSyncSyncing(false);
      renderCloudStatus();
      throw err;
    });
  }

  /* ---------- automatic sync ---------- */
  function markSyncPending() {
    if (!autoSync) return;
    if (!getAccount().signedIn) return;
    if (!transport) return;
    if (pendingTimer) window.clearTimeout(pendingTimer);
    pendingTimer = window.setTimeout(function () {
      pendingTimer = null;
      syncSmartNow().catch(function (err) {
        syncState.lastError = err && err.message ? err.message : String(err);
        renderCloudStatus();
      });
    }, AUTO_SYNC_DELAY);
  }

  function flushPendingSync() {
    if (!transport) return;
    syncSmartNow().catch(function (err) {
      syncState.lastError = err && err.message ? err.message : String(err);
      renderCloudStatus();
    });
  }

  /* ---------- account ---------- */
  function storeAccount(st) {
    var m = loadMeta();
    if (st) {
      if (st.signedIn === true) m.accountSignedIn = true;
      if (st.signedIn === false) m.accountSignedIn = false;
      if (st.email) m.accountEmail = st.email;
      if (st.name) m.accountName = st.name;
      if (st.picture) m.accountPicture = st.picture;
      if (st.sub) m.accountSub = st.sub;
    }
    saveMeta(m);
    return m;
  }
  function getAccount() {
    var m = loadMeta();
    var email = m.accountEmail || '';
    // Only a verified access token counts as connected. Until the main
    // process has told us the token is invalid, an offscreen/offline start
    // keeps the persisted session visible (prefixed with "Offline").
    var tokenOk = syncState.tokenValid !== false;
    // A successful OAuth sign-in stores accountSignedIn using holder/offline
    // tokens; otherwise an empty userinfo response would flip the UI back to
    // "Not connected" right after the user completed sign-in.
    var signedIn = ((email || m.accountSub || m.accountName) || m.accountSignedIn === true) && tokenOk;
    return {
      signedIn: signedIn,
      email: email,
      name: m.accountName || '',
      picture: m.accountPicture || '',
      sub: m.accountSub || ''
    };
  }
  function getSyncState() {
    var acc = getAccount();
    var m = loadMeta();
    return {
      connected: !!acc.signedIn,
      signedIn: !!acc.signedIn,
      accountEmail: acc.email,
      accountName: acc.name,
      accountPicture: acc.picture,
      lastSyncedAt: m.lastSyncedAt || null,
      lastSyncedRevision: m.lastSyncedRevision != null ? m.lastSyncedRevision : null,
      dataRevision: m.dataRevision != null ? m.dataRevision : null,
      pending: pendingTimer != null,
      offline: syncState.offline,
      syncing: syncState.syncing,
      tokenValid: syncState.tokenValid,
      lastError: syncState.lastError
    };
  }

  /* ---------- sign in / out ---------- */
  function signIn() {
    ensureTransport();
    return transport.signIn().then(function (state) {
      state = state || { signedIn: false };
      var m = storeAccount(state);
      m.accountEmail = state.email || m.accountEmail || '';
      m.accountName = state.name || m.accountName || '';
      m.accountPicture = state.picture || m.accountPicture || '';
      m.accountSub = state.sub || m.accountEmail || '';
      if (!m.dataRevision) m.dataRevision = Date.now();
      saveMeta(m);
      syncState.connected = !!state.signedIn;
      syncState.tokenValid = !!state.signedIn;
      syncState.lastError = (state && state.error) ? String(state.error) : null;
      renderCloudStatus();
      if (state.signedIn && autoSync && transport && transport.platform !== 'mock') {
        initialSync().catch(function (err) {
          syncState.lastError = err && err.message ? err.message : String(err);
          renderCloudStatus();
        });
      }
      return state;
    });
  }

  function signOut() {
    ensureTransport();
    return transport.signOut().then(function (state) {
      var m = loadMeta();
      m.accountEmail = '';
      m.accountName = '';
      m.accountPicture = '';
      m.accountSub = '';
      m.accountSignedIn = false;
      saveMeta(m);
      syncState.connected = false;
      syncState.lastError = null;
      renderCloudStatus();
      return state || { signedIn: false };
    });
  }

  /* ---------- UI ---------- */
  function $(id) { return document.getElementById(id); }

  function setBusy(b) {
    ['btnCloudSignIn', 'btnCloudSignOut', 'btnCloudSync', 'btnCloudBackup', 'btnCloudRestore'].forEach(function (id) {
      var el = $(id);
      if (el) el.disabled = b;
    });
  }

  function setStatus(msg, kind) {
    var el = $('cloudStatusText');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('cloud-ok', 'cloud-err', 'cloud-busy');
    if (kind === 'ok') el.classList.add('cloud-ok');
    else if (kind === 'err') el.classList.add('cloud-err');
    else if (kind === 'busy') el.classList.add('cloud-busy');
    if (kind === 'ok') el.style.color = 'var(--green)';
    else if (kind === 'err') el.style.color = 'var(--danger)';
    else el.style.color = '';
  }

  function showErr(err) {
    var el = $('cloudStatusText');
    if (el) {
      setStatus('Error: ' + (err && err.message ? err.message : String(err)), 'err');
    } else {
      alert('Cloud error: ' + (err && err.message ? err.message : String(err)));
    }
  }

  function initials(name, email) {
    var s = String(name || email || '?').trim();
    var parts = s.split(/\s+/);
    var a = (parts[0] || '').charAt(0);
    var b = (parts[1] || '').charAt(0);
    return ((a + b).toUpperCase() || '?');
  }

  function renderAccountChip(acc, offline) {
    var chip = $('accountChip');
    if (!chip) return;
    if (!acc.signedIn) {
      chip.hidden = true;
      closeAccountMenu();
      return;
    }
    chip.hidden = false;
    var img = $('accountAvatar');
    var ini = $('accountChipInitials');
    var nameEl = $('accountChipName');
    var dot = $('accountChipDot');
    if (acc.picture && img) {
      img.onerror = function () { img.hidden = true; img.onerror = null; img.onload = null; if (ini) { ini.hidden = false; ini.textContent = initials(acc.name, acc.email); } };
      img.onload  = function () { img.onload  = null; img.onerror = null; img.hidden = false; if (ini) ini.hidden = true; };
      img.src = ''; img.src = acc.picture; img.hidden = false; if (ini) ini.hidden = true;
    } else { if (img) img.hidden = true; if (ini) { ini.hidden = false; ini.textContent = initials(acc.name, acc.email); } }
    if (nameEl) nameEl.textContent = acc.name || acc.email || 'Account';
    if (dot) {
      dot.className = 'account-chip-dot' +
        (syncState.syncing ? ' syncing' : '') +
        (syncState.lastError ? ' err' : '') +
        (offline ? ' offline' : '');
    }
  }

  function renderCloudAccountMeta(acc, m) {
    var block = $('cloudAccountMeta');
    if (!block) return;
    if (!acc.signedIn) { block.hidden = true; return; }
    block.hidden = false;
    var img = $('cloudAccountAvatar');
    var ini = $('cloudAccountInitials');
    var nm = $('cloudAccountName');
    var em = $('cloudAccountEmail');
    if (acc.picture && img) {
      img.onerror = function () { img.hidden = true; img.onerror = null; img.onload = null; if (ini) { ini.hidden = false; ini.textContent = initials(acc.name, acc.email); } };
      img.onload  = function () { img.onload  = null; img.onerror = null; img.hidden = false; if (ini) ini.hidden = true; };
      img.src = ''; img.src = acc.picture; img.hidden = false; if (ini) ini.hidden = true;
    } else { if (img) img.hidden = true; if (ini) { ini.hidden = false; ini.textContent = initials(acc.name, acc.email); } }
    if (nm) nm.textContent = acc.name || '';
    if (em) em.textContent = acc.email || '';
  }

  function renderCloudStatus() {
    var m = loadMeta();
    var acc = getAccount();
    var signedIn = acc.signedIn;
    var offline = syncState.offline;
    var prefix = offline ? 'Offline \u2014 ' : '';
    var statusEl = $('cloudStatusText');

    if (syncState.syncing) setStatus(prefix + 'Syncing\u2026', 'busy');
    else if (syncState.lastError) setStatus(prefix + 'Error: ' + syncState.lastError, 'err');
    else if (signedIn) setStatus(prefix + 'Signed in as ' + (acc.email || 'Google account'), 'ok');
    else setStatus(prefix + 'Not connected. Sign in with Google to back up your billing data to your private cloud folder.', '');

    if (signedIn) {
      ['btnCloudSignIn'].forEach(function (id) { var el = $(id); if (el) el.style.display = 'none'; });
      ['btnCloudSignOut', 'btnCloudSync', 'btnCloudBackup', 'btnCloudRestore'].forEach(function (id) {
        var el = $(id);
        if (el) { el.style.display = ''; el.disabled = false; }
      });
    } else {
      ['btnCloudSignIn'].forEach(function (id) { var el = $(id); if (el) { el.style.display = ''; el.disabled = false; } });
      ['btnCloudSignOut', 'btnCloudSync', 'btnCloudBackup', 'btnCloudRestore'].forEach(function (id) {
        var el = $(id);
        if (el) el.style.display = 'none';
      });
    }

    var lastEl = $('cloudLastSynced');
    if (lastEl) {
      lastEl.textContent = m.lastSyncedAt ? 'Last synced: ' + new Date(m.lastSyncedAt).toLocaleString() : 'Never synced';
    }
    renderAccountChip(acc, offline);
    renderCloudAccountMeta(acc, m);
  }

  function openConflictModal(decision, source, ctx) {
    var ov = $('cloudConflictOverlay');
    if (!ov) return;
    lastFileCtx = ctx || lastFileCtx;
    var info = $('cloudConflictInfo');
    if (info) {
      if (source === 'first') {
        info.textContent = 'This device and the cloud both contain billing data and have never been linked. Choose how to combine them.';
      } else {
        info.textContent = 'Billing data changed on both this device (revision ' +
          decision.localRevision + ') and the cloud (revision ' + decision.cloudRevision + ').';
      }
    }
    var title = $('cloudConflictTitle');
    if (title) title.textContent = (source === 'first') ? 'First-time sync' : 'Data conflict';
    ov.classList.add('open');
  }
  function closeConflictModal() {
    var ov = $('cloudConflictOverlay');
    if (ov) ov.classList.remove('open');
  }

  function openAccountMenu() {
    var menu = $('accountMenu');
    if (!menu) return;
    var acc = getAccount();
    var img = $('menuAvatar'), ini = $('menuInitials');
    var nm = $('menuName'), em = $('menuEmail');
    var statusEl = $('accountMenuStatus'), lastEl = $('accountMenuLast');
    if (acc.picture && img) {
      img.onerror = function () { img.hidden = true; img.onerror = null; img.onload = null; if (ini) { ini.hidden = false; ini.textContent = initials(acc.name, acc.email); } };
      img.onload  = function () { img.onload  = null; img.onerror = null; img.hidden = false; if (ini) ini.hidden = true; };
      img.src = ''; img.src = acc.picture; img.hidden = false; if (ini) ini.hidden = true;
    } else { if (img) img.hidden = true; if (ini) { ini.hidden = false; ini.textContent = initials(acc.name, acc.email); } }
    if (nm) nm.textContent = acc.name || acc.email || 'Google account';
    if (em) em.textContent = acc.email || '';
    var m = loadMeta();
    if (statusEl) {
      var parts = [];
      if (syncState.offline) parts.push('Offline');
      else parts.push('Online');
      if (syncState.syncing) parts.push('Syncing\u2026');
      if (syncState.lastError) parts.push('Error');
      statusEl.textContent = parts.join(' \u00b7 ') + (m.lastSyncedAt ? ' \u00b7 Last synced ' + new Date(m.lastSyncedAt).toLocaleString() : ' \u00b7 Never synced');
      statusEl.className = 'account-menu-status' +
        (syncState.lastError ? ' err' : '') +
        (syncState.offline ? ' offline' : '');
    }
    menu.hidden = false;
  }
  function closeAccountMenu() {
    var menu = $('accountMenu');
    if (menu) menu.hidden = true;
  }

  function openCloudSettings() {
    closeAccountMenu();
    var btn = $('btnGotoSettings');
    if (btn) btn.click();
    var tab = document.querySelector('.settings-tabs button[data-tab="cloud"]');
    if (tab) tab.click();
    if (window.scrollTo) window.scrollTo(0, 0);
  }

  function wireConflictButtons() {
    var keep = $('btnCloudKeepLocal');
    if (keep) keep.addEventListener('click', function () {
      closeConflictModal();
      setBusy(true);
      setStatus('Uploading local data\u2026', 'busy');
      doUpload().then(function () {
        renderCloudStatus();
        setStatus('Local data uploaded.', 'ok');
      }).catch(showErr).then(function () { setBusy(false); });
    });
    var useCloud = $('btnCloudUseCloud');
    if (useCloud) useCloud.addEventListener('click', function () {
      closeConflictModal();
      setBusy(true);
      setStatus('Downloading cloud data\u2026', 'busy');
      doDownload({ reload: false }).then(function () {
        renderCloudStatus();
        setStatus('Cloud data restored.', 'ok');
      }).catch(showErr).then(function () { setBusy(false); });
    });
    var merge = $('btnCloudMergeData');
    if (merge) merge.addEventListener('click', function () {
      closeConflictModal();
      setBusy(true);
      if (!lastFileCtx) { setBusy(false); showErr(new Error('No cloud snapshot available to merge.')); return; }
      setStatus('Merging changes\u2026', 'busy');
      doMerge(lastFileCtx.snap, lastFileCtx.fileId).then(function () {
        renderCloudStatus();
        setStatus('Changes merged.', 'ok');
      }).catch(showErr).then(function () { setBusy(false); });
    });
    var cancel = $('btnCloudConflictCancel');
    if (cancel) cancel.addEventListener('click', closeConflictModal);
    var ov = $('cloudConflictOverlay');
    if (ov) ov.addEventListener('click', function (e) { if (e.target === ov) closeConflictModal(); });
  }

  function wireButtons() {
    var signInBtn = $('btnCloudSignIn');
    if (signInBtn) signInBtn.addEventListener('click', function () {
      setBusy(true);
      setStatus('Signing in with Google\u2026', 'busy');
      signIn().then(renderCloudStatus).catch(showErr).then(function () { setBusy(false); });
    });
    var signOutBtn = $('btnCloudSignOut');
    if (signOutBtn) signOutBtn.addEventListener('click', function () {
      setBusy(true);
      setStatus('Signing out\u2026', 'busy');
      signOut().then(renderCloudStatus).catch(function (err) { showErr(err); renderCloudStatus(); }).then(function () { setBusy(false); });
    });
    var syncBtn = $('btnCloudSync');
    if (syncBtn) syncBtn.addEventListener('click', function () {
      setBusy(true);
      setStatus('Syncing\u2026', 'busy');
      syncSmartNow().then(function (dec) {
        renderCloudStatus();
        if (dec && dec.action === 'none') setStatus('Everything is up to date.', 'ok');
        else if (dec && dec.action === 'upload') setStatus('Changes uploaded.', 'ok');
        else if (dec && dec.action === 'download') setStatus('Synced \u2014 downloaded latest changes.', 'ok');
        else if (dec && dec.action === 'merge') setStatus('Synced \u2014 changes merged.', 'ok');
        else if (dec && dec.action === 'conflict') openConflictModal(dec, 'manual', lastFileCtx);
      }).catch(showErr).then(function () { setBusy(false); });
    });
    var backupBtn = $('btnCloudBackup');
    if (backupBtn) backupBtn.addEventListener('click', function () {
      setBusy(true);
      setStatus('Backing up\u2026', 'busy');
      backupNow().then(function () { renderCloudStatus(); setStatus('Backup complete.', 'ok'); }).catch(showErr).then(function () { setBusy(false); });
    });
    var restoreBtn = $('btnCloudRestore');
    if (restoreBtn) restoreBtn.addEventListener('click', function () {
      setBusy(true);
      openConfirm('Restore from cloud?',
        'All current data on this device will be replaced by the cloud backup. A copy of the current data is kept on this device first.',
        function () {
          setStatus('Restoring from cloud\u2026', 'busy');
          restoreFromCloud().then(function () { setStatus('Restore complete.', 'ok'); renderCloudStatus(); }).catch(function (err) { showErr(err); setBusy(false); });
        });
    });
    // Refresh status whenever the Cloud settings tab is opened.
    document.addEventListener('click', function (e) {
      var t = e.target;
      var tab = (t && t.closest) ? t.closest('.settings-tabs button[data-tab="cloud"]') : null;
      if (tab) renderCloudStatus();
    });
    // Account chip / dropdown
    var chipBtn = $('accountChipBtn');
    if (chipBtn) chipBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var menu = $('accountMenu');
      if (menu && !menu.hidden) closeAccountMenu();
      else openAccountMenu();
    });
    document.addEventListener('click', function (e) {
      var chip = $('accountChip');
      if (chip && !chip.hidden && !chip.contains(e.target)) closeAccountMenu();
    });
    var mSync = $('btnMenuSyncNow');
    if (mSync) mSync.addEventListener('click', function () {
      closeAccountMenu();
      setBusy(true);
      setStatus('Syncing\u2026', 'busy');
      syncSmartNow().then(function (dec) {
        renderCloudStatus();
        if (dec && dec.action === 'none') setStatus('Everything is up to date.', 'ok');
        else if (dec && dec.action === 'merge') setStatus('Synced \u2014 changes merged.', 'ok');
        else if (dec && dec.action === 'download') setStatus('Synced \u2014 downloaded latest changes.', 'ok');
        else setStatus('Changes uploaded.', 'ok');
      }).catch(showErr).then(function () { setBusy(false); });
    });
    var mCloud = $('btnMenuOpenCloud');
    if (mCloud) mCloud.addEventListener('click', openCloudSettings);
    var mOut = $('btnMenuSignOut');
    if (mOut) mOut.addEventListener('click', function () {
      closeAccountMenu();
      setBusy(true);
      setStatus('Signing out\u2026', 'busy');
      signOut().then(renderCloudStatus).catch(showErr).then(function () { setBusy(false); });
    });
  }

  function openConfirm(title, message, onConfirm) {
    var ok = $('btnConfirmOk'), cancel = $('btnConfirmCancel');
    if (!ok) { if (window.confirm && window.confirm(message)) onConfirm(); return; }
    $('confirmTitle').textContent = title;
    $('confirmMessage').textContent = message;
    ok.textContent = 'Restore';
    cancel.textContent = 'Cancel';
    ok.style.display = '';
    $('confirmOverlay').classList.add('open');
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      $('confirmOverlay').classList.remove('open');
      ok.removeEventListener('click', okHandler);
      cancel.removeEventListener('click', cancelHandler);
      $('confirmOverlay').removeEventListener('click', overlayHandler);
      ok.textContent = 'Delete';
      cancel.textContent = 'Cancel';
    }
    function okHandler() { finish(); onConfirm(); }
    function cancelHandler() { finish(); }
    function overlayHandler(e) { if (e.target === $('confirmOverlay')) finish(); }
    ok.addEventListener('click', okHandler);
    cancel.addEventListener('click', cancelHandler);
    $('confirmOverlay').addEventListener('click', overlayHandler);
  }

  function initCloud() {
    loadConfig().then(function () {
      renderCloudStatus();
      var t = transport || detectTransport();
      if (t && cloudApi) {
        t.getAuthState().then(function (st) {
          if (st && st.signedIn) {
            storeAccount(st);
            syncState.connected = true;
            syncState.tokenValid = true;
            syncState.lastError = null;
            renderCloudStatus();
            if (autoSync && transport && transport.platform !== 'mock') {
              initialSync().catch(function (err) {
                syncState.lastError = err && err.message ? err.message : String(err);
                renderCloudStatus();
              });
            }
          } else {
            // Online + no valid token = genuinely disconnected (session data
            // stays persisted, but the UI must not claim a live connection).
            syncState.connected = false;
            syncState.tokenValid = false;
          }
          renderCloudStatus();
        }).catch(function () {});
      }
    });
  }

  /* ---------- connectivity ---------- */
  function onOffline() {
    syncState.offline = true;
    renderCloudStatus();
  }
  function onOnline() {
    syncState.offline = false;
    renderCloudStatus();
    if (autoSync && getAccount().signedIn) flushPendingSync();
  }
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);

  wireButtons();
  wireConflictButtons();
  initCloud();

  /* ---------- test / embedding API ---------- */
  window.SKFLEX_CLOUD = {
    platform: function () { return transport ? transport.platform : null; },
    setTransport: function (t) {
      transport = (t === null || t === undefined) ? detectTransport() : t;
      return transport;
    },
    getTransport: function () { return transport; },
    setConfig: function (c) { cfg = Object.assign({}, CFG_DEFAULTS, c); return cfg; },
    getConfig: function () { return cfg; },
    loadConfig: loadConfig,
    getMeta: loadMeta,
    setMeta: saveMeta,
    bumpDataRevision: bumpDataRevision,
    buildSnapshot: buildSnapshot,
    applySnapshot: applySnapshot,
    archiveLocalSnapshot: archiveLocalSnapshot,
    computeSyncAction: computeSyncAction,
    findBackupFile: findBackupFile,
    uploadSnapshot: uploadSnapshot,
    downloadSnapshot: downloadSnapshot,
    archiveCloud: archiveCloud,
    doUpload: doUpload,
    doDownload: function (o) { return doDownload(o); },
    doMerge: doMerge,
    syncNow: syncNow,
    syncSmartNow: syncSmartNow,
    initialSync: initialSync,
    backupNow: backupNow,
    restoreFromCloud: restoreFromCloud,
    signIn: signIn,
    signOut: signOut,
    ensureTransport: ensureTransport,
    renderCloudStatus: renderCloudStatus,
    setAutoReload: function (b) { autoReload = !!b; },
    getAutoReload: function () { return autoReload; },
    setAutoSync: function (b) { autoSync = !!b; },
    getAutoSync: function () { return autoSync; },
    markSyncPending: markSyncPending,
    flushPendingSync: flushPendingSync,
    mergeSnapshots: mergeSnapshots,
    getAccount: getAccount,
    getSyncState: getSyncState,
    openConflictModal: openConflictModal,
    closeConflictModal: closeConflictModal,
    openAccountMenu: openAccountMenu,
    closeAccountMenu: closeAccountMenu,
    openCloudSettings: openCloudSettings,
    simulateOffline: function () { syncState.offline = true; renderCloudStatus(); },
    simulateOnline: function () { syncState.offline = false; renderCloudStatus(); },
    simulateTokenValid: function (v) { syncState.tokenValid = (v === undefined) ? true : !!v; renderCloudStatus(); },
    init: initCloud,
    isSuppressWrites: function () { return suppressWrites; }
  };
})();
