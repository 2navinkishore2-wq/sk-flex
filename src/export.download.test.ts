// @vitest-environment jsdom
/* Android download regression tests (Bug: PDF/JPEG downloads were routed
 * through Quick Share instead of being saved). The Android path must call the
 * native Download plugin (file lands in Downloads) and MUST NOT call the
 * Share plugin. Windows/web keep the browser download; the iOS/fallback path
 * keeps the cache + share sheet. */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  platform: {
    isNative: vi.fn(() => true),
    runtimePlatform: vi.fn(() => 'android'),
    fileNameSafe: (n: string) => n.replace(/[^a-zA-Z0-9._-]/g, '_'),
    dataUrlToBlob: (d: string) => new Blob([d])
  },
  nativeDownload: {
    saveToDownloads: vi.fn(async () => ({ uri: 'content://downloads/1' }))
  },
  share: { Share: { share: vi.fn(async () => undefined) } },
  filesystem: {
    Filesystem: {
      writeFile: vi.fn(async () => undefined),
      getUri: vi.fn(async () => ({ uri: 'file:///cache/invoices/x.pdf' }))
    },
    Directory: { Cache: 'CACHE', ExternalStorage: 'EXTERNAL_STORAGE', Documents: 'DOCUMENTS' }
  }
}));

vi.mock('./lib/platform', () => mocks.platform);
vi.mock('./lib/nativeDownload', () => mocks.nativeDownload);
vi.mock('@capacitor/share', () => mocks.share);
vi.mock('@capacitor/filesystem', () => mocks.filesystem);

import { saveFileNative, invoiceFileName } from './services/export';
import { statementFileName } from './lib/statement';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Android download — file goes to Downloads, never Quick Share', () => {
  it('PDF: calls the native Download plugin with the exact base64 payload and mime, no share', async () => {
    await saveFileNative('data:application/pdf;base64,JVBERi0xLjQ=', 'SK-0001-invoice.pdf');

    expect(mocks.nativeDownload.saveToDownloads).toHaveBeenCalledTimes(1);
    expect(mocks.nativeDownload.saveToDownloads).toHaveBeenCalledWith({
      data: 'JVBERi0xLjQ=',
      filename: 'SK-0001-invoice.pdf',
      mime: 'application/pdf'
    });
    expect(mocks.share.Share.share).not.toHaveBeenCalled();
  });

  it('JPEG: saves image/jpeg to Downloads without the share sheet', async () => {
    await saveFileNative('data:image/jpeg;base64,/9j/4AAQ', 'SK-0002-invoice.jpg');

    expect(mocks.nativeDownload.saveToDownloads).toHaveBeenCalledWith({
      data: '/9j/4AAQ',
      filename: 'SK-0002-invoice.jpg',
      mime: 'image/jpeg'
    });
    expect(mocks.share.Share.share).not.toHaveBeenCalled();
  });

  it('a failed native save surfaces a clear error (not silently swallowed)', async () => {
    mocks.nativeDownload.saveToDownloads.mockRejectedValueOnce(new Error('no space left'));
    await expect(saveFileNative('data:image/jpeg;base64,AA', 'x.jpg')).rejects.toThrow(/Downloads/);
  });
});

describe('Export filenames identify the document (never generic)', () => {
  it('individual invoice export filename carries Bill Date + customer + invoice number', () => {
    expect(invoiceFileName('2026-08-27', 'Mani Pasanga', 'SK-0004', 'pdf')).toBe('27-08-2026_Mani_Pasanga_SK-0004.pdf');
    expect(invoiceFileName('2026-08-27', 'Mani Pasanga', 'SK-0004', 'jpg')).toBe('27-08-2026_Mani_Pasanga_SK-0004.jpg');
    // PDF and JPG share the same base name — only the extension differs.
    const basePdf = invoiceFileName('2026-08-27', 'Mani Pasanga', 'SK-0004', 'pdf').replace(/\.pdf$/, '');
    expect(invoiceFileName('2026-08-27', 'Mani Pasanga', 'SK-0004', 'jpg').replace(/\.jpg$/, '')).toBe(basePdf);
  });

  it('unsafe customer characters become underscores; never a generic name', () => {
    const f = invoiceFileName('2026-08-27', 'Flex & Sign "Shop" / Salem', 'SK-0004', 'pdf');
    expect(f).toMatch(/^27-08-2026_/);
    expect(f).toContain('SK-0004.pdf');
    expect(f).not.toContain('&');
    expect(f).not.toContain('"');
    expect(f).not.toContain('/');
    expect(f).not.toBe('download.pdf');
    expect(f).not.toBe('invoice.pdf');
  });

  it('missing date falls back to a safe, still-identifying name', () => {
    expect(invoiceFileName('', 'Mani Pasanga', 'SK-0004', 'pdf')).toBe('Mani_Pasanga_SK-0004.pdf');
  });

  it('customer statement export filename carries customer + date range', () => {
    expect(statementFileName('2026-07-27', '2026-08-08', 'Manipasanga Flex', 'pdf')).toBe(
      '27-07-2026_To_08-08-2026_Manipasanga_Flex.pdf'
    );
    expect(statementFileName('2026-07-27', '2026-08-08', 'Manipasanga Flex', 'jpg')).toBe(
      '27-07-2026_To_08-08-2026_Manipasanga_Flex.jpg'
    );
  });

  it('Android statement export still goes through the native Download plugin (no share sheet)', async () => {
    mocks.platform.runtimePlatform.mockReturnValue('android');
    await saveFileNative('data:application/pdf;base64,JVBERi0xLjQ=', '27-07-2026_To_08-08-2026_Manipasanga_Flex.pdf');
    expect(mocks.nativeDownload.saveToDownloads).toHaveBeenCalledWith({
      data: 'JVBERi0xLjQ=',
      filename: '27-07-2026_To_08-08-2026_Manipasanga_Flex.pdf',
      mime: 'application/pdf'
    });
    expect(mocks.share.Share.share).not.toHaveBeenCalled();
  });
});

describe('Non-Android native platforms keep the cache + share fallback', () => {
  it('uses the Filesystem cache write + share sheet when not on Android', async () => {
    mocks.platform.runtimePlatform.mockReturnValue('ios');
    await saveFileNative('data:image/jpeg;base64,AA', 'SK-0003-invoice.jpg');

    expect(mocks.nativeDownload.saveToDownloads).not.toHaveBeenCalled();
    expect(mocks.filesystem.Filesystem.writeFile).toHaveBeenCalledTimes(1);
    expect(mocks.share.Share.share).toHaveBeenCalledTimes(1);
  });
});
