import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas-pro';
import { dataUrlToBlob, fileNameSafe, isNative, runtimePlatform } from '../lib/platform';

const A4_WIDTH_PX = 794; // 210mm @ 96dpi

/**
 * Capture the invoice element at A4 width. The element must already have
 * width 794px (the invoice renderer handles scaling for small screens via
 * an ancestor transform, which does not affect the element's own box).
 */
async function captureInvoice(el: HTMLElement, scale = 2): Promise<HTMLCanvasElement> {
  await document.fonts.ready;
  const canvas = await html2canvas(el, {
    scale,
    backgroundColor: '#ffffff',
    useCORS: true,
    logging: false,
    windowWidth: A4_WIDTH_PX
  });
  return canvas;
}

export async function invoiceToJpegDataUrl(el: HTMLElement, quality = 0.92): Promise<string> {
  const canvas = await captureInvoice(el, 2);
  return canvas.toDataURL('image/jpeg', quality);
}

export async function downloadInvoiceJpg(el: HTMLElement, filename: string): Promise<void> {
  const dataUrl = await invoiceToJpegDataUrl(el);
  if (isNative()) {
    await saveFileNative(dataUrl, filename);
    return;
  }
  triggerDownload(dataUrl, filename);
}

export async function downloadInvoicePdf(el: HTMLElement, filename: string): Promise<void> {
  const canvas = await captureInvoice(el, 2);
  const imgData = canvas.toDataURL('image/jpeg', 0.92);

  // A4 portrait, full-bleed width 210mm.
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  const pageW = 210;
  const pageH = 297;
  const imgW = pageW;
  const imgH = (canvas.height / canvas.width) * pageW;
  const pages = Math.max(1, Math.ceil(imgH / pageH));
  for (let p = 0; p < pages; p++) {
    if (p > 0) pdf.addPage();
    pdf.addImage(imgData, 'JPEG', 0, -p * pageH, imgW, imgH, undefined, 'FAST');
  }
  const blob = pdf.output('blob');
  if (isNative()) {
    await saveFileNativeBlob(blob, filename);
    return;
  }
  const url = URL.createObjectURL(blob);
  triggerDownload(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function triggerDownload(href: string, filename: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Print only the invoice (see @media print CSS in theme.css). */
export function printInvoice() {
  window.print();
}

export function invoiceFileName(number: string, ext: 'pdf' | 'jpg'): string {
  return `${fileNameSafe(number)}-invoice.${ext}`;
}

// ------------------------------------------------------------------ native
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

/**
 * On Android: save the file DIRECTLY to the device Downloads folder (never
 * open the share sheet / Quick Share). The native plugin uses MediaStore on
 * Android 10+ (no permission) and requests WRITE_EXTERNAL_STORAGE on Android
 * 9 and below only when required. PDF, JPEG and any other exported format
 * land as real files in Downloads.
 */
export async function saveFileNative(dataUrl: string, filename: string): Promise<void> {
  const base64 = dataUrl.split(',')[1] || '';
  const mime = /data:(.*?);base64/.exec(dataUrl)?.[1] || 'application/octet-stream';
  if (runtimePlatform() === 'android') {
    try {
      const { saveToDownloads } = await import('../lib/nativeDownload');
      await saveToDownloads({ data: base64, filename, mime });
      return;
    } catch (e) {
      throw new Error('Could not save the file to Downloads. ' + String((e as Error).message));
    }
  }
  // iOS / fallback: write to the app cache and open the share sheet so the
  // user can save it anywhere. Windows/web never reach this branch — they use
  // the plain browser download above.
  const path = `invoices/${filename}`;
  try {
    await Filesystem.writeFile({ path, data: base64, directory: Directory.Cache, recursive: true });
    const uri = await Filesystem.getUri({ path, directory: Directory.Cache });
    await Share.share({ title: filename, url: uri.uri });
  } catch (e) {
    throw new Error('Could not save the file on this device. ' + String((e as Error).message));
  }
}

async function saveFileNativeBlob(blob: Blob, filename: string): Promise<void> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  const base64 = btoa(binary);
  await saveFileNative(`data:application/pdf;base64,${base64}`, filename);
}

export { dataUrlToBlob };
