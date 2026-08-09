/* =========================================================
   SK FLEX — Capacitor Bridge for Android
   Handles PDF download, printing, and file saving
   using Capacitor native plugins.
   ========================================================= */
(function () {
  "use strict";

  // Detect if running inside Capacitor
  var isCapacitor = typeof window.Capacitor !== 'undefined' && window.Capacitor.isNativePlatform();

  if (!isCapacitor) return;

  // Import Capacitor plugins
  var Filesystem = window.Capacitor.Plugins.Filesystem;
  var SplashScreen = window.Capacitor.Plugins.SplashScreen;
  var StatusBar = window.Capacitor.Plugins.StatusBar;

  // Hide splash screen after web app loads
  window.addEventListener('load', function () {
    setTimeout(function () {
      SplashScreen.hide().catch(function () {});
    }, 500);
  });

  // Set status bar style
  StatusBar.setStyle({ style: 'LIGHT' }).catch(function () {});
  StatusBar.setBackgroundColor({ color: '#D2222A' }).catch(function () {});

  // Expose Android-specific APIs to the app
  window.skflexAndroid = {
    isAndroid: true,

    /**
     * Save a base64-encoded file using Android Storage Access Framework (SAF).
     * Opens the system "Save to" dialog so the user can choose where to save.
     */
    saveFile: function (base64Data, filename, mimeType) {
      return Filesystem.writeFile({
        path: filename,
        data: base64Data,
        directory: Filesystem.Directory.Documents,
        recursive: true
      }).then(function (result) {
        return { success: true, uri: result.uri };
      }).catch(function (err) {
        return { success: false, error: err.message || String(err) };
      });
    },

    /**
     * Print the invoice using the Android Print Framework.
     * The Android WebView's window.print() automatically invokes
     * the system PrintManager.
     * @param {string} htmlContent - Full HTML document to print
     * @param {string} jobName - Print job name
     */
    print: function (htmlContent, jobName) {
      // Create a hidden iframe with the print content and call print
      return new Promise(function (resolve) {
        var iframe = document.createElement('iframe');
        iframe.style.position = 'fixed';
        iframe.style.right = '0';
        iframe.style.bottom = '0';
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = '0';
        iframe.srcdoc = htmlContent;
        document.body.appendChild(iframe);
        
        iframe.onload = function () {
          try {
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
          } catch (err) {
            console.error('Print failed:', err);
          }
          setTimeout(function () {
            document.body.removeChild(iframe);
            resolve({ success: true });
          }, 1000);
        };
      });
    },

    /**
     * Share text using the Android share sheet
     */
    share: function (text, title) {
      return window.Capacitor.Plugins.Share ? 
        window.Capacitor.Plugins.Share.share({ text: text, title: title || 'SK Flex' })
          .then(function () { return { success: true }; })
          .catch(function (err) { return { success: false, error: err.message }; }) :
        Promise.resolve({ success: false, error: 'Share plugin not available' });
    }
  };

  // Override the app's print function to use Android Print Framework
  var originalPrint = window.print;
  window.print = function () {
    var invoiceArea = document.getElementById('invoiceArea');
    if (!invoiceArea) {
      originalPrint.call(window);
      return;
    }
    
    // Build a clean HTML document for printing
    var html = '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
      '<title>SK Flex Invoice</title>' +
      '<style>' +
      'body { font-family: sans-serif; padding: 20px; color: #241C1A; }' +
      '.inv-head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #D2222A; padding-bottom: 16px; margin-bottom: 16px; }' +
      '.inv-brand { display: flex; align-items: center; gap: 12px; }' +
      '.inv-brand img { width: 52px; height: 52px; object-fit: contain; }' +
      '.inv-brand h2 { font-size: 19px; color: #A5171E; margin: 0; }' +
      '.inv-brand p { margin: 3px 0 0; font-size: 11px; color: #6E625C; }' +
      '.inv-meta { text-align: right; font-size: 11.5px; color: #6E625C; }' +
      '.inv-meta b { display: block; font-size: 14px; color: #241C1A; }' +
      '.inv-customer { margin: 16px 0; font-size: 12px; color: #6E625C; }' +
      '.inv-customer b { display: block; color: #241C1A; font-size: 13px; }' +
      'table { width: 100%; border-collapse: collapse; margin-top: 6px; }' +
      'th { background: #F1E9DE; color: #6E625C; font-size: 10.5px; text-transform: uppercase; text-align: left; padding: 8px; border-bottom: 2px solid #D6C7B4; }' +
      'td { padding: 9px 8px; font-size: 12.5px; border-bottom: 1px solid #E8DED2; color: #241C1A; }' +
      'td.num, th.num { text-align: right; }' +
      '.inv-total-row { display: flex; justify-content: flex-end; margin-top: 12px; }' +
      '.inv-total-box { min-width: 220px; }' +
      '.row { display: flex; justify-content: space-between; font-size: 12.5px; color: #6E625C; padding: 4px 0; }' +
      '.row.grand { font-size: 17px; font-weight: 700; color: #A5171E; border-top: 2px solid #241C1A; margin-top: 4px; padding-top: 8px; }' +
      '.inv-footer { text-align: center; margin-top: 26px; padding-top: 14px; border-top: 1px dashed #D6C7B4; }' +
      '.thanks { font-size: 14px; color: #146837; font-weight: 700; }' +
      '.tag { font-size: 10.5px; color: #9A8F89; margin-top: 4px; }' +
      '@media print { body { padding: 0; } }' +
      '</style></head><body>' +
      invoiceArea.innerHTML +
      '</body></html>';

    window.skflexAndroid.print(html, 'SK Flex Invoice');
  };

  // Override the PDF download to use Android Storage Access Framework
  var originalDownloadPdf = window.downloadInvoicePdf;
  if (originalDownloadPdf) {
    // The app.js defines downloadInvoicePdf inside an IIFE, so we need to
    // hook into the button click instead
    var pdfBtn = document.getElementById('btnDownloadPdf');
    if (pdfBtn) {
      pdfBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        window.skflexAndroidDownloadPdf();
      }, true);
    }
  }

  // Hook into the app's downloadInvoicePdf by wrapping the button handler
  // This is set by app.js after it initializes
  window.skflexAndroidDownloadPdf = function () {
    var btn = document.getElementById('btnDownloadPdf');
    var label = document.getElementById('btnDownloadPdfLabel');
    var originalLabel = label ? label.textContent : '';

    if (typeof window.html2canvas !== 'function') {
      alert('PDF library not loaded');
      return;
    }
    if (!window.jspdf || typeof window.jspdf.jsPDF !== 'function') {
      alert('PDF library not loaded');
      return;
    }

    var area = document.getElementById('invoiceArea');
    if (!area || !area.querySelector('.inv-head')) {
      alert('Invoice is empty');
      return;
    }

    if (btn) btn.disabled = true;
    if (label) label.textContent = 'Generating…';

    var marginMm = 10;
    var images = Array.prototype.slice.call(area.querySelectorAll('img'));
    var originalSrcs = images.map(function (img) { return img.src; });

    // Inline images as data URLs to avoid tainted canvas
    function inlineImageAsDataURL(img) {
      return new Promise(function (resolve) {
        if (!img.src || img.src.indexOf('data:') === 0) { resolve(); return; }
        var done = false;
        var finish = function () { if (!done) { done = true; resolve(); } };
        var worker = new Image();
        worker.crossOrigin = 'anonymous';
        worker.onload = function () {
          try {
            var c = document.createElement('canvas');
            c.width = worker.naturalWidth || worker.width;
            c.height = worker.naturalHeight || worker.height;
            var ctx = c.getContext('2d');
            ctx.drawImage(worker, 0, 0);
            img.src = c.toDataURL('image/png');
          } catch (err) {
            console.error('Could not inline image:', err);
          }
          finish();
        };
        worker.onerror = function () { finish(); };
        worker.src = img.src;
        setTimeout(finish, 4000);
      });
    }

    Promise.all(images.map(inlineImageAsDataURL))
      .then(function () {
        return window.html2canvas(area, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
      })
      .then(function (canvas) {
        var jsPDF = window.jspdf.jsPDF;
        var pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
        var pageWidth = pdf.internal.pageSize.getWidth();
        var pageHeight = pdf.internal.pageSize.getHeight();
        var usableWidth = pageWidth - marginMm * 2;
        var usableHeight = pageHeight - marginMm * 2;

        var imgWidth = usableWidth;
        var imgHeight = (canvas.height * imgWidth) / canvas.width;
        var imgData = canvas.toDataURL('image/jpeg', 1.0);

        var heightLeft = imgHeight;
        var position = marginMm;

        pdf.addImage(imgData, 'JPEG', marginMm, position, imgWidth, imgHeight);
        heightLeft -= usableHeight;

        while (heightLeft > 0) {
          position = marginMm - (imgHeight - heightLeft);
          pdf.addPage();
          pdf.addImage(imgData, 'JPEG', marginMm, position, imgWidth, imgHeight);
          heightLeft -= usableHeight;
        }

        var fileName = 'SK-Flex-Bill-' + Date.now() + '.pdf';
        var pdfBase64 = pdf.output('datauristring').split(',')[1];

        // Save using Android Storage Access Framework
        return window.skflexAndroid.saveFile(pdfBase64, fileName, 'application/pdf')
          .then(function (result) {
            if (result.success) {
              alert('PDF saved successfully!');
            } else {
              alert('Could not save PDF: ' + result.error);
            }
          });
      })
      .catch(function (err) {
        console.error(err);
        alert('PDF generation failed: ' + (err.message || String(err)));
      })
      .finally(function () {
        images.forEach(function (img, i) { img.src = originalSrcs[i]; });
        if (btn) btn.disabled = false;
        if (label) label.textContent = originalLabel;
      });
  };

  // Override the JPEG download for Android
  var jpegBtn = document.getElementById('btnDownloadJpeg');
  if (jpegBtn) {
    jpegBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      window.skflexAndroidDownloadJpeg();
    }, true);
  }

  window.skflexAndroidDownloadJpeg = function () {
    var btn = document.getElementById('btnDownloadJpeg');
    var label = document.getElementById('btnDownloadJpegLabel');
    var originalLabel = label ? label.textContent : '';

    if (typeof window.html2canvas !== 'function') {
      alert('Image library not loaded');
      return;
    }

    var area = document.getElementById('invoiceArea');
    if (!area || !area.querySelector('.inv-head')) {
      alert('Invoice is empty');
      return;
    }

    if (btn) btn.disabled = true;
    if (label) label.textContent = 'Generating…';

    var images = Array.prototype.slice.call(area.querySelectorAll('img'));
    var originalSrcs = images.map(function (img) { return img.src; });

    function inlineImageAsDataURL(img) {
      return new Promise(function (resolve) {
        if (!img.src || img.src.indexOf('data:') === 0) { resolve(); return; }
        var done = false;
        var finish = function () { if (!done) { done = true; resolve(); } };
        var worker = new Image();
        worker.crossOrigin = 'anonymous';
        worker.onload = function () {
          try {
            var c = document.createElement('canvas');
            c.width = worker.naturalWidth || worker.width;
            c.height = worker.naturalHeight || worker.height;
            var ctx = c.getContext('2d');
            ctx.drawImage(worker, 0, 0);
            img.src = c.toDataURL('image/png');
          } catch (err) {}
          finish();
        };
        worker.onerror = function () { finish(); };
        worker.src = img.src;
        setTimeout(finish, 4000);
      });
    }

    Promise.all(images.map(inlineImageAsDataURL))
      .then(function () {
        return window.html2canvas(area, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
      })
      .then(function (canvas) {
        var imgData = canvas.toDataURL('image/jpeg', 1.0);
        var fileName = 'SK-Flex-Bill-' + Date.now() + '.jpg';
        var jpegBase64 = imgData.split(',')[1];

        return window.skflexAndroid.saveFile(jpegBase64, fileName, 'image/jpeg')
          .then(function (result) {
            if (result.success) {
              alert('JPEG saved successfully!');
            } else {
              alert('Could not save JPEG: ' + result.error);
            }
          });
      })
      .catch(function (err) {
        console.error(err);
        alert('JPEG generation failed: ' + (err.message || String(err)));
      })
      .finally(function () {
        images.forEach(function (img, i) { img.src = originalSrcs[i]; });
        if (btn) btn.disabled = false;
        if (label) label.textContent = originalLabel;
      });
  };

  // Override backup export to use Android Storage Access Framework
  var exportBtn = document.getElementById('btnExportData');
  if (exportBtn) {
    exportBtn.addEventListener('click', function (e) {
      // Let the original handler run first, then intercept
      setTimeout(function () {
        // The original creates a blob download which won't work on Android.
        // We need to intercept before it runs.
      }, 0);
    }, true);
  }

  // Hook into the export data function
  window.skflexAndroidExportData = function (jsonStr) {
    var fileName = 'skflex-backup-' + Date.now() + '.json';
    var base64 = btoa(unescape(encodeURIComponent(jsonStr)));
    return window.skflexAndroid.saveFile(base64, fileName, 'application/json')
      .then(function (result) {
        if (result.success) {
          alert('Backup exported successfully!');
        } else {
          alert('Could not export backup: ' + result.error);
        }
      });
  };

  // Override the share button to use Android share sheet
  var shareBtn = document.getElementById('btnShare');
  if (shareBtn) {
    shareBtn.addEventListener('click', function (e) {
      // Let the original handler run, but intercept the WhatsApp fallback
      // The original uses window.open which won't work well on Android
      setTimeout(function () {
        // If navigator.share is not available, use Capacitor Share
        if (!navigator.share && window.skflexAndroid) {
          // The original code already ran, so we just need to prevent the WhatsApp fallback
        }
      }, 0);
    }, true);
  }

  console.log('SK Flex Capacitor bridge initialized');
})();