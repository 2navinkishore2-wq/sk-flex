/**
 * In-app update checks.
 *
 * One GitHub release feeds both platform builds. Checks are cheap, non-blocking
 * and never assume "up to date": a missing network or a failed request is
 * reported as offline/error, and only a successful check that finds nothing
 * newer reports "Up to date".
 */

import { runtimePlatform, type RuntimePlatform } from './platform';

export const GITHUB_OWNER = '2navinkishore2-wq';
export const GITHUB_REPO = 'sk-flex';
export const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`;
export const GITHUB_LATEST_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

export interface DesktopUpdateResult {
  state: 'update-available' | 'up-to-date' | 'error';
  version?: string;
  notes?: string;
  releaseUrl?: string;
  error?: string;
}

export type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'current'
  | 'offline'
  | 'error'
  | 'downloading'
  | 'unsupported';

export interface UpdateStatus {
  state: UpdateState;
  /** Version advertised by the release (without leading "v"). */
  latestVersion?: string;
  notes?: string;
  releaseUrl?: string;
  /** Direct APK asset (Android) / installer page (web). */
  downloadUrl?: string;
  error?: string;
  progress?: number;
  checkedAt?: string;
}

export function currentAppVersion(): string {
  const w = typeof window !== 'undefined' ? window.skFlexBilling?.version : undefined;
  if (w) return w.replace(/^v/, '');
  try {
    // Injected by Vite (see vite.config.ts define).
    return String(__APP_VERSION__).replace(/^v/, '');
  } catch {
    return '0.0.0';
  }
}

/** Semver-ish compare: returns 1 when a > b, -1 when a < b, 0 when equal. */
export function compareVersions(a: string, b: string): number {
  const clean = (v: string) => String(v || '').replace(/^v/i, '').split(/[+\-]/)[0].split('.').map((n) => Number(n) || 0);
  const pa = clean(a);
  const pb = clean(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

export interface GithubRelease {
  tag_name?: string;
  name?: string;
  body?: string;
  html_url?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: { name?: string; browser_download_url?: string }[];
}

export function parseRelease(json: GithubRelease): {
  version: string;
  notes: string;
  releaseUrl: string;
  apkUrl?: string;
  installerUrl?: string;
} {
  const version = String(json.tag_name || json.name || '').replace(/^v/i, '').trim();
  const assets = json.assets || [];
  const apk = assets.find((a) => /\.apk$/i.test(a.name || ''));
  const exe = assets.find((a) => /(setup|\.exe)$/i.test(a.name || ''));
  return {
    version,
    notes: String(json.body || '').trim(),
    releaseUrl: json.html_url || GITHUB_RELEASES_URL,
    apkUrl: apk?.browser_download_url,
    installerUrl: exe?.browser_download_url
  };
}

export interface CheckOptions {
  currentVersion?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  platform?: RuntimePlatform;
}

/**
 * Check for a newer release. Android uses the GitHub API (asset + notes),
 * Windows asks electron-updater, and the web build only compares versions.
 */
export async function checkForUpdate(opts: CheckOptions = {}): Promise<UpdateStatus> {
  const current = opts.currentVersion || currentAppVersion();
  const platform = opts.platform || runtimePlatform();
  const checkedAt = new Date().toISOString();

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { state: 'offline', error: 'You are offline. Update checks resume when the connection returns.', checkedAt };
  }

  // Windows: the Electron main process owns downloads and installs.
  if (platform === 'electron' && typeof window !== 'undefined' && window.skFlexBilling?.update) {
    try {
      const r = await window.skFlexBilling.update.check();
      if (r.state === 'update-available') {
        return {
          state: 'available',
          latestVersion: r.version,
          notes: r.notes,
          releaseUrl: r.releaseUrl || GITHUB_RELEASES_URL,
          checkedAt
        };
      }
      if (r.state === 'up-to-date') return { state: 'current', latestVersion: r.version || current, checkedAt };
      return { state: 'error', error: r.error || 'Update check failed', checkedAt };
    } catch (e) {
      return { state: 'error', error: (e as Error).message || 'Update check failed', checkedAt };
    }
  }

  const fetcher = opts.fetcher || (typeof fetch !== 'undefined' ? fetch : undefined);
  if (!fetcher) return { state: 'unsupported', error: 'Update checks are not available here.', checkedAt };

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), opts.timeoutMs || 12000) : null;
  try {
    const res = await fetcher(GITHUB_LATEST_API, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller ? controller.signal : undefined
    });
    if (!res.ok) {
      return { state: 'error', error: `Update check failed (HTTP ${res.status})`, checkedAt };
    }
    const release = parseRelease((await res.json()) as GithubRelease);
    if (!release.version) return { state: 'error', error: 'Release information was incomplete', checkedAt };
    if (compareVersions(release.version, current) > 0) {
      return {
        state: 'available',
        latestVersion: release.version,
        notes: release.notes,
        releaseUrl: release.releaseUrl,
        downloadUrl: platform === 'android' ? release.apkUrl : release.installerUrl,
        checkedAt
      };
    }
    return { state: 'current', latestVersion: release.version, checkedAt };
  } catch (e) {
    const err = e as Error;
    return {
      state: 'error',
      error: err.name === 'AbortError' ? 'Update check timed out' : 'Could not reach GitHub. Check your connection.',
      checkedAt
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Windows: begin downloading the update (progress is pushed by the main process). */
export async function downloadDesktopUpdate(): Promise<{ ok: boolean; error?: string }> {
  const api = typeof window !== 'undefined' ? window.skFlexBilling?.update : undefined;
  if (!api) return { ok: false, error: 'Updates are only available in the Windows desktop app.' };
  return api.download();
}

/** Windows: finish writes, then quit and install the downloaded update. */
export async function installDesktopUpdate(): Promise<{ ok: boolean; error?: string }> {
  const api = typeof window !== 'undefined' ? window.skFlexBilling?.update : undefined;
  if (!api) return { ok: false, error: 'Updates are only available in the Windows desktop app.' };
  flushDraftsBeforeUpdate();
  return api.install();
}

/**
 * Android: hand the signed APK to the system installer (user confirmation).
 * Falls back to the release page when the native installer bridge is missing.
 */
export async function downloadAndroidUpdate(status: UpdateStatus): Promise<{ ok: boolean; error?: string }> {
  const url = status.downloadUrl;
  if (!url) return { ok: false, error: 'No APK asset was found on the latest release.' };
  flushDraftsBeforeUpdate();
  // Capacitor exposes the local UpdatePlugin as Capacitor.Plugins.SkFlexUpdate.
  const cap = (
    window as unknown as {
      Capacitor?: { Plugins?: Record<string, { downloadAndInstall: (o: { url: string; filename: string }) => Promise<{ started: boolean }> }> };
    }
  ).Capacitor;
  const bridge = cap?.Plugins?.SkFlexUpdate ?? window.SkFlexUpdate;
  if (bridge) {
    try {
      await bridge.downloadAndInstall({
        url,
        filename: `SK-Flex-Billing-v${status.latestVersion || 'update'}.apk`
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message || 'Could not start the APK download' };
    }
  }
  try {
    window.open(url, '_blank');
    return { ok: true };
  } catch {
    return { ok: false, error: 'Open the release page to download the APK.' };
  }
}

/**
 * Persist any in-progress bill drafts so an update restart cannot lose work.
 * The billing page mirrors its draft into these keys as the user types.
 */
export function flushDraftsBeforeUpdate(): void {
  try {
    const draft = localStorage.getItem('skfb:draft:bill');
    if (draft) localStorage.setItem('skfb:draft:bill:preserved', draft);
    localStorage.setItem('skfb:updating', new Date().toISOString());
  } catch {
    /* storage unavailable — nothing else we can do here */
  }
}

export function updateStateLabel(s: UpdateState): string {
  switch (s) {
    case 'checking':
      return 'Checking…';
    case 'available':
      return 'Update available';
    case 'current':
      return 'Up to date';
    case 'offline':
      return 'Offline';
    case 'error':
      return 'Check failed';
    case 'downloading':
      return 'Downloading…';
    case 'unsupported':
      return 'Not available';
    default:
      return 'Not checked';
  }
}
