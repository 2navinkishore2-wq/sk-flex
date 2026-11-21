import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AuthUser, BusinessSettings, Customer, FramePrice, Invoice, LedgerEntry, Payment, ProductRates, SyncStatus } from '../lib/types';
import type { DataService, QuerySpec } from '../services/data';
import { createService, type DataMode, type ServiceBundle } from '../services/index';
import { LocalDataService } from '../services/localService';
import { createPreviewService } from '../services/preview';
import { saveAppearance } from '../services/settings';
import { reconcileInvoiceSettlement } from '../services/payments';
import { DEFAULT_RATES, DEFAULT_SETTINGS } from '../lib/constants';
import { applyTheme, cacheTheme, isThemeId, loadCachedTheme } from '../lib/themes';

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
  /** Currently applied appearance preset id. */
  theme: string;
  /** Apply + cache a theme instantly and sync it to the account. */
  setTheme: (id: string) => void;
  /** True inside the read-only "Preview SK Flex" sample session. */
  preview: boolean;
  signInGoogle: () => Promise<void>;
  signInDemo: (name: string) => Promise<void>;
  signInPreview: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AppStore | null>(null);

export function useApp(): AppStore {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside provider');
  return v;
}

/**
 * The backend chosen at build time from the environment. On a cloud build
 * (Firebase configured) the app can STILL enter Demo mode: Demo runs on the
 * device-local backend (localStorage) while Google sign-in uses the cloud
 * backend — the app swaps between them at runtime, so the Web/EXE/APK login
 * screen always offers BOTH a working Google Sign-In and a working Demo
 * option. On a build without Firebase config, cloudBundle IS the local
 * service and nothing is ever swapped.
 */
const cloudBundle: ServiceBundle = createService();

export function useLiveCollection<T extends { id: string }>(svc: DataService, name: string, spec?: QuerySpec): T[] {
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
  const [service, setService] = useState<DataService>(cloudBundle.service);
  const [mode, setMode] = useState<DataMode>(cloudBundle.mode);
  const [configured, setConfigured] = useState<boolean>(cloudBundle.configured);
  const [user, setUser] = useState<AuthUser | null>(cloudBundle.service.getAuthUser());
  const [authLoading, setAuthLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(service.getSyncStatus());
  const [syncError, setSyncError] = useState<string | null>(service.getLastSyncError());
  const [online, setOnline] = useState(service.isOnline());
  const [theme, setThemeState] = useState<string>(() => loadCachedTheme());
  const themeTouched = useRef(false);
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

  // Appearance: the cached theme paints instantly at startup; the account's
  // saved theme then takes over on a new device until the user picks one here.
  const appearanceDoc = settingsDocs.find((d) => d.id === 'appearance') as
    | ({ id: string } & { theme?: unknown })
    | undefined;
  useEffect(() => {
    if (themeTouched.current || !appearanceDoc) return;
    const remote = appearanceDoc.theme;
    if (!isThemeId(remote)) return;
    applyTheme(remote);
    cacheTheme(remote);
    setThemeState(remote);
  }, [appearanceDoc]);

  const setTheme = useCallback(
    (id: string) => {
      if (!isThemeId(id)) return;
      themeTouched.current = true;
      applyTheme(id);
      cacheTheme(id);
      setThemeState(id);
      if (service.isCloud) {
        void saveAppearance(service, { theme: id }).catch(() => undefined);
      }
    },
    [service]
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

  // Settlement reconciliation: recompute invoice paid/balance from the money
  // records once per online session. This is what repairs a lost update when
  // two devices recorded a payment at the same moment (their allocation rows
  // are additive, only the denormalized total can be stale) — including after
  // an offline period, when the queued payment finally reaches Firestore.
  const settlementDone = useRef(false);
  // Read the freshest collections when the timer fires without re-running (and
  // cancelling) the effect on every list change.
  const moneyRef = useRef({ invoices, payments });
  moneyRef.current = { invoices, payments };
  const hasInvoices = invoices.length > 0;
  useEffect(() => {
    if (!online) settlementDone.current = false;
  }, [online]);
  useEffect(() => {
    if (!user || service.kind !== 'firestore' || !online || !hasInvoices) return;
    if (settlementDone.current) return;
    settlementDone.current = true;
    const timeout = setTimeout(() => {
      const { invoices: inv, payments: pay } = moneyRef.current;
      void reconcileInvoiceSettlement(service, { invoices: inv, payments: pay }).catch(() => undefined);
    }, 5000);
    return () => clearTimeout(timeout);
  }, [user, service, online, hasInvoices]);

  const signInGoogle = useCallback(async () => {
    if (service.kind === 'firestore') {
      await service.signInWithGoogle();
      return;
    }
    // Coming from a Demo session: switch back to the cloud backend. If the
    // cloud session still exists (e.g. the user was signed in before going
    // demo), restore it directly; otherwise run the real Google sign-in.
    const cloud = cloudBundle.service;
    setService(cloud);
    setMode(cloudBundle.mode);
    setConfigured(cloudBundle.configured);
    const u = cloud.getAuthUser() ?? (await cloud.signInWithGoogle());
    setUser(u);
    setAuthLoading(false);
  }, [service]);

  const signInDemo = useCallback(async (name: string) => {
    if (service.kind === 'local') {
      await service.signInDemo(name);
      return;
    }
    // Cloud build + Demo option: run the demo session on the device-local
    // backend so Demo keeps working even when Firebase is configured.
    const local = new LocalDataService();
    const u = await local.signInDemo(name);
    setService(local);
    setMode('local');
    setConfigured(cloudBundle.configured);
    setUser(u);
    setAuthLoading(false);
  }, [service]);

  const signInPreview = useCallback(async () => {
    const preview = await createPreviewService();
    setService(preview);
    setMode('local');
    setConfigured(cloudBundle.configured);
    setUser(preview.getAuthUser());
    setAuthLoading(false);
  }, []);

  const signOut = useCallback(async () => {
    themeTouched.current = false;
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
      theme,
      setTheme,
      preview: !!user?.preview,
      signInGoogle,
      signInDemo,
      signInPreview,
      signOut
    }),
    [service, mode, configured, user, authLoading, syncStatus, syncError, online, customers, invoices, payments, ledger, frameRates, business, rates, theme, setTheme, signInGoogle, signInDemo, signInPreview, signOut]
  );

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}
