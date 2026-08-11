import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AuthUser, BusinessSettings, Customer, FramePrice, Invoice, LedgerEntry, Payment, ProductRates, SyncStatus } from '../lib/types';
import type { DataService, QuerySpec } from '../services/data';
import { createService, type DataMode, type ServiceBundle } from '../services/index';
import { DEFAULT_RATES, DEFAULT_SETTINGS } from '../lib/constants';

interface AppStore {
  service: DataService;
  mode: DataMode;
  configured: boolean;
  user: AuthUser | null;
  authLoading: boolean;
  ready: boolean;
  syncStatus: SyncStatus;
  syncError: string | null;
  online: boolean;
  customers: Customer[];
  invoices: Invoice[];
  payments: Payment[];
  ledger: LedgerEntry[];
  frameRates: FramePrice[];
  business: BusinessSettings;
  rates: ProductRates;
  signInGoogle: () => Promise<void>;
  signInDemo: (name: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AppStore | null>(null);

export function useApp(): AppStore {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside provider');
  return v;
}

const bundle: ServiceBundle = createService();

function useLiveCollection<T extends { id: string }>(svc: DataService, name: string, spec?: QuerySpec): T[] {
  const [items, setItems] = useState<T[]>([]);
  // Serialize the spec so effect deps are stable (inline object literals would
  // re-subscribe on every render and cause an infinite loop).
  const specKey = JSON.stringify(spec ?? null);
  useEffect(() => {
    // The cloud backend's basePath is '' until Firebase Auth resolves the
    // session (users/{uid}); the local backend always has a basePath. basePath
    // is read from the live service, so it MUST be a dependency: when auth
    // completes ('' -> users/{uid}) this effect re-runs and attaches the
    // Firestore listener; on sign-out or a user switch the cleanup runs first,
    // unsubscribing the previous user's listeners before new ones attach.
    if (!svc.basePath) {
      setItems([]);
      return;
    }
    const parsed: QuerySpec | undefined = specKey === 'null' ? undefined : JSON.parse(specKey);
    return svc.watch<T>(name, parsed, setItems);
  }, [svc, name, specKey, svc.basePath]);
  return items;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const { service, mode, configured } = bundle;
  const [user, setUser] = useState<AuthUser | null>(service.getAuthUser());
  const [authLoading, setAuthLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(service.getSyncStatus());
  const [syncError, setSyncError] = useState<string | null>(service.getLastSyncError());
  const [online, setOnline] = useState(service.isOnline());
  const reconciledRef = useRef(false);

  useEffect(() => {
    const off = service.onAuthChange((u) => {
      setUser(u);
      setAuthLoading(false);
    });
    // Demo/local backend resolves auth synchronously (getAuthUser reads
    // localStorage in the useState initializer). Cloud (Firestore) restores the
    // session asynchronously, so authLoading must stay true until the first
    // onAuthStateChanged callback — otherwise the login screen flashes on every
    // page reload for signed-in users.
    if (service.kind === 'local') setAuthLoading(false);
    const offSync = service.onSyncStatusChange(setSyncStatus);
    const offSyncErr = service.onSyncErrorChange(setSyncError);
    const offConn = service.onConnectivityChange(setOnline);
    return () => {
      off();
      offSync();
      offSyncErr();
      offConn();
    };
  }, [service]);

  const customers = useLiveCollection<Customer>(service, 'customers', { orderBy: { field: 'name', dir: 'asc' } });
  const invoices = useLiveCollection<Invoice>(service, 'invoices', { orderBy: { field: 'createdAt', dir: 'desc' } });
  const payments = useLiveCollection<Payment>(service, 'payments', { orderBy: { field: 'createdAt', dir: 'desc' } });
  const ledger = useLiveCollection<LedgerEntry>(service, 'ledger');
  const frameRates = useLiveCollection<FramePrice>(service, 'frameRates');
  const settingsDocs = useLiveCollection<{ id: string } & Record<string, unknown>>(service, 'settings');

  // Settings docs are live collections too, so rate/business changes made on
  // any device propagate instantly (same as customers/invoices).
  const businessDoc = settingsDocs.find((d) => d.id === 'business');
  const ratesDoc = settingsDocs.find((d) => d.id === 'rates');
  const business = useMemo<BusinessSettings>(
    () => ({ ...DEFAULT_SETTINGS, ...(businessDoc ? (businessDoc as unknown as BusinessSettings) : {}) }),
    [businessDoc]
  );
  const rates = useMemo<ProductRates>(
    () => ({ ...DEFAULT_RATES, ...(ratesDoc ? (ratesDoc as unknown as ProductRates) : {}) }),
    [ratesDoc]
  );

  // Reconcile duplicate invoice numbers once per session (online safety net).
  useEffect(() => {
    if (!user || reconciledRef.current || service.kind !== 'firestore') return;
    if (!service.isOnline()) return;
    if (invoices.length === 0) return;
    reconciledRef.current = true;
    const prefix = business.invoicePrefix || 'SK';
    const timeout = setTimeout(() => {
      service
        .reconcileInvoiceNumbers?.(
          prefix,
          invoices.map((i) => ({ id: i.id, number: i.number, createdAt: i.createdAt }))
        )
        .catch(() => undefined);
    }, 4000);
    return () => clearTimeout(timeout);
  }, [user, invoices.length, service, business.invoicePrefix]);

  const signInGoogle = useCallback(async () => {
    await service.signInWithGoogle();
  }, [service]);

  const signInDemo = useCallback(async (name: string) => {
    await service.signInDemo(name);
  }, [service]);

  const signOut = useCallback(async () => {
    await service.signOut();
  }, [service]);

  const store = useMemo<AppStore>(
    () => ({
      service,
      mode,
      configured,
      user,
      authLoading,
      ready: !!user && service.basePath !== '',
      syncStatus,
      syncError,
      online,
      customers,
      invoices,
      payments,
      ledger,
      frameRates,
      business,
      rates,
      signInGoogle,
      signInDemo,
      signOut
    }),
    [service, mode, configured, user, authLoading, syncStatus, syncError, online, customers, invoices, payments, ledger, frameRates, business, rates, signInGoogle, signInDemo, signOut]
  );

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}
