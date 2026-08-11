import type { AuthUser, SyncStatus } from '../lib/types';

export type WhereOp = '==' | '>' | '>=' | '<' | '<=';

export interface WhereClause {
  field: string;
  op: WhereOp;
  value: unknown;
}

export interface OrderBy {
  field: string;
  dir: 'asc' | 'desc';
}

export interface QuerySpec {
  where?: WhereClause[];
  orderBy?: OrderBy;
  limit?: number;
}

/**
 * One data contract implemented twice:
 *  - FirestoreDataService: real cloud backend with built-in offline cache + sync
 *  - LocalDataService:     demo/offline mode, everything stored in localStorage
 * Every document is stamped with createdAt/updatedAt (ISO strings after read).
 */
export interface DataService {
  kind: 'firestore' | 'local';
  /** Base path under which this user's collections live, e.g. users/{uid}. */
  basePath: string;

  // ---- auth ---------------------------------------------------------
  signInWithGoogle(): Promise<AuthUser>;
  signInDemo(name: string): Promise<AuthUser>;
  signOut(): Promise<void>;
  getAuthUser(): AuthUser | null;
  onAuthChange(cb: (user: AuthUser | null) => void): () => void;

  // ---- documents -----------------------------------------------------
  get<T extends { id: string }>(collection: string, id: string): Promise<T | null>;
  set(collection: string, id: string, data: Record<string, unknown>): Promise<void>;
  add(collection: string, data: Record<string, unknown>): Promise<string>;
  delete(collection: string, id: string): Promise<void>;
  query<T extends { id: string }>(collection: string, spec?: QuerySpec): Promise<T[]>;
  watch<T extends { id: string }>(collection: string, spec: QuerySpec | undefined, cb: (items: T[]) => void): () => void;

  // ---- invoice number counter (atomic when online) --------------------
  nextInvoiceNumber(prefix: string): Promise<string>;
  /** Called after first load to repair duplicate invoice numbers across devices. */
  reconcileInvoiceNumbers?(prefix: string, invoices: { id: string; number: string; createdAt: string }[]): Promise<number>;

  // ---- clear account data --------------------------------------------------
  /**
   * "Clear Data (All)": permanently remove the CURRENT ACCOUNT'S business
   * data. On the cloud backend this deletes every account-owned document
   * from Firestore (customers, invoices, payments, ledger, settings, rates,
   * counter) AND wipes the local cache so nothing reappears. Other accounts
   * and the Firebase Authentication session are kept. On the demo/local
   * backend it wipes the whole local store (that IS the database there).
   */
  clearLocalData(): Promise<void>;

  // ---- connectivity / sync status -------------------------------------
  isOnline(): boolean;
  onConnectivityChange(cb: (online: boolean) => void): () => void;
  getSyncStatus(): SyncStatus;
  onSyncStatusChange(cb: (status: SyncStatus) => void): () => void;
  /** True when this service talks to the cloud. */
  isCloud: boolean;

  // ---- sync diagnostics -----------------------------------------------------
  /** Short, sanitized description of the last sync failure (null when none). */
  getLastSyncError(): string | null;
  onSyncErrorChange(cb: (message: string | null) => void): () => void;
}

export type { AuthUser, SyncStatus };
