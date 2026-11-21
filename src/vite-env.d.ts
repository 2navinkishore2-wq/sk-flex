/// <reference types="vite/client" />

/** Injected by Vite's `define` (see vite.config.ts). */
declare const __APP_VERSION__: string;

interface SkFlexDesktopUpdateResult {
  state: 'update-available' | 'up-to-date' | 'error';
  version?: string;
  notes?: string;
  releaseUrl?: string;
  error?: string;
}

interface SkFlexDesktopUpdateApi {
  check: () => Promise<SkFlexDesktopUpdateResult>;
  download: () => Promise<{ ok: boolean; error?: string }>;
  install: () => Promise<{ ok: boolean; error?: string }>;
  onProgress?: (cb: (p: { percent: number; state: string }) => void) => () => void;
}

interface SkFlexDesktopAuthApi {
  /** Opens the SYSTEM browser; resolves with a Google ID token or an error code. */
  googleSignIn: (opts: { clientId: string; loginHint?: string }) => Promise<{
    ok: boolean;
    idToken?: string;
    code?: string;
    error?: string;
  }>;
}

interface Window {
  skFlexBilling?: {
    platform: string;
    isElectron: boolean;
    version?: string;
    auth?: SkFlexDesktopAuthApi;
    update?: SkFlexDesktopUpdateApi;
  };
  SkFlexUpdate?: {
    downloadAndInstall: (opts: { url: string; filename: string }) => Promise<{ started: boolean }>;
  };
}
