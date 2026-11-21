/**
 * On-device OCR for supplier bill scanning.
 *
 * The engine (tesseract.js) and its English trained data are vendored into
 * public/ocr, so scanning works offline on Windows and Android with no CDN
 * request and no upload of the bill image. If the engine cannot start (old
 * WebView, blocked worker, out of memory) the caller falls back to typing or
 * pasting the bill text — manual entry always works.
 */

type TesseractWorker = {
  recognize: (image: unknown) => Promise<{ data: { text: string } }>;
  terminate: () => Promise<unknown>;
};

type TesseractGlobal = {
  createWorker: (
    lang: string,
    oem?: number,
    options?: Record<string, unknown>
  ) => Promise<TesseractWorker>;
};

declare global {
  interface Window {
    Tesseract?: TesseractGlobal;
  }
}

let workerPromise: Promise<TesseractWorker> | null = null;

function assetBase(): string {
  // Public assets are served from the app root on every platform (Electron's
  // localhost server, Capacitor's https origin, a plain static host).
  try {
    return new URL('ocr/', document.baseURI).href;
  } catch {
    return 'ocr/';
  }
}

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-skfb-ocr]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('OCR engine failed to load')));
      if (window.Tesseract) resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.dataset.skfbOcr = '1';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('OCR engine failed to load'));
    document.head.appendChild(s);
  });
}

export function isOcrSupported(): boolean {
  return typeof window !== 'undefined' && typeof Worker !== 'undefined' && typeof document !== 'undefined';
}

async function getWorker(onProgress?: (message: string, progress: number) => void): Promise<TesseractWorker> {
  if (workerPromise) return workerPromise;
  workerPromise = (async () => {
    if (!window.Tesseract) {
      await injectScript(`${assetBase()}tesseract.min.js`);
    }
    const engine = window.Tesseract;
    if (!engine) throw new Error('OCR engine is unavailable in this build');
    const base = assetBase();
    const worker = await engine.createWorker('eng', 1, {
      workerPath: `${base}worker.min.js`,
      corePath: `${base}core`,
      langPath: base,
      gzip: true,
      legacyCore: false,
      legacyLang: false,
      logger: (m: { status?: string; progress?: number }) =>
        onProgress?.(m.status || 'working', Number(m.progress) || 0)
    });
    return worker;
  })();
  try {
    return await workerPromise;
  } catch (e) {
    workerPromise = null;
    throw e;
  }
}

/** Terminate the cached worker (called on sign-out / app teardown). */
export async function disposeOcr(): Promise<void> {
  const w = workerPromise;
  workerPromise = null;
  if (!w) return;
  try {
    const worker = await w;
    await worker.terminate();
  } catch {
    /* already gone */
  }
}

/**
 * Scale, grayscale and boost contrast — improves accuracy on phone photos of
 * thermal/duplicate bills without changing the source file.
 */
export async function prepareImageForOcr(source: Blob | string): Promise<HTMLCanvasElement> {
  const url = typeof source === 'string' ? source : URL.createObjectURL(source);
  try {
    const img = await loadImage(url);
    const maxSide = 1800;
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
    const w = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
    const h = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      const grey = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      // Contrast stretch around mid-grey.
      const v = Math.max(0, Math.min(255, (grey - 128) * 1.35 + 132));
      px[i] = px[i + 1] = px[i + 2] = v;
    }
    ctx.putImageData(data, 0, 0);
    return canvas;
  } finally {
    if (typeof source !== 'string') URL.revokeObjectURL(url);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read that image'));
    img.src = src;
  });
}

export interface OcrResult {
  text: string;
}

/**
 * Read a bill image. Rejects with a readable message when the engine is not
 * available; callers must keep manual entry available in that case.
 */
export async function recognizeBillImage(
  source: Blob | string,
  onProgress?: (message: string, progress: number) => void,
  timeoutMs = 90000
): Promise<OcrResult> {
  if (!isOcrSupported()) throw new Error('OCR is not supported on this device');
  const canvas = await prepareImageForOcr(source);
  const worker = await getWorker(onProgress);
  const recognition = worker.recognize(canvas);
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('OCR timed out — try a clearer photo or enter the bill manually')), timeoutMs)
  );
  const { data } = await Promise.race([recognition, timeout]);
  return { text: data?.text || '' };
}
