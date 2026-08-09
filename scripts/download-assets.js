/**
 * Downloads CDN dependencies (html2canvas, jsPDF) and Google Fonts
 * to local files so the app works completely offline.
 * 
 * This script runs automatically after `npm install` via the
 * `postinstall` hook in package.json.
 */
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const VENDOR_DIR = path.join(__dirname, '..', 'vendor');
const FONTS_DIR = path.join(__dirname, '..', 'fonts');

// Ensure directories exist
[VENDOR_DIR, FONTS_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// List of files to download
const FILES = [
  {
    url: 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
    dest: path.join(VENDOR_DIR, 'html2canvas.min.js')
  },
  {
    url: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    dest: path.join(VENDOR_DIR, 'jspdf.umd.min.js')
  }
];

// Google Fonts CSS files (we'll download the CSS and then the font files)
const FONT_CSS_URLS = [
  'https://fonts.googleapis.com/css2?family=Poppins:wght@500;600;700;800&display=swap',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  'https://fonts.googleapis.com/css2?family=Noto+Sans+Tamil:wght@400;500;600;700&display=swap'
];

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    
    protocol.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        // Follow redirects
        file.close();
        fs.unlinkSync(dest);
        downloadFile(response.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      
      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        reject(new Error(`Failed to download ${url}: HTTP ${response.statusCode}`));
        return;
      }
      
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        console.log(`✓ Downloaded: ${path.basename(dest)}`);
        resolve();
      });
    }).on('error', (err) => {
      file.close();
      fs.unlinkSync(dest);
      reject(err);
    });
  });
}

async function downloadFonts() {
  console.log('\nDownloading Google Fonts...');
  
  // Font family mapping for proper file naming
  const fontFamilies = [
    { name: 'Poppins', weights: [500, 600, 700, 800] },
    { name: 'Inter', weights: [400, 500, 600, 700] },
    { name: 'Noto Sans Tamil', weights: [400, 500, 600, 700] }
  ];
  
  // Download the CSS files to parse font URLs
  for (let i = 0; i < FONT_CSS_URLS.length; i++) {
    const cssUrl = FONT_CSS_URLS[i];
    const family = fontFamilies[i];
    
    try {
      const css = await new Promise((resolve, reject) => {
        const protocol = cssUrl.startsWith('https') ? https : http;
        protocol.get(cssUrl, (response) => {
          let data = '';
          response.on('data', (chunk) => data += chunk);
          response.on('end', () => resolve(data));
        }).on('error', reject);
      });
      
      // Extract font URLs from CSS
      const fontUrls = css.match(/url\((https:[^)]+)\)/g) || [];
      for (let j = 0; j < fontUrls.length; j++) {
        const cleanUrl = fontUrls[j].replace(/^url\(|\)$/g, '');
        const weight = family.weights[j] || 400;
        const safeName = family.name.toLowerCase().replace(/\s+/g, '-');
        const filename = `${safeName}-${weight}.ttf`;
        const dest = path.join(FONTS_DIR, filename);
        
        if (!fs.existsSync(dest)) {
          try {
            await downloadFile(cleanUrl, dest);
            console.log(`✓ Font: ${filename}`);
          } catch (err) {
            console.log(`⚠ Skipped font: ${filename} (${err.message})`);
          }
        } else {
          console.log(`✓ Already exists: ${filename}`);
        }
      }
    } catch (err) {
      console.log(`⚠ Could not fetch font CSS: ${err.message}`);
    }
  }
  
  console.log('Fonts download complete.');
}

async function main() {
  console.log('Downloading local dependencies for offline use...');
  
  // Download JS libraries
  for (const file of FILES) {
    if (!fs.existsSync(file.dest)) {
      try {
        await downloadFile(file.url, file.dest);
      } catch (err) {
        console.log(`⚠ Skipped: ${path.basename(file.dest)} (${err.message})`);
      }
    } else {
      console.log(`✓ Already exists: ${path.basename(file.dest)}`);
    }
  }
  
  // Download fonts
  await downloadFonts();
  
  console.log('\nAll assets downloaded successfully!');
}

main().catch((err) => {
  console.error('Error downloading assets:', err);
  process.exit(1);
});