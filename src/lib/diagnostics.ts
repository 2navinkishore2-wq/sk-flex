/**
 * TEMP-DIAG — white-screen / viewport forensics.
 *
 * Purpose: when the Android WebView blanks out after Save and restarts, every
 * in-memory log is lost. This module keeps a small, sanitized ring buffer of
 * lifecycle events in localStorage (survives a WebView reload / activity
 * restart) AND mirrors them to the console (visible in Logcat under the
 * `chromium` tag). It also snapshots the CSS viewport so the real
 * innerWidth / innerHeight / devicePixelRatio / orientation of the device can
 * be read back after the fact.
 *
 * Nothing here touches Firebase, auth, or the data model. Remove this file
 * and its call sites once the root cause is confirmed.
 */

const KEY = 'skfb:diag:events';
const MAX_ENTRIES = 400;

export interface DiagEvent {
  t: number;
  e: string;
  d?: string;
}

export function diagLog(event: string, detail?: string | Record<string, unknown>): void {
  const d =
    detail === undefined
      ? undefined
      : typeof detail === 'string'
        ? detail
        : safeStringify(detail);
  try {
    // eslint-disable-next-line no-console
    console.debug(`[skfb-diag] ${event}${d ? ` :: ${d}` : ''}`);
  } catch {
    /* console unavailable — best-effort */
  }
  try {
    const raw = localStorage.getItem(KEY);
    const arr: DiagEvent[] = raw ? (JSON.parse(raw) as DiagEvent[]) : [];
    arr.push({ t: Date.now(), e: event, d });
    while (arr.length > MAX_ENTRIES) arr.shift();
    localStorage.setItem(KEY, JSON.stringify(arr));
  } catch {
    /* storage unavailable (Node/SSR/quota) — diagnostics are best-effort */
  }
}

export function diagClear(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}

export function diagRead(): DiagEvent[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as DiagEvent[]) : [];
  } catch {
    return [];
  }
}

function safeStringify(v: Record<string, unknown>): string {
  try {
    return JSON.stringify(v);
  } catch {
    return '[unserializable]';
  }
}

/**
 * Install global error handlers + lifecycle/viewport logging.
 * Call once at app boot (main.tsx). Safe in Node (no-op without window).
 */
export function installDiagnostics(): () => void {
  if (typeof window === 'undefined') return () => undefined;

  const onError = (e: ErrorEvent) => {
    diagLog('window.error', {
      message: e.message || String(e),
      file: e.filename,
      line: e.lineno,
      col: e.colno,
      stack: e.error instanceof Error ? e.error.stack : undefined
    });
  };
  const onRejection = (e: PromiseRejectionEvent) => {
    const r = e.reason as { message?: string; stack?: string } | undefined;
    diagLog('unhandledrejection', {
      message: r?.message ?? String(e.reason),
      stack: r?.stack
    });
  };
  const onPageHide = () => diagLog('pagehide');
  const onPageShow = (e: PageTransitionEvent) => diagLog('pageshow', { persisted: e.persisted });
  const onBeforeUnload = () => diagLog('beforeunload');
  const onVisibility = () => diagLog('visibility', document.visibilityState);

  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  const onResize = () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => snapshotViewport('resize'), 300);
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);
  window.addEventListener('beforeunload', onBeforeUnload);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  snapshotViewport('boot');

  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pageshow', onPageShow);
    window.removeEventListener('beforeunload', onBeforeUnload);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('orientationchange', onResize);
  };
}

export function snapshotViewport(tag: string): void {
  if (typeof window === 'undefined') return;
  diagLog(`viewport:${tag}`, {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    dpr: window.devicePixelRatio,
    orientation: typeof screen !== 'undefined' && screen.orientation ? screen.orientation.type : `${window.innerWidth}x${window.innerHeight}`,
    ua: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 140) : ''
  });
}
