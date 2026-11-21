/** Detect the current runtime platform from one shared codebase. */

export function isElectron(): boolean {
  return typeof window !== 'undefined' && !!window.skFlexBilling?.isElectron;
}

export function isNative(): boolean {
  // @capacitor/core registers itself on window when running inside a native WebView.
  return typeof window !== 'undefined' && !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
}

export type RuntimePlatform = 'web' | 'electron' | 'android' | 'ios';

export function runtimePlatform(): RuntimePlatform {
  if (isNative()) return 'android'; // only Android target is configured
  if (isElectron()) return 'electron';
  return 'web';
}

/** Convert a base64 data URL into a Blob. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(',');
  const mime = /data:(.*?);base64/.exec(meta)?.[1] || 'application/octet-stream';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export function fileNameSafe(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}
