/**
 * Vendor the OCR engine into public/ocr so bill scanning works fully offline
 * on Windows and Android (no CDN, no network at scan time).
 *
 *   node scripts/vendor-ocr.mjs
 *
 * Copies tesseract.js' browser build, the SIMD+non-SIMD LSTM WASM cores and the
 * English trained data (fast, ~1.9 MB gzip) into public/ocr.
 */
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'ocr');
const coreOut = join(out, 'core');
mkdirSync(coreOut, { recursive: true });

const copies = [
  ['node_modules/tesseract.js/dist/tesseract.min.js', 'tesseract.min.js'],
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'core/tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm', 'core/tesseract-core-simd-lstm.wasm'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'core/tesseract-core-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm', 'core/tesseract-core-lstm.wasm']
];

for (const [from, to] of copies) {
  const src = join(root, from);
  if (!existsSync(src)) {
    console.error(`missing ${from} — run npm install first`);
    process.exit(1);
  }
  copyFileSync(src, join(out, to));
  console.log(`copied ${to} (${(statSync(src).size / 1024).toFixed(0)} KB)`);
}

const langFile = join(out, 'eng.traineddata.gz');
const url = 'https://raw.githubusercontent.com/naptha/tessdata/gh-pages/4.0.0_fast/eng.traineddata.gz';
if (!existsSync(langFile)) {
  console.log('downloading eng.traineddata.gz…');
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`download failed: HTTP ${res.status}`);
    process.exit(1);
  }
  writeFileSync(langFile, Buffer.from(await res.arrayBuffer()));
  console.log(`saved eng.traineddata.gz (${(statSync(langFile).size / 1024).toFixed(0)} KB)`);
} else {
  console.log('eng.traineddata.gz already present');
}

console.log('OCR assets ready in public/ocr');
