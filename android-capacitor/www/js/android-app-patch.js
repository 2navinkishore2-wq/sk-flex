/* =========================================================
   SK FLEX — Android App Patch
   Intercepts export data to use Android Storage Access
   Framework instead of browser download.
   ========================================================= */
(function () {
  "use strict";

  // Only run on Android Capacitor
  if (typeof window.Capacitor === 'undefined' || !window.Capacitor.isNativePlatform()) return;

  // Intercept the Export Data button's default handler
  document.addEventListener('DOMContentLoaded', function () {
    var exportBtn = document.getElementById('btnExportData');
    if (!exportBtn) return;

    // Replace click handler on Export Data
    exportBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();

      // Build the backup data — duplicate from app.js
      function loadJSON(key, fallback) {
        try {
          var raw = localStorage.getItem(key);
          if (raw) return JSON.parse(raw);
        } catch (e) {}
        return fallback;
      }

      // Get current state from localStorage
      var settings = loadJSON('skflex_settings', {});
      var companies = loadJSON('skflex_companies', []);
      var activeCompanyId = loadJSON('skflex_active_company', null);
      var customers = loadJSON('skflex_customers', []);
      var billsByDate = loadJSON('skflex_bills_by_date', {});

      var backup = {
        settings: settings,
        companies: companies,
        activeCompanyId: activeCompanyId,
        customers: customers,
        bills: billsByDate,
        exportedAt: new Date().toISOString()
      };

      var jsonStr = JSON.stringify(backup, null, 2);
      
      // Use the Android bridge to save via SAF
      if (window.skflexAndroid && window.skflexAndroidExportData) {
        window.skflexAndroidExportData(jsonStr);
      }
    }, true);
  });
})();