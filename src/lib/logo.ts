let cached: string | null = null;

/**
 * Returns the app logo as a PNG data URL. The supplied SK logo
 * (public/logo.png) is drawn onto a canvas once and cached; PNG data URLs
 * render 100% reliably in html2canvas / jsPDF exports and in <img> tags on
 * every platform. The logo is used as-is — never resized by the browser at
 * render time beyond its <img> display size, preserving its proportions.
 */
export async function getLogoDataUrl(size = 256): Promise<string> {
  if (cached) return cached;
  const url = `${import.meta.env.BASE_URL}logo.png`;
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('logo load failed'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    // Draw the logo centered without stretching: preserve aspect ratio and
    // letterbox on the canvas (transparent outside the image bounds).
    const scale = Math.min(size / img.naturalWidth, size / img.naturalHeight);
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
    cached = canvas.toDataURL('image/png');
  } catch {
    // Absolute fallback: the static PNG path itself.
    cached = url;
  }
  return cached;
}
