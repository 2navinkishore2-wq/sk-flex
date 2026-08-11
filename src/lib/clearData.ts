/**
 * "Clear Data (All)" — completely removes the CURRENT ACCOUNT'S BUSINESS
 * DATA, both from the source of truth and from the device:
 *  - cloud backend: deletes every account-owned Firestore document (via
 *    service.clearLocalData) AND strips the local cache + app-owned
 *    localStorage keys (diagnostics ring buffer, demo session…)
 *  - demo/local backend: wipes the whole local store (that IS the database)
 *
 * The Firebase Authentication session (firebase:* keys) is deliberately KEPT:
 * after this runs the caller reloads the page and the account starts fresh
 * (empty lists, Outstanding ₹0) while staying signed in.
 */
import type { DataService } from '../services/data';

const APP_KEY_PREFIX = 'skfb:';

export async function clearAllLocalData(service: DataService): Promise<void> {
  // 1. Backend-specific wipe (cloud: deletes the account's Firestore
  //    documents then terminates + deletes the IndexedDB cache; local:
  //    resets the demo store).
  await service.clearLocalData();

  // 2. Strip every app-owned localStorage key (diag events, leftover demo
  //    session, anything this app wrote). Firebase auth keys (firebase:*)
  //    are deliberately kept so the user stays signed in.
  if (typeof localStorage === 'undefined') return;
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(APP_KEY_PREFIX)) keys.push(k);
  }
  for (const k of keys) localStorage.removeItem(k);
}
