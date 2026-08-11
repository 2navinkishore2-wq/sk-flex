/* Generates app icons from the real SK logo (public/logo.png):
 * PWA icons, favicon, Electron/Windows icon, Android launcher mipmaps
 * (legacy + adaptive foreground) and the adaptive background colour.
 * Pure Node built-ins: decodes the source PNG, bilinear-resizes, masks.
 *
 * BRANDING: the background behind the logo is WHITE everywhere (the app
 * icon must be a clean white tile with the SK logo — never a black canvas).
 * The logo itself is used exactly as provided: red "S" + green "K" with
 * their rounded frames; only scaling/masking is applied.
 *
 * If the source PNG cannot be decoded, falls back to the placeholder
 * bitmap "SK" renderer so the project always builds.
 */
import { deflateSync, inflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'public/logo.png');

// ---- PNG encoder ----------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---- PNG decoder (bit depth 8; color types 0 gray, 2 RGB, 6 RGBA) ---
function decodePNG(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat = [];
  let pos = 8;
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      colorType = data[9];
      if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
      if (colorType !== 0 && colorType !== 2 && colorType !== 6) throw new Error(`unsupported color type ${colorType}`);
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = Buffer.alloc(width * height * 4);
  const prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const i = x * bpp;
      const o = (y * width + x) * 4;
      if (colorType === 6) {
        out[o] = cur[i];
        out[o + 1] = cur[i + 1];
        out[o + 2] = cur[i + 2];
        out[o + 3] = cur[i + 3];
      } else if (colorType === 2) {
        out[o] = cur[i];
        out[o + 1] = cur[i + 1];
        out[o + 2] = cur[i + 2];
        out[o + 3] = 255;
      } else {
        out[o] = cur[i];
        out[o + 1] = cur[i];
        out[o + 2] = cur[i];
        out[o + 3] = 255;
      }
    }
    prev.set(cur);
  }
  return { width, height, rgba: out };
}

// ---- bilinear resize -------------------------------------------------
function resizeRGBA(src, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const sy = ((y + 0.5) * sh) / dh - 0.5;
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(sh - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < dw; x++) {
      const sx = ((x + 0.5) * sw) / dw - 0.5;
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(sw - 1, x0 + 1);
      const fx = sx - x0;
      const o = (y * dw + x) * 4;
      for (let c = 0; c < 4; c++) {
        const v =
          src[(y0 * sw + x0) * 4 + c] * (1 - fx) * (1 - fy) +
          src[(y0 * sw + x1) * 4 + c] * fx * (1 - fy) +
          src[(y1 * sw + x0) * 4 + c] * (1 - fx) * fy +
          src[(y1 * sw + x1) * 4 + c] * fx * fy;
        out[o + c] = Math.round(v);
      }
    }
  }
  return out;
}

// ---- icon builders ---------------------------------------------------
function roundedMask(px, size, radius) {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const rx = Math.min(x, size - 1 - x);
      const ry = Math.min(y, size - 1 - y);
      if (rx < radius && ry < radius && Math.hypot(radius - rx, radius - ry) > radius) {
        px[(y * size + x) * 4 + 3] = 0;
      }
    }
  }
  return px;
}

/** Content scale for every icon: the logo occupies 60% of the canvas so the
 *  whole logo (including its rounded frames) stays inside the adaptive-icon
 *  safe zone on every launcher shape — nothing gets clipped by the mask. */
const CONTENT_SCALE = 0.6;

/**
 * Draw the logo onto a size×size icon.
 * mode 'square'      : white background, logo scaled into the safe zone.
 * mode 'rounded'     : same, with rounded-corner alpha mask.
 * mode 'circle'      : white background + circular mask (Android round).
 * mode 'foreground'  : TRANSPARENT canvas + logo in the safe zone (the
 *                      adaptive background layer supplies the colour).
 * `bg` ([r,g,b]) paints an opaque background behind the logo; pass null to
 * keep the canvas transparent (adaptive foreground).
 */
function iconFromLogo(logo, size, mode, bg) {
  const px = Buffer.alloc(size * size * 4);
  if (bg) {
    // Opaque background behind the logo: the logo's own transparent areas
    // show this colour, so the icon is a clean white tile with the SK logo
    // — never a black square/canvas.
    for (let i = 0; i < size * size; i++) {
      px[i * 4] = bg[0];
      px[i * 4 + 1] = bg[1];
      px[i * 4 + 2] = bg[2];
      px[i * 4 + 3] = 255;
    }
  }
  const scale = CONTENT_SCALE;
  // Contain-fit the logo inside the `size*CONTENT_SCALE` safe zone WITHOUT
  // changing its aspect ratio. The source is 2342x1841 (wider than tall), so
  // the width fills the safe zone and the height follows proportionally —
  // the logo is never stretched, and even padding surrounds it on every side
  // (the reported defect was a full-bleed, distorted square logo).
  const maxDim = Math.round(size * scale);
  let dw, dh;
  if (logo.width >= logo.height) {
    dw = maxDim;
    dh = Math.max(1, Math.round((maxDim * logo.height) / logo.width));
  } else {
    dh = maxDim;
    dw = Math.max(1, Math.round((maxDim * logo.width) / logo.height));
  }
  const sw = Math.min(dw, size);
  const sh = Math.min(dh, size);
  const resized = resizeRGBA(logo.rgba, logo.width, logo.height, sw, sh);
  const ox = Math.floor((size - sw) / 2);
  const oy = Math.floor((size - sh) / 2);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const s = (y * sw + x) * 4;
      const d = ((oy + y) * size + ox + x) * 4;
      if (bg) {
        // Composite the logo OVER the background (src-over): the logo's own
        // transparent areas (rounded frame corners, gaps between letters)
        // show the background colour instead of punching transparent holes.
        const a = resized[s + 3] / 255;
        px[d] = Math.round(resized[s] * a + bg[0] * (1 - a));
        px[d + 1] = Math.round(resized[s + 1] * a + bg[1] * (1 - a));
        px[d + 2] = Math.round(resized[s + 2] * a + bg[2] * (1 - a));
        px[d + 3] = 255;
      } else {
        px[d] = resized[s];
        px[d + 1] = resized[s + 1];
        px[d + 2] = resized[s + 2];
        px[d + 3] = resized[s + 3];
      }
    }
  }
  if (mode === 'rounded') return roundedMask(px, size, Math.round(size * 0.18));
  if (mode === 'circle') return roundedMask(px, size, size / 2);
  return px; // square + foreground (full bleed, white or transparent)
}

// ---- fallback: old bitmap "SK" renderer (used only if decode fails) --
const GLYPHS = {
  S: ['11110', '10000', '10000', '11110', '00001', '00001', '11110'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001']
};
function makeIconFallback(size, { maskable = false } = {}) {
  const px = Buffer.alloc(size * size * 4);
  const set = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  };
  const top = { r: 0x1d, g: 0x4e, b: 0xd8 };
  const bottom = { r: 0x0f, g: 0x17, b: 0x2a };
  const radius = maskable ? size * 0.22 : size * 0.18;
  for (let y = 0; y < size; y++) {
    const t = y / (size - 1);
    const r = Math.round(top.r + (bottom.r - top.r) * t);
    const g = Math.round(top.g + (bottom.g - top.g) * t);
    const b = Math.round(top.b + (bottom.b - top.b) * t);
    for (let x = 0; x < size; x++) {
      const rx = Math.min(x, size - 1 - x);
      const ry = Math.min(y, size - 1 - y);
      const outside = rx < radius && ry < radius && Math.hypot(radius - rx, radius - ry) > radius;
      if (!outside) set(x, y, r, g, b);
    }
  }
  const cell = Math.floor((size * 0.32) / 7);
  const gap = Math.floor(cell * 1.4);
  const startX = Math.floor((size - (5 * cell * 2 + gap)) / 2);
  const startY = Math.floor((size - 7 * cell) / 2);
  const drawGlyph = (glyph, ox) => {
    for (let gy = 0; gy < 7; gy++) {
      for (let gx = 0; gx < 5; gx++) {
        if (glyph[gy][gx] === '1') {
          for (let dy = 0; dy < cell; dy++) {
            for (let dx = 0; dx < cell; dx++) {
              set(startX + ox + gx * cell + dx, startY + gy * cell + dy, 255, 255, 255);
            }
          }
        }
      }
    }
  };
  drawGlyph(GLYPHS.S, 0);
  drawGlyph(GLYPHS.K, 5 * cell + gap);
  return encodePNG(size, size, px);
}

// ---- main ------------------------------------------------------------
function write(file, buf) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, buf);
  console.log('wrote', file.replace(root + '/', ''), buf.length, 'bytes');
}

let logo = null;
try {
  logo = decodePNG(readFileSyncSafe(SRC));
  console.log(`Source logo: ${logo.width}x${logo.height} (public/logo.png)`);
} catch (e) {
  console.warn('Could not decode public/logo.png (' + e.message + ') — using placeholder SK icons.');
}

function readFileSyncSafe(p) {
  const { readFileSync } = require_node_fs();
  return readFileSync(p);
}
// small shim to keep the code above clean under ESM
import { readFileSync } from 'node:fs';
function require_node_fs() {
  return { readFileSync };
}

// WHITE background everywhere except the adaptive foreground (transparent).
const WHITE = [255, 255, 255];
const make = (size, mode) =>
  logo
    ? encodePNG(size, size, iconFromLogo(logo, size, mode, mode === 'foreground' ? null : WHITE))
    : makeIconFallback(size, { maskable: mode === 'maskable' });

const out = {
  'public/icons/icon-192.png': make(192, 'square'),
  'public/icons/icon-512.png': make(512, 'square'),
  'public/icons/maskable-512.png': make(512, 'square'), // full-bleed white = maskable-safe
  'public/favicon.png': make(64, 'square'),
  'build/icon.png': make(512, 'square')
};

const androidSizes = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
for (const [dpi, size] of Object.entries(androidSizes)) {
  out[`android/app/src/main/res/mipmap-${dpi}/ic_launcher.png`] = make(size, 'square');
  out[`android/app/src/main/res/mipmap-${dpi}/ic_launcher_round.png`] = make(size, 'circle');
}

// Adaptive-icon foreground (API 26+): transparent canvas, logo in the 60%
// safe zone — the adaptive background colour below supplies the white.
const fgSizes = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
for (const [dpi, size] of Object.entries(fgSizes)) {
  out[`android/app/src/main/res/mipmap-${dpi}/ic_launcher_foreground.png`] = make(size, 'foreground');
}

// Adaptive background colour: WHITE (the reported defect was a black canvas).
write(
  join(root, 'android/app/src/main/res/values/ic_launcher_background.xml'),
  Buffer.from(
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#FFFFFF</color>\n</resources>\n'
  )
);

for (const [file, buf] of Object.entries(out)) write(join(root, file), buf);
console.log(logo ? 'Icons generated from the real SK logo on white.' : 'Fallback placeholder icons generated.');
