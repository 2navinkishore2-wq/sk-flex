import { initializeApp, getApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  signInWithCredential,
  getRedirectResult,
  onAuthStateChanged,
  signOut as fbSignOut,
  connectAuthEmulator,
  type User as FirebaseUser
} from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  persistentSingleTabManager,
  memoryLocalCache,
  connectFirestoreEmulator,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  query as fq,
  where,
  orderBy,
  limit as fLimit,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  Timestamp,
  onSnapshotsInSync,
  terminate,
  writeBatch,
  type Firestore,
  type QueryConstraint,
  type DocumentReference
} from 'firebase/firestore';
import type { AuthUser, SyncStatus } from '../lib/types';
import { formatInvoiceNumber, parseInvoiceNumber } from '../lib/billing';
import { seedFramePricesIfEmpty } from '../lib/frameRates';
import type { DataService, QuerySpec } from './data';
import { isNative } from '../lib/platform';
import {
  signInWithNativeGoogle,
  signOutNativeGoogle,
  isNativeGoogleConfigured,
  NativeGoogleSignInError
} from '../lib/nativeGoogle';
import { diagLog } from '../lib/diagnostics';

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

export interface EmulatorConfig {
  authHost: string;
  authPort: number;
  firestoreHost: string;
  firestorePort: number;
}

export interface FirestoreServiceOptions {
  /** Use a uniquely-named Firebase app (needed when running multiple services/devices side by side). */
  appName?: string;
  /** Connect to the Firebase emulator instead of production (dev/testing only). */
  emulator?: EmulatorConfig;
}

export function readFirebaseConfig(env: Record<string, string | undefined>): FirebaseConfig | null {
  // Trim every value: stray whitespace in .env would silently break auth/DNS.
  const cfg: FirebaseConfig = {
    apiKey: (env.VITE_FIREBASE_API_KEY || '').trim(),
    authDomain: (env.VITE_FIREBASE_AUTH_DOMAIN || '').trim(),
    projectId: (env.VITE_FIREBASE_PROJECT_ID || '').trim(),
    storageBucket: (env.VITE_FIREBASE_STORAGE_BUCKET || '').trim(),
    messagingSenderId: (env.VITE_FIREBASE_MESSAGING_SENDER_ID || '').trim(),
    appId: (env.VITE_FIREBASE_APP_ID || '').trim()
  };
  const missing = Object.values(cfg).some((v) => !v);
  return missing ? null : cfg;
}

function tsToIso(v: unknown): string {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  return new Date(0).toISOString();
}

/** Convert a Firestore snapshot to a plain object with ISO timestamps + id. */
function normalizeDoc<T extends { id: string }>(id: string, data: Record<string, unknown>): T {
  const out: Record<string, unknown> = { id };
  for (const [k, v] of Object.entries(data)) {
    out[k] = v instanceof Timestamp ? tsToIso(v) : v;
  }
  return out as T;
}

/**
 * Strip anything that could be a credential/token/API key from an error
 * message before it is logged or shown in the UI, and keep it short.
 */
function sanitizeSyncError(raw: string): string {
  const cleaned = raw
    .replace(/\bAIza[0-9A-Za-z_-]{35}\b/g, '[redacted-key]')
    .replace(/[?&](?:key|apiKey|token|id_token|access_token|refresh_token)=[^&\s]+/gi, ' [redacted]')
    .replace(/https?:\/\/[^\s)]+/g, '[url]')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > 140 ? `${cleaned.slice(0, 137)}…` : cleaned;
}

export class FirestoreDataService implements DataService {
  readonly kind = 'firestore' as const;
  readonly isCloud = true;
  basePath: string;
  private app: FirebaseApp | null = null;
  private db: Firestore | null = null;
  private authUser: AuthUser | null = null;
  private authListeners = new Set<(u: AuthUser | null) => void>();
  private connectivityListeners = new Set<(online: boolean) => void>();
  private syncListeners = new Set<(s: SyncStatus) => void>();
  private online = typeof navigator !== 'undefined' ? navigator.onLine : true;
  private pendingWrites = 0;
  private syncStatus: SyncStatus = 'synced';
  private lastSyncError: string | null = null;
  private syncUnsub: (() => void) | null = null;
  private syncErrorListeners = new Set<(m: string | null) => void>();
  private frameRatesSeeded = false;
  private ensuredUsers = new Set<string>();

  constructor(config: FirebaseConfig, opts: FirestoreServiceOptions = {}) {
    const fbConfig = {
      apiKey: config.apiKey,
      authDomain: config.authDomain,
      projectId: config.projectId,
      storageBucket: config.storageBucket,
      messagingSenderId: config.messagingSenderId,
      appId: config.appId
    };
    this.app = opts.appName
      ? (getApps().find((a) => a.name === opts.appName) ?? initializeApp(fbConfig, opts.appName))
      : getApps().length
        ? getApp()
        : initializeApp(fbConfig);
    // Node (emulator tests / SSR) has no native IndexedDB. The verification
    // script polyfills it with fake-indexeddb so offline behavior matches the
    // browser exactly; fall back to the in-memory cache if no IndexedDB exists.
    const isNode = typeof process !== 'undefined' && !!process.versions?.node;
    const hasIndexedDb = typeof indexedDB !== 'undefined';
    this.db = initializeFirestore(this.app, {
      localCache: isNode && !hasIndexedDb
        ? memoryLocalCache()
        : isNode
          ? persistentLocalCache({ tabManager: persistentSingleTabManager(undefined) })
          : persistentLocalCache({ tabManager: persistentMultipleTabManager() })
    });
    if (opts.emulator) {
      connectFirestoreEmulator(this.db, opts.emulator.firestoreHost, opts.emulator.firestorePort);
    }
    this.basePath = '';
    this.setupConnectivity();
    this.setupAuth(opts.emulator);
  }

  // ---------------------------------------------------------------- auth
  private setupAuth(emulator?: EmulatorConfig) {
    const auth = getAuth(this.app!);
    if (emulator) {
      // Must run before any sign-in attempt; only ever wired for dev/testing.
      connectAuthEmulator(auth, `http://${emulator.authHost}:${emulator.authPort}`, { disableWarnings: true });
    }
    // Single source of truth for the session: fires on popup sign-in, on the
    // return trip of the Android redirect flow, and on session restore after a
    // page reload. The profile doc is ensured here so every path (including
    // Android + reload) creates it exactly once.
    onAuthStateChanged(auth, (user) => {
      // TEMP-DIAG: auth events around the save (session restore / reset?)
      diagLog('auth.onAuthStateChanged', { signedIn: !!user, uid: user ? user.uid : null });
      const authUser = user ? this.toAuthUser(user) : null;
      this.authUser = authUser;
      this.basePath = authUser ? `users/${authUser.uid}` : '';
      this.authListeners.forEach((cb) => cb(this.authUser));
      if (authUser) {
        void this.ensureUserDoc(authUser);
        // Populate the real frame-rate table once per session, only when the
        // user's frameRates collection is empty (never overwrites/duplicates).
        if (!this.frameRatesSeeded) {
          this.frameRatesSeeded = true;
          void seedFramePricesIfEmpty(this);
        }
      } else {
        this.frameRatesSeeded = false;
      }
    });
    // Android/Capacitor uses the redirect flow: resolve any pending result.
    if (isNative()) {
      getRedirectResult(auth).catch(() => undefined);
    }
  }

  private toAuthUser(user: FirebaseUser): AuthUser {
    return {
      uid: user.uid,
      name: user.displayName || user.email?.split('@')[0] || 'User',
      email: user.email,
      photoURL: user.photoURL,
      isDemo: false
    };
  }

  async signInWithGoogle(): Promise<AuthUser> {
    const auth = getAuth(this.app!);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    if (isNative()) {
      // TEMP-DIAG: capture the native error so a combined message can be shown
      // when both the native and redirect paths fail (remove after diagnosis).
      let nativeErr: string | null = null;
      // Native Credential Manager path — obtains a Google ID token and
      // exchanges it with Firebase via signInWithCredential (same UID as the
      // web popup path because Firebase federates by Google account). Falls
      // back to the JS SDK redirect flow if native is unavailable or mis-      // configured.
      if (isNativeGoogleConfigured()) {
        try {
          const { idToken } = await signInWithNativeGoogle();
          const cred = GoogleAuthProvider.credential(idToken);
          const result = await signInWithCredential(auth, cred);
          return this.toAuthUser(result.user);
        } catch (e) {
          if (e instanceof NativeGoogleSignInError && e.code === 'CANCELLED') {
            throw e;
          }
          nativeErr = (e as Error).message || String(e);
          // TEMP-DIAG: also visible in Logcat under the Chromium tag.
          console.error('[auth-diagnostic] native Google sign-in error:', nativeErr);
        }
      }

      // The WebView navigates to Google and back to the app; the page context
      // reloads, so the session is resolved on the return trip by
      // setupAuth -> getRedirectResult + onAuthStateChanged. Wait for that
      // session here instead of racing getRedirectResult (which is null until
      // the return navigation).
      try {
        await signInWithRedirect(auth, provider);
        return await new Promise<AuthUser>((resolve, reject) => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          const unsub = onAuthStateChanged(auth, (u) => {
            if (u) {
              if (timer) clearTimeout(timer);
              unsub();
              resolve(this.toAuthUser(u));
            }
          });
          timer = setTimeout(() => {
            unsub();
            reject(new Error('sign-in-was-cancelled'));
          }, 30000);
          // Keep Node (tests) from hanging on the safety timer.
          if (typeof (timer as unknown as { unref?: () => void }).unref === 'function') {
            (timer as unknown as { unref: () => void }).unref();
          }
        });
      } catch (e) {
        const redirectErr = (e as Error).message || String(e);
        // TEMP-DIAG: label the failing path(s) so the exact error is visible.
        console.error('[auth-diagnostic] redirect flow error:', redirectErr);
        if (nativeErr) {
          throw new Error(`[native-google] ${nativeErr} | [redirect] ${redirectErr}`);
        }
        throw new Error(`[redirect] ${redirectErr}`);
      }
    }
    const cred = await signInWithPopup(auth, provider);
    return this.toAuthUser(cred.user);
  }

  async signInDemo(_name: string): Promise<AuthUser> {
    throw new Error('Demo sign-in is not available with the cloud backend.');
  }

  async signOut(): Promise<void> {
    await Promise.all([
      fbSignOut(getAuth(this.app!)),
      // Best-effort: clear the native Google credential (silent failure is OK).
      signOutNativeGoogle()
    ]);
  }

  getAuthUser(): AuthUser | null {
    return this.authUser;
  }

  onAuthChange(cb: (u: AuthUser | null) => void): () => void {
    this.authListeners.add(cb);
    return () => this.authListeners.delete(cb);
  }

  private async ensureUserDoc(user: AuthUser) {
    if (!this.db || this.ensuredUsers.has(user.uid)) return;
    this.ensuredUsers.add(user.uid);
    try {
      const ref = doc(this.db, `users/${user.uid}`);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        await setDoc(ref, {
          name: user.name,
          email: user.email || '',
          photoURL: user.photoURL || '',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      }
    } catch {
      // Transient failure (e.g. offline): allow a later session event to retry.
      this.ensuredUsers.delete(user.uid);
    }
  }

  // ----------------------------------------------------------- documents
  private col(name: string) {
    if (!this.db || !this.basePath) throw new Error('not-authenticated');
    return collection(this.db, this.basePath, name);
  }

  private docRef(name: string, id: string) {
    if (!this.db || !this.basePath) throw new Error('not-authenticated');
    return doc(this.db, this.basePath, name, id);
  }

  private buildQuery(name: string, spec?: QuerySpec) {
    const c = this.col(name);
    const constraints: QueryConstraint[] = [];
    if (spec?.where) {
      for (const w of spec.where) {
        if (w.op === '==') constraints.push(where(w.field, '==', w.value));
        else if (w.op === '>') constraints.push(where(w.field, '>', w.value));
        else if (w.op === '>=') constraints.push(where(w.field, '>=', w.value));
        else if (w.op === '<') constraints.push(where(w.field, '<', w.value));
        else if (w.op === '<=') constraints.push(where(w.field, '<=', w.value));
      }
    }
    if (spec?.orderBy) constraints.push(orderBy(spec.orderBy.field, spec.orderBy.dir));
    if (spec?.limit) constraints.push(fLimit(spec.limit));
    return fq(c, ...constraints);
  }

  async get<T extends { id: string }>(name: string, id: string): Promise<T | null> {
    const snap = await getDoc(this.docRef(name, id));
    return snap.exists() ? normalizeDoc<T>(snap.id, snap.data() as Record<string, unknown>) : null;
  }

  /**
   * Web SDK write promises only resolve after the SERVER acknowledges the
   * write, so while offline they would hang forever and freeze "Save Invoice".
   * Instead, resolve once the write is applied to the LOCAL cache (the SDK
   * queues it and delivers it automatically on reconnect). Real server errors
   * (e.g. permission denied) still reject when online; late failures surface
   * through the sync status pill instead of crashing.
   */
  private raceLocalWrite(ref: DocumentReference, expectExists: boolean, write: Promise<unknown>): Promise<unknown> {
    // Consume rejections so an offline-resolved write that later fails on the
    // server never becomes an unhandled rejection; surface it via sync status
    // AND capture the real error (code + message, sanitized) for diagnostics.
    write.catch((e) => {
      this.captureSyncError(e);
      this.setStatus('error');
    });
    const race = Promise.race([write, this.localApplied(ref, expectExists)]);
    // TEMP-DIAG: mark the exact moment the write resolves (local cache) vs a
    // server-side failure, to correlate with a WebView restart in Logcat.
    race.then(
      () => diagLog('firestore.write.resolved', { expectExists }),
      (e) => diagLog('firestore.write.rejected', { message: (e as Error).message })
    );
    return race;
  }

  private localApplied(ref: DocumentReference, expectExists: boolean): Promise<void> {
    return new Promise((resolve) => {
      let unsub: () => void = () => undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const done = () => {
        if (timer) clearTimeout(timer);
        unsub();
        resolve();
      };
      // Never block the UI forever, even in pathological cases.
      timer = setTimeout(done, 20000);
      unsub = onSnapshot(
        ref,
        (snap) => {
          const pending = snap.metadata.hasPendingWrites || snap.metadata.fromCache;
          if (expectExists ? snap.exists() && pending : !snap.exists() && pending) done();
        },
        () => done()
      );
    });
  }

  async set(name: string, id: string, data: Record<string, unknown>): Promise<void> {
    this.pending();
    try {
      const ref = this.docRef(name, id);
      await this.raceLocalWrite(ref, true, setDoc(ref, { ...data, updatedAt: serverTimestamp() }, { merge: true }));
    } finally {
      this.done();
    }
  }

  async add(name: string, data: Record<string, unknown>): Promise<string> {
    this.pending();
    // TEMP-DIAG: save/write start marker for the white-screen investigation.
    diagLog('firestore.add.start', { name });
    try {
      // Generate the id client-side so the write can resolve locally offline.
      const ref = doc(this.col(name));
      await this.raceLocalWrite(ref, true, setDoc(ref, { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
      diagLog('firestore.add.done', { name, id: ref.id });
      return ref.id;
    } catch (e) {
      diagLog('firestore.add.error', { name, message: (e as Error).message });
      throw e;
    } finally {
      this.done();
    }
  }

  async delete(name: string, id: string): Promise<void> {
    this.pending();
    try {
      const ref = this.docRef(name, id);
      await this.raceLocalWrite(ref, false, deleteDoc(ref));
    } finally {
      this.done();
    }
  }

  async query<T extends { id: string }>(name: string, spec?: QuerySpec): Promise<T[]> {
    const snap = await getDocs(this.buildQuery(name, spec));
    return snap.docs.map((d) => normalizeDoc<T>(d.id, d.data() as Record<string, unknown>));
  }

  watch<T extends { id: string }>(name: string, spec: QuerySpec | undefined, cb: (items: T[]) => void): () => void {
    const q = this.buildQuery(name, spec);
    const unsub = onSnapshot(
      q,
      (snap) => {
        // TEMP-DIAG: live-listener callback marker (fires on every collection
        // change, incl. right after a save) — correlates with the restart.
        diagLog('firestore.watch', { name, docs: snap.docs.length });
        this.setStatus('synced');
        cb(snap.docs.map((d) => normalizeDoc<T>(d.id, d.data() as Record<string, unknown>)));
      },
      (err) => {
        this.captureSyncError(err);
        this.setStatus('error');
      }
    );
    return unsub;
  }

  // ------------------------------------------------------ account data wipe
  /**
   * Clear Data (All) — completely remove the CURRENT ACCOUNT'S BUSINESS DATA:
   *
   *  1. Permanently deletes every account-owned document from Firestore
   *     (customers, invoices — including their embedded items — payments,
   *     ledger, settings, frame rates and the invoice-number counter) under
   *     users/{uid}/... — the real cloud documents, not just frontend state.
   *     Only the signed-in account is touched; other users' data, the
   *     Firebase Authentication account and the profile document are kept.
   *  2. Terminates Firestore and deletes its IndexedDB cache (plus pending
   *     local writes) so deleted records can never reappear after a reopen.
   *
   * The caller reloads the page afterwards; the account then starts fresh
   * (empty lists, Outstanding ₹0) while staying signed in.
   */
  async clearLocalData(): Promise<void> {
    if (this.db && this.basePath) {
      for (const name of ['customers', 'invoices', 'payments', 'ledger', 'frameRates', 'settings']) {
        await this.deleteAllAccountDocs(name);
      }
      // Invoice-number counter — a fresh account starts numbering again.
      try {
        await deleteDoc(doc(this.db, this.basePath, 'counters', 'invoices'));
      } catch {
        /* best-effort: the counter is re-created on the next allocation */
      }
    }
    // Stop the Firestore client first so its IndexedDB handles are released
    // and the cache databases below can actually be deleted.
    if (this.db) {
      try {
        await terminate(this.db);
      } catch {
        /* already terminated */
      }
      this.db = null;
    }
    if (typeof indexedDB === 'undefined') return;
    const names: string[] = [];
    if (typeof indexedDB.databases === 'function') {
      try {
        const dbs = await indexedDB.databases();
        for (const d of dbs) if (d.name && d.name.startsWith('firestore/')) names.push(d.name);
      } catch {
        /* enumeration unsupported (older WebView) — fall through */
      }
    }
    if (names.length === 0 && this.app) {
      // Fallback for environments without indexedDB.databases(): the known
      // Firestore cache database names for this project.
      const project = (this.app.options as { projectId?: string } | undefined)?.projectId;
      if (project) names.push(`firestore/${project}/(default)`, `firestore/${project}/(default).blob`);
    }
    await Promise.all(
      names.map(
        (name) =>
          new Promise<void>((resolve) => {
            try {
              const req = indexedDB.deleteDatabase(name);
              req.onsuccess = () => resolve();
              req.onerror = () => resolve();
              req.onblocked = () => resolve();
            } catch {
              resolve();
            }
          })
      )
    );
  }

  /**
   * Delete every document in one account-owned collection, in pages of 300
   * with batched writes (Firestore allows up to 500 writes per commit), so
   * accounts with many records are handled correctly. Only this user's
   * basePath (users/{uid}) is ever addressed.
   */
  private async deleteAllAccountDocs(name: string): Promise<void> {
    if (!this.db || !this.basePath) return;
    for (;;) {
      const snap = await getDocs(fq(this.col(name), fLimit(300)));
      if (snap.empty) break;
      const batch = writeBatch(this.db);
      for (const d of snap.docs) batch.delete(doc(this.db, this.basePath, name, d.id));
      await batch.commit();
      if (snap.docs.length < 300) break;
    }
  }

  // -------------------------------------------------- invoice number counter
  async nextInvoiceNumber(prefix: string): Promise<string> {
    if (!this.db || !this.basePath) throw new Error('not-authenticated');
    const counterRef = doc(this.db, this.basePath, 'counters', 'invoices');
    try {
      const next = await runTransaction(this.db, async (tx) => {
        const snap = await tx.get(counterRef);
        const n = (snap.exists() ? Number(snap.data()?.next || 0) : 0) + 1;
        tx.set(counterRef, { next: n, updatedAt: serverTimestamp() });
        return n;
      });
      return formatInvoiceNumber(prefix, next);
    } catch {
      // Offline: derive the next number from the newest local invoice. The
      // query shape MUST match the app's cached invoices watch (AppContext
      // orders by createdAt desc) so it can run against the offline cache.
      const all = await this.query<{ id: string; number: string }>('invoices', {
        orderBy: { field: 'createdAt', dir: 'desc' }
      });
      let max = 0;
      for (const inv of all) max = Math.max(max, parseInvoiceNumber(prefix, inv.number));
      return formatInvoiceNumber(prefix, max + 1);
    }
  }

  async reconcileInvoiceNumbers(
    prefix: string,
    invoices: { id: string; number: string; createdAt: string }[]
  ): Promise<number> {
    const seen = new Map<string, string>();
    let fixed = 0;
    const sorted = [...invoices].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    let maxN = 0;
    for (const inv of sorted) maxN = Math.max(maxN, parseInvoiceNumber(prefix, inv.number));
    for (const inv of sorted) {
      if (seen.has(inv.number)) {
        // Duplicate number: renumber the newer document to the next free number.
        maxN += 1;
        const newNumber = formatInvoiceNumber(prefix, maxN);
        await this.set('invoices', inv.id, { number: newNumber, renumbered: true });
        fixed += 1;
      } else {
        seen.set(inv.number, inv.id);
      }
    }
    // Advance the counter past the highest number now in use, so future
    // allocations can never collide with numbers minted while offline.
    if (maxN > 0 && this.db && this.basePath) {
      const counterRef = doc(this.db, this.basePath, 'counters', 'invoices');
      try {
        await runTransaction(this.db, async (tx) => {
          const snap = await tx.get(counterRef);
          const next = snap.exists() ? Number(snap.data()?.next || 0) : 0;
          if (next <= maxN) tx.set(counterRef, { next: maxN + 1, updatedAt: serverTimestamp() });
        });
      } catch {
        // Best-effort: if this fails (e.g. offline), the next session's
        // reconciliation pass will repair any collision.
      }
    }
    return fixed;
  }

  // --------------------------------------------------- connectivity / sync
  private setupConnectivity() {
    // Node 21+ has a global `navigator` but no `window` — guard both.
    if (typeof navigator === 'undefined' || typeof window === 'undefined') return;
    const update = () => {
      this.online = navigator.onLine;
      this.connectivityListeners.forEach((cb) => cb(this.online));
      if (!this.online) this.setStatus('offline');
      else if (this.pendingWrites > 0) this.setStatus('syncing');
      else this.setStatus('synced');
    };
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
  }

  private pending() {
    this.pendingWrites += 1;
    this.setStatus('syncing');
    if (!this.syncUnsub && this.db) {
      this.syncUnsub = onSnapshotsInSync(this.db, () => {
        this.done();
      });
    }
  }

  private done() {
    this.pendingWrites = Math.max(0, this.pendingWrites - 1);
    if (this.pendingWrites === 0) {
      if (this.syncUnsub) {
        this.syncUnsub();
        this.syncUnsub = null;
      }
      // Do NOT flip the pill back to green while a real sync error is pending:
      // a server-rejected write (e.g. permission denied) must stay visible as
      // "Sync error" until the next clean snapshot clears it, instead of being
      // silently overwritten by this write's own cleanup.
      if (this.online && this.lastSyncError === null) this.setStatus('synced');
    }
  }

  private setStatus(s: SyncStatus) {
    if (this.syncStatus === s) return;
    this.syncStatus = s;
    if (s === 'synced') this.clearSyncError();
    this.syncListeners.forEach((cb) => cb(s));
  }

  private captureSyncError(e: unknown) {
    let msg = '';
    if (e && typeof e === 'object') {
      const o = e as { code?: unknown; message?: unknown };
      if (typeof o.message === 'string') msg = o.message;
      if (typeof o.code === 'string' && o.code) msg = msg ? `${o.code}: ${msg}` : o.code;
    }
    if (!msg) msg = String(e);
    this.lastSyncError = sanitizeSyncError(msg);
    // Debug/diagnostic log — sanitized, never contains keys/tokens/credentials.
    console.error('[firestore-sync] error:', this.lastSyncError);
    this.syncErrorListeners.forEach((cb) => cb(this.lastSyncError));
  }

  private clearSyncError() {
    if (this.lastSyncError === null) return;
    this.lastSyncError = null;
    this.syncErrorListeners.forEach((cb) => cb(null));
  }

  isOnline(): boolean {
    return this.online;
  }

  onConnectivityChange(cb: (online: boolean) => void): () => void {
    this.connectivityListeners.add(cb);
    return () => this.connectivityListeners.delete(cb);
  }

  getSyncStatus(): SyncStatus {
    return this.syncStatus;
  }

  onSyncStatusChange(cb: (s: SyncStatus) => void): () => void {
    this.syncListeners.add(cb);
    cb(this.syncStatus);
    return () => this.syncListeners.delete(cb);
  }

  getLastSyncError(): string | null {
    return this.lastSyncError;
  }

  onSyncErrorChange(cb: (message: string | null) => void): () => void {
    this.syncErrorListeners.add(cb);
    cb(this.lastSyncError);
    return () => this.syncErrorListeners.delete(cb);
  }
}
