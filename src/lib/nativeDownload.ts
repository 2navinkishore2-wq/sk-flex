/**
 * Native Android "save to Downloads" bridge.
 *
 * The old flow wrote the file to the app cache and opened the Android share
 * sheet, which routed downloads through Quick Share instead of saving the
 * file. This bridge writes straight to the device Downloads folder via a
 * small native plugin (MediaStore Downloads on Android 10+, legacy public
 * Downloads on Android 9 and below — permission requested only when needed).
 *
 * Windows and web never reach the plugin call: Electron uses the plain
 * browser download path, so the Windows download behavior is untouched.
 */
import { registerPlugin } from '@capacitor/core';
import { runtimePlatform } from './platform';

export interface SaveToDownloadsOptions {
  /** Base64 payload WITHOUT the data: prefix. */
  data: string;
  filename: string;
  mime: string;
}

export interface SaveToDownloadsResult {
  uri?: string;
  path?: string;
  filename?: string;
}

interface DownloadPluginShape {
  saveToDownloads(options: SaveToDownloadsOptions): Promise<SaveToDownloadsResult>;
}

/** True when this build can save straight to Downloads (Android APK only). */
export function canSaveToDownloads(): boolean {
  return runtimePlatform() === 'android';
}

export async function saveToDownloads(options: SaveToDownloadsOptions): Promise<SaveToDownloadsResult> {
  const Download = registerPlugin<DownloadPluginShape>('Download');
  return Download.saveToDownloads(options);
}
