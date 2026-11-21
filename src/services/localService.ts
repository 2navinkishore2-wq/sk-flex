import type { AuthUser, SyncStatus } from '../lib/types';
import { formatInvoiceNumber, parseInvoiceNumber } from '../lib/billing';
import { SK_PHOTO_FRAME_PRICES } from '../lib/frameRates';
import type { DataService, QuerySpec } from './data';

interface StoreShape {
  collections: Record<string, Record<string, Record<string, unknown>>>;
}

const STORE_KEY = 'skfb:local:v1';
const AUTH_KEY = 'skfb:auth:demo';

export interface LocalServiceOptions {
  /** Keep everything in memory (sample/preview sessions never touch storage). */
  memoryOnly?: boolean;
  /** Read-only session: every write is rejected (Preview SK Flex). */
  readOnly?: boolean;
}

function loadStore(): StoreShape {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw) as StoreShape;
  } catch {
    /* corrupted storage — start fresh */
  }
  return { collections: {} };
}

function saveStore(store: StoreShape) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    // localStorage is not available (Node / SSR) — skip persistence.
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function matches(doc: Record<string, unknown>, where?: QuerySpec['where']): boolean {
  if (!where) return true;
  for (const w of where) {
    const a = doc[w.field] as number | string;
    const b = w.value as number | string;
    switch (w.op) {
      case '==':
        if (a !== b) return false;
        break;
      case '>':
        if (!(a > b)) return false;
        break;
      case '>=':
        if (!(a >= b)) return false;
        break;
      case '<':
        if (!(a < b)) return false;
        break;
      case '<=':
        if (!(a <= b)) return false;
        break;
    }
  }
  return true;
}

function sortBy(field: string, dir: 'asc' | 'desc') {
  return (x: { id: string }, y: { id: string }) => {
    const a = (x as unknown as Record<string, unknown>)[field];
    const b = (y as unknown as Record<string, unknown>)[field];
    if (a === b) return x.id < y.id ? -1 : 1;
    const cmp = typeof a === 'number' && typeof b === 'number' ? a - b : String(a) < String(b) ? -1 : 1;
    return dir === 'asc' ? cmp : -cmp;
  };
}

function genId(): string {
  return `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Demo / fully-offline backend. Everything is stored in localStorage on the
 * device. Shares the exact same DataService contract as the Firestore
 * backend, so all billing logic, PDF/JPG/print, ledger and backup features
 * work identically — just without cloud sync.
 */
export class LocalDataService implements DataService {
  readonly kind = 'local' as const;
  readonly isCloud = false;
  basePath = 'local';
  private store: StoreShape;
  private authListeners = new Set<(u: AuthUser | null) => void>();
  private connectivityListeners = new Set<(online: boolean) => void>();
  private syncListeners = new Set<(s: SyncStatus) => void>();
  private watchers = new Map<string, Set<() => void>>();
  private online = typeof navigator !== 'undefined' ? navigator.onLine : true;
  private opts: LocalServiceOptions;
  private readOnly = false;
  private memoryAuth: AuthUser | null = null;

  constructor(opts: LocalServiceOptions = {}) {
    this.opts = opts;
    this.readOnly = !!opts.readOnly;
    this.store = opts.memoryOnly ? { collections: {} } : loadStore();
    this.seedFrameRatesSync();
    if (typeof window !== 'undefined') {
      const update = () => {
        this.online = navigator.onLine;
        this.connectivityListeners.forEach((cb) => cb(this.online));
      };
      window.addEventListener('online', update);
      window.addEventListener('offline', update);
    }
  }

  /**
   * Populate the canonical SK Photo Frame size table synchronously, so it is
   * present on first load AND on session restore (page reload) — before any
   * query runs, so the Rates page never flashes an empty table. Migrates the
   * old flat-row shape (rate/minSize) to the size table when present. Only
   * seeds when empty or old-shape; user edits to the size table are kept.
   */
  private seedFrameRatesSync() {
    const col = this.col('frameRates');
    const entries = Object.values(col);
    const hasOldShape = entries.length > 0 && !entries.some((d) => 'size' in d);
    if (entries.length > 0 && !hasOldShape) return;
    if (hasOldShape) this.store.collections.frameRates = {};
    const c = this.col('frameRates');
    for (const p of SK_PHOTO_FRAME_PRICES) {
      c[genId()] = {
        size: p.size,
        beading: p.beading,
        oneInch: p.oneInch,
        onePointFiveInch: p.onePointFiveInch,
        twoInch: p.twoInch,
        active: true,
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
    }
    this.persist();
  }

  private col(name: string): Record<string, Record<string, unknown>> {
    if (!this.store.collections[name]) this.store.collections[name] = {};
    return this.store.collections[name];
  }

  private persist() {
    if (!this.opts.memoryOnly) saveStore(this.store);
    this.watchers.forEach((cbs) => cbs.forEach((cb) => cb()));
  }

  /** Preview sessions become read-only once their sample data is seeded. */
  setReadOnly(readOnly: boolean): void {
    this.readOnly = readOnly;
  }

  isReadOnly(): boolean {
    return this.readOnly;
  }

  private guardWrite(): void {
    if (this.readOnly) {
      throw new Error('Preview SK Flex is read-only. Sign in with Google to make changes.');
    }
  }

  // ------------------------------------------------------------------ auth
  async signInWithGoogle(): Promise<AuthUser> {
    // Reached only when this build was compiled without Firebase configuration
    // (VITE_FIREBASE_*), i.e. there is no cloud backend to authenticate against.
    throw new Error(
      'Google sign-in is not available in this build because the Firebase configuration is missing. Add the VITE_FIREBASE_* values to .env and rebuild.'
    );
  }

  async signInDemo(name: string): Promise<AuthUser> {
    const user: AuthUser = {
      uid: 'demo-user',
      name: name.trim() || 'Demo User',
      email: null,
      photoURL: null,
      isDemo: true
    };
    if (this.opts.memoryOnly) {
      this.memoryAuth = user;
    } else {
      // Fresh session: reload stored data from localStorage (a previous session
      // may have written data this in-memory copy knows nothing about, and a
      // previous user's data must never leak into this session).
      this.store = loadStore();
      this.seedFrameRatesSync(); // only seeds when empty, never duplicates
      try {
        localStorage.setItem(AUTH_KEY, JSON.stringify(user));
      } catch {
        /* storage unavailable */
      }
    }
    this.authListeners.forEach((cb) => cb(user));
    return user;
  }

  /**
   * "Preview SK Flex": a read-only look at the app with isolated sample data.
   * No guest account is created and nothing is written to the device or cloud.
   */
  async signInPreview(): Promise<AuthUser> {
    const user: AuthUser = {
      uid: 'preview-sample',
      name: 'Preview SK Flex',
      email: null,
      photoURL: null,
      isDemo: true,
      preview: true
    };
    this.memoryAuth = user;
    this.authListeners.forEach((cb) => cb(user));
    return user;
  }

  async signOut(): Promise<void> {
    this.store = { collections: {} };
    this.memoryAuth = null;
    try {
      localStorage.removeItem(AUTH_KEY);
    } catch {
      /* storage unavailable */
    }
    this.authListeners.forEach((cb) => cb(null));
  }

  /**
   * Clear Data (All) for demo/local mode: wipe every collection AND the demo
   * session from localStorage — in local mode this store IS the whole
   * database, so nothing is kept.
   */
  async clearLocalData(): Promise<void> {
    this.guardWrite();
    this.store = { collections: {} };
    try {
      localStorage.removeItem(STORE_KEY);
      localStorage.removeItem(AUTH_KEY);
    } catch {
      /* storage unavailable — in-memory store already reset */
    }
  }

  getAuthUser(): AuthUser | null {
    if (this.opts.memoryOnly) return this.memoryAuth;
    // Read fresh from storage so a new session (e.g. after logout or tests)
    // always reflects the stored auth state.
    try {
      const raw = localStorage.getItem(AUTH_KEY);
      if (raw) return JSON.parse(raw) as AuthUser;
    } catch {
      /* ignore */
    }
    return null;
  }

  onAuthChange(cb: (u: AuthUser | null) => void): () => void {
    this.authListeners.add(cb);
    return () => this.authListeners.delete(cb);
  }

  // ------------------------------------------------------------- documents
  async get<T extends { id: string }>(name: string, id: string): Promise<T | null> {
    const doc = this.col(name)[id];
    return doc ? ({ id, ...doc } as T) : null;
  }

  async set(name: string, id: string, data: Record<string, unknown>): Promise<void> {
    this.guardWrite();
    const existing = this.col(name)[id] || {};
    this.col(name)[id] = {
      ...existing,
      ...data,
      createdAt: (existing.createdAt as string) || nowIso(),
      updatedAt: nowIso()
    };
    this.persist();
  }

  async add(name: string, data: Record<string, unknown>): Promise<string> {
    this.guardWrite();
    const id = genId();
    this.col(name)[id] = { ...data, createdAt: nowIso(), updatedAt: nowIso() };
    this.persist();
    return id;
  }

  async delete(name: string, id: string): Promise<void> {
    this.guardWrite();
    delete this.col(name)[id];
    this.persist();
  }

  async query<T extends { id: string }>(name: string, spec?: QuerySpec): Promise<T[]> {
    const items = Object.entries(this.col(name)).map(([id, data]) => ({ id, ...data }));
    const filtered = items.filter((d) => matches(d, spec?.where));
    if (spec?.orderBy) filtered.sort(sortBy(spec.orderBy.field, spec.orderBy.dir));
    if (spec?.limit) return filtered.slice(0, spec.limit) as T[];
    return filtered as T[];
  }

  watch<T extends { id: string }>(name: string, spec: QuerySpec | undefined, cb: (items: T[]) => void): () => void {
    const fire = () => {
      void this.query<T>(name, spec).then(cb);
    };
    fire();
    if (!this.watchers.has(name)) this.watchers.set(name, new Set());
    this.watchers.get(name)!.add(fire);
    return () => this.watchers.get(name)?.delete(fire);
  }

  // ------------------------------------------------------- invoice numbers
  async nextInvoiceNumber(prefix: string): Promise<string> {
    const all = await this.query<{ id: string; number: string }>('invoices');
    let max = 0;
    for (const inv of all) max = Math.max(max, parseInvoiceNumber(prefix, inv.number));
    return formatInvoiceNumber(prefix, max + 1);
  }

  // -------------------------------------------------------- connectivity
  isOnline(): boolean {
    return this.online;
  }

  onConnectivityChange(cb: (online: boolean) => void): () => void {
    this.connectivityListeners.add(cb);
    return () => this.connectivityListeners.delete(cb);
  }

  getSyncStatus(): SyncStatus {
    return this.online ? 'synced' : 'offline';
  }

  onSyncStatusChange(cb: (s: SyncStatus) => void): () => void {
    this.syncListeners.add(cb);
    cb(this.getSyncStatus());
    return () => this.syncListeners.delete(cb);
  }

  getLastSyncError(): string | null {
    return null; // local/demo mode has no cloud sync that can fail
  }

  onSyncErrorChange(_cb: (message: string | null) => void): () => void {
    return () => undefined;
  }
}
