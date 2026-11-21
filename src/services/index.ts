import type { DataService } from './data';
import { FirestoreDataService, readFirebaseConfig, type EmulatorConfig } from './firestoreService';
import { LocalDataService } from './localService';

export type DataMode = 'cloud' | 'local' | 'none';

/**
 * Emulator connection is STRICTLY dev-only: import.meta.env.DEV is replaced
 * with the literal `false` in production builds, so a production bundle can
 * never reach an emulator even if VITE_FIREBASE_EMULATOR_HOST is set.
 */
function emulatorFromEnv(env: Record<string, string | undefined>): EmulatorConfig | undefined {
  const raw = env.VITE_FIREBASE_EMULATOR_HOST;
  if (!import.meta.env.DEV || !raw) return undefined;
  const [host, portRaw] = raw.split(':');
  const firestorePort = Number(portRaw || 8080);
  if (!host || !Number.isFinite(firestorePort)) return undefined;
  return { authHost: host, authPort: 9099, firestoreHost: host, firestorePort };
}

/**
 * Names of the Firebase environment variables that are missing from this build.
 * Used by the login screen to explain exactly what has to be configured, and
 * to avoid ever offering a Google button that cannot work.
 */
export function missingFirebaseEnv(env: Record<string, string | undefined> = import.meta.env): string[] {
  const required = [
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_STORAGE_BUCKET',
    'VITE_FIREBASE_MESSAGING_SENDER_ID',
    'VITE_FIREBASE_APP_ID'
  ] as const;
  const missing: string[] = required.filter((k) => !(env[k] || '').trim());
  if (!(env.VITE_GOOGLE_DESKTOP_CLIENT_ID || '').trim()) missing.push('VITE_GOOGLE_DESKTOP_CLIENT_ID');
  return missing;
}

export interface ServiceBundle {
  service: DataService;
  mode: DataMode;
  /** True when Firebase env config is present. */
  configured: boolean;
}

/**
 * Decide which backend to use:
 *  - VITE_DATA_MODE=local  -> always demo/local
 *  - VITE_DATA_MODE=cloud  -> require Firebase config
 *  - VITE_DATA_MODE=auto (default) -> Firebase if configured, else local demo
 */
export function createService(env: Record<string, string | undefined> = import.meta.env): ServiceBundle {
  const mode = (env.VITE_DATA_MODE || 'auto') as string;
  const cfg = readFirebaseConfig(env);

  if (mode === 'local') {
    return { service: new LocalDataService(), mode: 'local', configured: !!cfg };
  }
  if (mode === 'cloud') {
    // Strict cloud mode: show the setup screen until Firebase is configured.
    // The local service is still available as an explicit escape hatch.
    if (!cfg) return { service: new LocalDataService(), mode: 'none', configured: false };
    return { service: new FirestoreDataService(cfg, { emulator: emulatorFromEnv(env) }), mode: 'cloud', configured: true };
  }
  // auto
  if (cfg) return { service: new FirestoreDataService(cfg, { emulator: emulatorFromEnv(env) }), mode: 'cloud', configured: true };
  return { service: new LocalDataService(), mode: 'local', configured: false };
}

export type { DataService };
