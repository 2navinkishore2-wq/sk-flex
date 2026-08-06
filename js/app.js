/* =========================================================
   SK FLEX — app.js
   Vanilla JS, no frameworks. LocalStorage-backed.
   ========================================================= */
(function () {
  "use strict";

  /* ---------------------------------------------------------
     Constants / storage keys
  --------------------------------------------------------- */
  var LS = {
    settings: 'skflex_settings',
    companies: 'skflex_companies',
    activeCompany: 'skflex_active_company',
    customers: 'skflex_customers',
    invoiceSeq: 'skflex_invoice_seq',
    lang: 'skflex_lang',
    draft: 'skflex_draft_bill',
    bills: 'skflex_bills_by_date'
  };

  var DEFAULT_SETTINGS = { rate: 7.5, minSize: 2, maxSize: 100, currency: '₹', vinylRate: 25, starflexRate: 25, sunpackRate: 20 };

  var PRODUCT_LABELS = { flex: 'Flex', frame: 'Frame', vinyl: 'Vinyl', starflex: 'Star Flex', sunpack: 'Sunpack' };
  var PRODUCT_TAGS = { flex: 'FLX', frame: 'FRM', vinyl: 'VIN', starflex: 'SFX', sunpack: 'SUN' };

  var DEFAULT_COMPANY = {
    id: 'default', name: 'SK Flex', phone: '', address: '', logo: 'assets/logo.png'
  };

  // Embedded fallback so the app works fully offline (file://) even if fetch() is blocked.
  var EMBEDDED_FRAME_DATA = {
    "currency": "₹",
    "widthOptions": [
      { "id": "beeding", "label": "Beeding (No Frame)" },
      { "id": "1in", "label": "1 inch" },
      { "id": "1.5in", "label": "1.5 inch" },
      { "id": "2in", "label": "2 inch" }
    ],
    "sizes": [
      { "size": "8x6",   "beeding": 70,   "1in": 130,  "1.5in": null, "2in": null },
      { "size": "10x8",  "beeding": 110,  "1in": 175,  "1.5in": null, "2in": null },
      { "size": "12x8",  "beeding": 125,  "1in": 200,  "1.5in": 240,  "2in": null },
      { "size": "12x10", "beeding": 170,  "1in": 250,  "1.5in": 290,  "2in": null },
      { "size": "10x15", "beeding": 190,  "1in": 260,  "1.5in": 300,  "2in": null },
      { "size": "12x15", "beeding": 225,  "1in": 275,  "1.5in": 330,  "2in": null },
      { "size": "12x18", "beeding": 255,  "1in": 350,  "1.5in": 400,  "2in": 450 },
      { "size": "12x24", "beeding": 420,  "1in": 560,  "1.5in": 610,  "2in": 660 },
      { "size": "12x30", "beeding": 500,  "1in": 675,  "1.5in": 775,  "2in": 825 },
      { "size": "12x36", "beeding": 620,  "1in": 740,  "1.5in": 835,  "2in": 940 },
      { "size": "16x20", "beeding": 565,  "1in": 670,  "1.5in": 770,  "2in": 910 },
      { "size": "16x24", "beeding": 675,  "1in": 775,  "1.5in": 880,  "2in": 1020 },
      { "size": "18x24", "beeding": 760,  "1in": 870,  "1.5in": 970,  "2in": 1120 },
      { "size": "20x24", "beeding": 850,  "1in": 950,  "1.5in": 1050, "2in": 1200 },
      { "size": "20x30", "beeding": 1050, "1in": 1160, "1.5in": 1310, "2in": 1600 },
      { "size": "24x36", "beeding": 1515, "1in": 1720, "1.5in": 2110, "2in": 2500 },
      { "size": "30x40", "beeding": 2150, "1in": 2680, "1.5in": 2850, "2in": 3350 },
      { "size": "36x40", "beeding": 2550, "1in": 3200, "1.5in": 3500, "2in": 3950 },
      { "size": "36x48", "beeding": 3050, "1in": 3850, "1.5in": 4300, "2in": 4800 }
    ]
  };

  /* ---------------------------------------------------------
     Storage helpers
  --------------------------------------------------------- */
  function loadJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return fallback;
  }
  function saveJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  /* ---------------------------------------------------------
     State
  --------------------------------------------------------- */
  var settings = Object.assign({}, DEFAULT_SETTINGS, loadJSON(LS.settings, {}));
  var companies = loadJSON(LS.companies, []);
  var activeCompanyId = loadJSON(LS.activeCompany, null);
  var customers = loadJSON(LS.customers, []);
  var FRAME_DATA = EMBEDDED_FRAME_DATA;
  var items = [];          // current bill line items
  var itemSeq = 1;
  var editingCompanyId = null;
  var editingCustomerId = null;
  var pendingLogoDataUrl = null;
  var currentInvoiceNo = null;
  var confirmCallback = null;
  var currentProduct = 'flex';
  var billsByDate = loadJSON(LS.bills, {});   // { 'YYYY-MM-DD': [ bill, bill, ... ] }
  var currentHistoryDate = null;              // date currently open in Date History
  var viewingBill = null;                     // set when the invoice overlay is showing a saved bill

  function todayISO() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }
  function formatDateDMY(iso) {
    if (!iso) return '';
    var p = iso.split('-');
    if (p.length !== 3) return iso;
    return p[2] + '-' + p[1] + '-' + p[0];
  }

  var billDate = todayISO();

  var draft = loadJSON(LS.draft, null);
  if (draft && Array.isArray(draft.items)) {
    items = draft.items;
    itemSeq = draft.itemSeq || (items.length + 1);
    currentInvoiceNo = draft.invoiceNo || null;
    billDate = draft.billDate || billDate;
  }

  /* ---------------------------------------------------------
     Formatting helpers
  --------------------------------------------------------- */
  function fmtMoney(n) {
    n = isFinite(n) ? n : 0;
    return settings.currency + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtNum(n) {
    if (!isFinite(n)) return '0';
    if (Number.isInteger(n)) return String(n);
    return n.toFixed(2).replace(/\.?0+$/, '');
  }
  function isTa() { return document.body.classList.contains('lang-ta'); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]; }); }

  /* ---------------------------------------------------------
     Elements
  --------------------------------------------------------- */
  var $ = function (id) { return document.getElementById(id); };

  var elWidth = $('inputWidth'), elHeight = $('inputHeight'), elRate = $('inputRate'), elQty = $('inputFlexQty');
  var elSqft = $('displaySqft'), elAmount = $('displayAmount'), elFormula = $('formulaText'), elWarn = $('warnMsg');
  var elAddFlex = $('btnAddFlex');

  var elSizeSel = $('selectFrameSize'), elWidthSel = $('selectFrameWidth');
  var elFramePriceBox = $('framePriceBox'), elFramePriceValue = $('framePriceValue');
  var elFrameQty = $('inputFrameQty'), elFrameLineTotal = $('frameLineTotal'), elAddFrame = $('btnAddFrame');

  var elBillList = $('billList'), elGrandTotal = $('grandTotal'), elGrandTotalValue = $('grandTotalValue');
  var elCustName = $('custName'), elCustPhone = $('custPhone'), elCustAddress = $('custAddress'), elCustomerNames = $('customerNames');
  var elBillDate = $('billDate');
  elBillDate.addEventListener('change', function () {
    billDate = elBillDate.value || todayISO();
    saveDraft();
  });

  /* =========================================================
     Language
  ========================================================= */
  function setLang(lang) {
    document.body.classList.toggle('lang-ta', lang === 'ta');
    document.documentElement.lang = lang;
    $('btnLangTa').classList.toggle('active', lang === 'ta');
    $('btnLangEn').classList.toggle('active', lang !== 'ta');
    try { localStorage.setItem(LS.lang, lang); } catch (e) {}
    updateFormula();
    updateFramePrice();
    renderBillList();
  }

  /* =========================================================
     Page / tab navigation
  ========================================================= */
  function showPage(name) {
    document.querySelectorAll('.page').forEach(function (p) { p.classList.toggle('active', p.id === 'page-' + name); });
    document.querySelectorAll('.bottom-nav button').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-page') === name); });
    if (name === 'settings') { renderCompanyList(); renderCustomerListUI(); fillPrefsForm(); renderSettingsBillsList(); }
    if (name === 'history') { showHistoryDatesView(); }
    window.scrollTo(0, 0);
  }
  $('btnGotoSettings').addEventListener('click', function () { showPage('settings'); });
  $('btnBackToBilling').addEventListener('click', function () { showPage('billing'); });
  document.querySelectorAll('.bottom-nav button').forEach(function (b) {
    b.addEventListener('click', function () { showPage(b.getAttribute('data-page')); });
  });

  var PRODUCT_TABS = [
    { key: 'flex', tab: 'btnTabFlex', card: 'flexCard' },
    { key: 'frame', tab: 'btnTabFrame', card: 'frameCard' },
    { key: 'vinyl', tab: 'btnTabVinyl', card: 'vinylCard' },
    { key: 'starflex', tab: 'btnTabStarflex', card: 'starflexCard' },
    { key: 'sunpack', tab: 'btnTabSunpack', card: 'sunpackCard' }
  ];
  function showProduct(p) {
    currentProduct = p;
    PRODUCT_TABS.forEach(function (t) {
      $(t.tab).classList.toggle('active', p === t.key);
      $(t.card).classList.toggle('hidden', p !== t.key);
    });
  }
  PRODUCT_TABS.forEach(function (t) {
    $(t.tab).addEventListener('click', function () { showProduct(t.key); });
  });

  var settingsTabs = document.querySelectorAll('.settings-tabs button');
  settingsTabs.forEach(function (btn) {
    btn.addEventListener('click', function () {
      settingsTabs.forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      document.querySelectorAll('.settings-panel').forEach(function (p) { p.classList.remove('active'); });
      $('panel-' + btn.getAttribute('data-tab')).classList.add('active');
    });
  });

  /* =========================================================
     FLEX calculator
  ========================================================= */
  function validateSize(w, h) {
    if (w === 0 && h === 0) return '';
    if ((w > 0 && w < settings.minSize) || (h > 0 && h < settings.minSize)) {
      return isTa() ? 'குறைந்தபட்சம் ' + fmtNum(settings.minSize) + ' அடி வேணும்' : 'Minimum size is ' + fmtNum(settings.minSize) + ' ft';
    }
    if (w > settings.maxSize || h > settings.maxSize) {
      return isTa() ? 'அதிகபட்சம் ' + fmtNum(settings.maxSize) + ' அடி வரை மட்டும்' : 'Maximum size is ' + fmtNum(settings.maxSize) + ' ft';
    }
    return '';
  }

  // Shared calculator logic for the Flex-style sections (Flex, Vinyl, Star
  // Flex): Width × Height × Rate × Quantity. Each instance keeps its own
  // DOM elements and state via closures; the math and validation match the
  // original Flex calculator exactly, extended with the Quantity multiplier.
  function createFlexTypeCalculator(cfg) {
    var elW = $(cfg.width), elH = $(cfg.height), elR = $(cfg.rate), elQ = $(cfg.qty);
    var elSqftOut = $(cfg.sqftOut), elAmountOut = $(cfg.amountOut), elFormulaOut = $(cfg.formulaOut);
    var elWarnOut = $(cfg.warnOut), elAddBtn = $(cfg.addBtn), elCurrPrefix = cfg.currPrefix ? $(cfg.currPrefix) : null;

    function currentInputs() {
      var w = parseFloat(elW.value), h = parseFloat(elH.value), r = parseFloat(elR.value), q = parseFloat(elQ.value);
      return {
        w: isNaN(w) ? 0 : w,
        h: isNaN(h) ? 0 : h,
        r: isNaN(r) ? 0 : r,
        q: (isNaN(q) || q <= 0) ? 1 : q
      };
    }
    function updateFormula() {
      var inp = currentInputs();
      var sqft = inp.w * inp.h;
      var amount = sqft * inp.r * inp.q;
      elSqftOut.textContent = fmtNum(sqft);
      elAmountOut.textContent = fmtMoney(amount);
      elFormulaOut.textContent = fmtNum(inp.w) + ' × ' + fmtNum(inp.h) + ' = ' + fmtNum(sqft) + ' sq.ft' + (inp.q !== 1 ? ' × ' + fmtNum(inp.q) + ' qty' : '');
      var warning = validateSize(inp.w, inp.h);
      elWarnOut.textContent = warning;
      elAddBtn.disabled = !(inp.w > 0 && inp.h > 0 && inp.r > 0 && !warning);
      return { inp: inp, sqft: sqft, amount: amount, warning: warning };
    }
    function addItem() {
      var state = updateFormula();
      var inp = state.inp;
      if (inp.w <= 0 || inp.h <= 0 || inp.r <= 0 || state.warning) return;
      items.push({
        id: itemSeq++, type: cfg.type,
        desc: fmtNum(inp.w) + ' × ' + fmtNum(inp.h) + ' ft ' + cfg.label,
        size: fmtNum(inp.w) + ' × ' + fmtNum(inp.h) + ' ft', frameWidth: '',
        qty: inp.q, rate: inp.r, sqft: state.sqft, amount: state.amount
      });
      saveDraft(); renderBillList();
      elW.value = ''; elH.value = ''; elQ.value = 1;
      updateFormula(); elW.focus();
    }
    [elW, elH, elR, elQ].forEach(function (el) { el.addEventListener('input', updateFormula); });
    elAddBtn.addEventListener('click', addItem);

    return {
      updateFormula: updateFormula,
      setRate: function (v) { elR.value = v; },
      setCurrency: function (c) { if (elCurrPrefix) elCurrPrefix.textContent = c; },
      fillFromItem: function (it) {
        var parts = it.size.split('×');
        elW.value = parseFloat(parts[0]) || '';
        elH.value = parseFloat(parts[1]) || '';
        elR.value = it.rate;
        elQ.value = it.qty || 1;
        updateFormula();
      }
    };
  }

  var flexCalc = createFlexTypeCalculator({
    type: 'flex', label: 'Flex',
    width: 'inputWidth', height: 'inputHeight', rate: 'inputRate', qty: 'inputFlexQty',
    sqftOut: 'displaySqft', amountOut: 'displayAmount', formulaOut: 'formulaText', warnOut: 'warnMsg',
    addBtn: 'btnAddFlex', currPrefix: 'currPrefix1'
  });
  var vinylCalc = createFlexTypeCalculator({
    type: 'vinyl', label: 'Vinyl',
    width: 'inputVinylWidth', height: 'inputVinylHeight', rate: 'inputVinylRate', qty: 'inputVinylQty',
    sqftOut: 'displayVinylSqft', amountOut: 'displayVinylAmount', formulaOut: 'formulaVinylText', warnOut: 'warnVinylMsg',
    addBtn: 'btnAddVinyl', currPrefix: 'currPrefixVinyl'
  });
  var starflexCalc = createFlexTypeCalculator({
    type: 'starflex', label: 'Star Flex',
    width: 'inputStarflexWidth', height: 'inputStarflexHeight', rate: 'inputStarflexRate', qty: 'inputStarflexQty',
    sqftOut: 'displayStarflexSqft', amountOut: 'displayStarflexAmount', formulaOut: 'formulaStarflexText', warnOut: 'warnStarflexMsg',
    addBtn: 'btnAddStarflex', currPrefix: 'currPrefixStarflex'
  });
  var sunpackCalc = createFlexTypeCalculator({
    type: 'sunpack', label: 'Sunpack',
    width: 'inputSunpackWidth', height: 'inputSunpackHeight', rate: 'inputSunpackRate', qty: 'inputSunpackQty',
    sqftOut: 'displaySunpackSqft', amountOut: 'displaySunpackAmount', formulaOut: 'formulaSunpackText', warnOut: 'warnSunpackMsg',
    addBtn: 'btnAddSunpack', currPrefix: 'currPrefixSunpack'
  });
  var FLEX_TYPE_CALCS = { flex: flexCalc, vinyl: vinylCalc, starflex: starflexCalc, sunpack: sunpackCalc };

  function updateFormula() {
    flexCalc.updateFormula();
    vinylCalc.updateFormula();
    starflexCalc.updateFormula();
    sunpackCalc.updateFormula();
  }

  /* =========================================================
     FRAME calculator
  ========================================================= */
  function populateFrameSizes() {
    elSizeSel.innerHTML = '<option value="">Select size</option>';
    FRAME_DATA.sizes.forEach(function (row) {
      var opt = document.createElement('option');
      opt.value = row.size;
      opt.textContent = row.size + ' in';
      elSizeSel.appendChild(opt);
    });
  }
  function currentFrameRow() {
    var size = elSizeSel.value;
    if (!size) return null;
    return FRAME_DATA.sizes.find(function (r) { return r.size === size; }) || null;
  }
  function populateFrameWidths() {
    var row = currentFrameRow();
    elWidthSel.innerHTML = '';
    if (!row) {
      elWidthSel.innerHTML = '<option value="">Select size first</option>';
      elWidthSel.disabled = true;
      return;
    }
    elWidthSel.disabled = false;
    elWidthSel.innerHTML = '<option value="">Select width</option>';
    FRAME_DATA.widthOptions.forEach(function (opt) {
      var price = row[opt.id];
      if (price === null || price === undefined) return;
      var o = document.createElement('option');
      o.value = opt.id;
      o.textContent = opt.label + ' — ' + settings.currency + price;
      elWidthSel.appendChild(o);
    });
  }
  function updateFramePrice() {
    var row = currentFrameRow();
    var widthId = elWidthSel.value;
    var price = row && widthId ? row[widthId] : null;
    var qty = parseFloat(elFrameQty.value); if (isNaN(qty) || qty < 1) qty = 1;

    if (price === null || price === undefined) {
      elFramePriceBox.classList.add('na');
      elFramePriceValue.textContent = '—';
      elFrameLineTotal.textContent = '0.00';
      elAddFrame.disabled = true;
      return null;
    }
    elFramePriceBox.classList.remove('na');
    elFramePriceValue.textContent = settings.currency + price.toLocaleString('en-IN');
    var total = price * qty;
    elFrameLineTotal.textContent = total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    elAddFrame.disabled = false;
    return price;
  }
  function addFrameItem() {
    var row = currentFrameRow();
    var widthId = elWidthSel.value;
    var price = row && widthId ? row[widthId] : null;
    if (price === null || price === undefined) return;
    var qty = parseFloat(elFrameQty.value); if (isNaN(qty) || qty < 1) qty = 1;
    var widthLabel = (FRAME_DATA.widthOptions.find(function (o) { return o.id === widthId; }) || {}).label || widthId;
    items.push({
      id: itemSeq++, type: 'frame',
      desc: row.size + ' in Photo Frame',
      size: row.size + ' in', frameWidth: widthLabel,
      qty: qty, rate: price, amount: price * qty
    });
    saveDraft(); renderBillList();
    elFrameQty.value = 1;
    updateFramePrice();
  }
  elSizeSel.addEventListener('change', function () { populateFrameWidths(); updateFramePrice(); });
  elWidthSel.addEventListener('change', updateFramePrice);
  elFrameQty.addEventListener('input', updateFramePrice);
  elAddFrame.addEventListener('click', addFrameItem);

  /* =========================================================
     Bill items
  ========================================================= */
  function saveDraft() {
    saveJSON(LS.draft, { items: items, itemSeq: itemSeq, invoiceNo: currentInvoiceNo, billDate: billDate });
  }
  function removeItem(id) {
    items = items.filter(function (it) { return it.id !== id; });
    saveDraft(); renderBillList();
  }
  function editItem(id) {
    var it = items.find(function (x) { return x.id === id; });
    if (!it) return;
    items = items.filter(function (x) { return x.id !== id; });
    saveDraft();
    if (FLEX_TYPE_CALCS[it.type]) {
      showProduct(it.type);
      FLEX_TYPE_CALCS[it.type].fillFromItem(it);
    } else {
      showProduct('frame');
      elSizeSel.value = it.size.replace(' in', '');
      populateFrameWidths();
      var wOpt = FRAME_DATA.widthOptions.find(function (o) { return o.label === it.frameWidth; });
      if (wOpt) elWidthSel.value = wOpt.id;
      elFrameQty.value = it.qty;
      updateFramePrice();
    }
    renderBillList();
    window.scrollTo(0, 0);
  }
  function renderBillList() {
    if (items.length === 0) {
      elBillList.innerHTML = '<div class="empty-state">' +
        (isTa() ? 'இன்னும் எந்த ஐட்டமும் சேர்க்கவில்லை. மேலே அளவு போட்டு "பில்-ல் சேர்" பண்ணுங்க.' : 'No items yet. Fill in the calculator above and tap "Add to Bill".') +
        '</div>';
      elGrandTotal.style.display = 'none';
      return;
    }
    var html = '', total = 0;
    items.forEach(function (it) {
      total += it.amount;
      var isFlexType = it.type === 'flex' || it.type === 'vinyl' || it.type === 'starflex' || it.type === 'sunpack';
      var sub = isFlexType
        ? (it.sqft ? fmtNum(it.sqft) + ' sq.ft × ' + fmtMoney(it.rate) + (it.qty && it.qty !== 1 ? ' × ' + fmtNum(it.qty) : '') : '')
        : (it.frameWidth + ' × ' + it.qty + ' @ ' + fmtMoney(it.rate));
      html += '<div class="bill-item">' +
        '<div class="tag ' + it.type + '">' + (PRODUCT_TAGS[it.type] || it.type.toUpperCase()) + '</div>' +
        '<div class="meta"><div class="desc">' + esc(it.desc) + '</div><div class="sub">' + esc(sub) + '</div></div>' +
        '<div class="amt">' + fmtMoney(it.amount) + '</div>' +
        '<div class="item-actions">' +
          '<button class="edit" data-id="' + it.id + '" title="Edit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path></svg></button>' +
          '<button class="remove" data-id="' + it.id + '" title="Remove"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"></path></svg></button>' +
        '</div></div>';
    });
    elBillList.innerHTML = html;
    elGrandTotal.style.display = 'flex';
    elGrandTotalValue.textContent = fmtMoney(total);
    elBillList.querySelectorAll('.remove').forEach(function (b) { b.addEventListener('click', function () { removeItem(Number(b.getAttribute('data-id'))); }); });
    elBillList.querySelectorAll('.edit').forEach(function (b) { b.addEventListener('click', function () { editItem(Number(b.getAttribute('data-id'))); }); });
  }
  function clearBill() {
    openConfirm(
      isTa() ? 'புது பில் ஆரம்பிக்கவா?' : 'Start a new bill?',
      isTa() ? 'தற்போதைய பில் ஐட்டம்ஸ் எல்லாம் அழிக்கப்படும்.' : 'All current bill items will be cleared.',
      function () {
        items = []; itemSeq = 1; currentInvoiceNo = null;
        elCustName.value = ''; elCustPhone.value = ''; elCustAddress.value = '';
        billDate = todayISO(); elBillDate.value = billDate;
        saveDraft(); renderBillList();
      }
    );
  }
  $('btnClearBill').addEventListener('click', clearBill);
  $('btnNewBill').addEventListener('click', clearBill);

  /* =========================================================
     Customers
  ========================================================= */
  function renderCustomerDatalist() {
    elCustomerNames.innerHTML = customers.map(function (c) { return '<option value="' + esc(c.name) + '">'; }).join('');
  }
  function findCustomerByName(name) {
    name = (name || '').trim().toLowerCase();
    if (!name) return null;
    return customers.find(function (c) { return c.name.trim().toLowerCase() === name; }) || null;
  }
  elCustName.addEventListener('input', function () {
    var c = findCustomerByName(elCustName.value);
    if (c) { elCustPhone.value = c.phone || ''; elCustAddress.value = c.address || ''; }
  });
  function upsertCustomerFromBillForm() {
    var name = elCustName.value.trim();
    if (!name) return;
    var existing = findCustomerByName(name);
    if (existing) {
      existing.phone = elCustPhone.value.trim() || existing.phone;
      existing.address = elCustAddress.value.trim() || existing.address;
    } else {
      customers.push({ id: Date.now(), name: name, phone: elCustPhone.value.trim(), address: elCustAddress.value.trim() });
    }
    saveJSON(LS.customers, customers);
    renderCustomerDatalist();
  }

  function renderCustomerListUI() {
    var wrap = $('customerListUI');
    if (customers.length === 0) { wrap.innerHTML = '<p class="sub">No customers saved yet.</p>'; return; }
    wrap.innerHTML = customers.map(function (c) {
      return '<div class="list-row"><div class="info"><b>' + esc(c.name) + '</b><span>' + esc(c.phone || '') + (c.address ? ' · ' + esc(c.address) : '') + '</span></div>' +
        '<div class="row-actions">' +
        '<button class="edit" data-id="' + c.id + '" title="Edit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path></svg></button>' +
        '<button class="del" data-id="' + c.id + '" title="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6h14z"></path></svg></button>' +
        '</div></div>';
    }).join('');
    wrap.querySelectorAll('.edit').forEach(function (b) { b.addEventListener('click', function () { startEditCustomer(Number(b.getAttribute('data-id'))); }); });
    wrap.querySelectorAll('.del').forEach(function (b) { b.addEventListener('click', function () { deleteCustomer(Number(b.getAttribute('data-id'))); }); });
  }
  function startEditCustomer(id) {
    var c = customers.find(function (x) { return x.id === id; });
    if (!c) return;
    editingCustomerId = id;
    $('customerFormTitle').textContent = 'Edit Customer';
    $('customerFormName').value = c.name;
    $('customerFormPhone').value = c.phone || '';
    $('customerFormAddress').value = c.address || '';
  }
  function resetCustomerForm() {
    editingCustomerId = null;
    $('customerFormTitle').textContent = 'Add Customer';
    $('customerFormName').value = ''; $('customerFormPhone').value = ''; $('customerFormAddress').value = '';
    $('customerSavedNote').textContent = '';
  }
  function deleteCustomer(id) {
    openConfirm('Delete customer?', 'This customer will be removed from your saved list.', function () {
      customers = customers.filter(function (c) { return c.id !== id; });
      saveJSON(LS.customers, customers);
      renderCustomerListUI(); renderCustomerDatalist();
    });
  }
  $('btnSaveCustomer').addEventListener('click', function () {
    var name = $('customerFormName').value.trim();
    if (!name) { $('customerSavedNote').style.color = 'var(--danger)'; $('customerSavedNote').textContent = 'Name is required.'; return; }
    var data = { name: name, phone: $('customerFormPhone').value.trim(), address: $('customerFormAddress').value.trim() };
    if (editingCustomerId) {
      var c = customers.find(function (x) { return x.id === editingCustomerId; });
      Object.assign(c, data);
    } else {
      customers.push(Object.assign({ id: Date.now() }, data));
    }
    saveJSON(LS.customers, customers);
    renderCustomerListUI(); renderCustomerDatalist();
    $('customerSavedNote').style.color = 'var(--green-dark)';
    $('customerSavedNote').textContent = 'Saved!';
    setTimeout(resetCustomerForm, 500);
  });
  $('btnCancelCustomerEdit').addEventListener('click', resetCustomerForm);

  /* =========================================================
     Companies
  ========================================================= */
  function getActiveCompany() {
    if (activeCompanyId) {
      var c = companies.find(function (x) { return x.id === activeCompanyId; });
      if (c) return c;
    }
    return companies[0] || DEFAULT_COMPANY;
  }
  function applyActiveCompanyToHeader() {
    var c = getActiveCompany();
    $('headerCompanyName').textContent = c.name || 'SK Flex';
    $('headerLogo').src = c.logo || 'assets/logo.png';
  }
  function renderCompanyList() {
    var wrap = $('companyList');
    if (companies.length === 0) { wrap.innerHTML = '<p class="sub">No companies saved yet — using default "SK Flex" branding.</p>'; return; }
    wrap.innerHTML = companies.map(function (c) {
      var isActive = c.id === activeCompanyId;
      return '<div class="list-row' + (isActive ? ' active-row' : '') + '"><div class="info"><b>' + esc(c.name) + '</b><span>' + esc(c.phone || '') + (isActive ? ' · Active' : '') + '</span></div>' +
        '<div class="row-actions">' +
        '<button class="use" data-id="' + c.id + '" title="Use this company"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"></path></svg></button>' +
        '<button class="edit" data-id="' + c.id + '" title="Edit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path></svg></button>' +
        '<button class="del" data-id="' + c.id + '" title="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6h14z"></path></svg></button>' +
        '</div></div>';
    }).join('');
    wrap.querySelectorAll('.use').forEach(function (b) { b.addEventListener('click', function () { activeCompanyId = Number(b.getAttribute('data-id')); saveJSON(LS.activeCompany, activeCompanyId); renderCompanyList(); applyActiveCompanyToHeader(); }); });
    wrap.querySelectorAll('.edit').forEach(function (b) { b.addEventListener('click', function () { startEditCompany(Number(b.getAttribute('data-id'))); }); });
    wrap.querySelectorAll('.del').forEach(function (b) { b.addEventListener('click', function () { deleteCompany(Number(b.getAttribute('data-id'))); }); });
  }
  function startEditCompany(id) {
    var c = companies.find(function (x) { return x.id === id; });
    if (!c) return;
    editingCompanyId = id;
    pendingLogoDataUrl = c.logo || null;
    $('companyFormTitle').textContent = 'Edit Company';
    $('companyFormName').value = c.name;
    $('companyFormPhone').value = c.phone || '';
    $('companyFormAddress').value = c.address || '';
    $('companyLogoPreview').innerHTML = '<img src="' + (c.logo || 'assets/logo.png') + '" alt="">';
  }
  function resetCompanyForm() {
    editingCompanyId = null; pendingLogoDataUrl = null;
    $('companyFormTitle').textContent = 'Add Company';
    $('companyFormName').value = ''; $('companyFormPhone').value = ''; $('companyFormAddress').value = '';
    $('companyLogoPreview').innerHTML = '<img src="assets/logo.png" alt="">';
    $('companySavedNote').textContent = '';
    $('companyLogoInput').value = '';
  }
  function deleteCompany(id) {
    openConfirm('Delete company?', 'This company profile will be removed.', function () {
      companies = companies.filter(function (c) { return c.id !== id; });
      if (activeCompanyId === id) activeCompanyId = companies.length ? companies[0].id : null;
      saveJSON(LS.companies, companies); saveJSON(LS.activeCompany, activeCompanyId);
      renderCompanyList(); applyActiveCompanyToHeader();
    });
  }
  $('companyLogoInput').addEventListener('change', function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (ev) {
      pendingLogoDataUrl = ev.target.result;
      $('companyLogoPreview').innerHTML = '<img src="' + pendingLogoDataUrl + '" alt="">';
    };
    reader.readAsDataURL(file);
  });
  $('btnSaveCompany').addEventListener('click', function () {
    var name = $('companyFormName').value.trim();
    if (!name) { $('companySavedNote').style.color = 'var(--danger)'; $('companySavedNote').textContent = 'Company name is required.'; return; }
    var data = { name: name, phone: $('companyFormPhone').value.trim(), address: $('companyFormAddress').value.trim(), logo: pendingLogoDataUrl || 'assets/logo.png' };
    if (editingCompanyId) {
      var c = companies.find(function (x) { return x.id === editingCompanyId; });
      Object.assign(c, data);
    } else {
      var newId = Date.now();
      companies.push(Object.assign({ id: newId }, data));
      if (!activeCompanyId) activeCompanyId = newId;
    }
    saveJSON(LS.companies, companies); saveJSON(LS.activeCompany, activeCompanyId);
    renderCompanyList(); applyActiveCompanyToHeader();
    $('companySavedNote').style.color = 'var(--green-dark)';
    $('companySavedNote').textContent = 'Saved!';
    setTimeout(resetCompanyForm, 500);
  });
  $('btnCancelCompanyEdit').addEventListener('click', resetCompanyForm);

  /* =========================================================
     Preferences
  ========================================================= */
  function fillPrefsForm() {
    $('settingCurrency').value = settings.currency;
    $('settingRate').value = settings.rate;
    $('settingMin').value = settings.minSize;
    $('settingMax').value = settings.maxSize;
    $('settingVinylRate').value = settings.vinylRate;
    $('settingStarflexRate').value = settings.starflexRate;
    $('settingSunpackRate').value = settings.sunpackRate;
    $('prefsSavedNote').textContent = '';
  }
  $('btnSavePrefs').addEventListener('click', function () {
    var currency = $('settingCurrency').value.trim() || '₹';
    var rate = parseFloat($('settingRate').value);
    var min = parseFloat($('settingMin').value);
    var max = parseFloat($('settingMax').value);
    var vinylRate = parseFloat($('settingVinylRate').value);
    var starflexRate = parseFloat($('settingStarflexRate').value);
    var sunpackRate = parseFloat($('settingSunpackRate').value);
    if (isNaN(rate) || rate <= 0 || isNaN(min) || min <= 0 || isNaN(max) || max <= min ||
        isNaN(vinylRate) || vinylRate <= 0 || isNaN(starflexRate) || starflexRate <= 0 ||
        isNaN(sunpackRate) || sunpackRate <= 0) {
      $('prefsSavedNote').style.color = 'var(--danger)';
      $('prefsSavedNote').textContent = 'Please enter valid values.';
      return;
    }
    settings = { currency: currency, rate: rate, minSize: min, maxSize: max, vinylRate: vinylRate, starflexRate: starflexRate, sunpackRate: sunpackRate };
    saveJSON(LS.settings, settings);
    elRate.value = settings.rate;
    vinylCalc.setRate(settings.vinylRate);
    starflexCalc.setRate(settings.starflexRate);
    sunpackCalc.setRate(settings.sunpackRate);
    $('currPrefix1').textContent = settings.currency;
    $('currPrefix2').textContent = settings.currency;
    vinylCalc.setCurrency(settings.currency);
    starflexCalc.setCurrency(settings.currency);
    sunpackCalc.setCurrency(settings.currency);
    updateFormula(); populateFrameWidths(); updateFramePrice(); renderBillList();
    $('prefsSavedNote').style.color = 'var(--green-dark)';
    $('prefsSavedNote').textContent = 'Saved!';
  });

  /* =========================================================
     Data: export / import / reset
  ========================================================= */
  $('btnExportData').addEventListener('click', function () {
    var backup = { settings: settings, companies: companies, activeCompanyId: activeCompanyId, customers: customers, bills: billsByDate, exportedAt: new Date().toISOString() };
    var blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'skflex-backup-' + Date.now() + '.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
  $('btnImportData').addEventListener('change', function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (ev) {
      try {
        var data = JSON.parse(ev.target.result);
        if (data.settings) settings = Object.assign({}, DEFAULT_SETTINGS, data.settings);
        if (Array.isArray(data.companies)) companies = data.companies;
        if (data.activeCompanyId !== undefined) activeCompanyId = data.activeCompanyId;
        if (Array.isArray(data.customers)) customers = data.customers;
        if (data.bills && typeof data.bills === 'object') billsByDate = data.bills;
        saveJSON(LS.settings, settings); saveJSON(LS.companies, companies);
        saveJSON(LS.activeCompany, activeCompanyId); saveJSON(LS.customers, customers);
        saveJSON(LS.bills, billsByDate);
        applyActiveCompanyToHeader(); renderCompanyList(); renderCustomerListUI(); renderCustomerDatalist(); fillPrefsForm();
        elRate.value = settings.rate;
        vinylCalc.setRate(settings.vinylRate); starflexCalc.setRate(settings.starflexRate); sunpackCalc.setRate(settings.sunpackRate);
        $('currPrefix1').textContent = settings.currency; $('currPrefix2').textContent = settings.currency;
        vinylCalc.setCurrency(settings.currency); starflexCalc.setCurrency(settings.currency); sunpackCalc.setCurrency(settings.currency);
        updateFormula();
        renderHistoryDatesList();
        renderSettingsBillsList();
        alert('Backup imported successfully.');
      } catch (err) { alert('Could not read that backup file.'); }
    };
    reader.readAsText(file);
  });
  $('btnResetAll').addEventListener('click', function () {
    openConfirm('Reset all data?', 'Companies, customers and settings on this device will be permanently deleted.', function () {
      Object.keys(LS).forEach(function (k) { try { localStorage.removeItem(LS[k]); } catch (e) {} });
      location.reload();
    });
  });

  /* =========================================================
     Confirm modal
  ========================================================= */
  function openConfirm(title, message, onConfirm, infoOnly) {
    $('confirmTitle').textContent = title;
    $('confirmMessage').textContent = message;
    confirmCallback = onConfirm;
    $('btnConfirmOk').style.display = infoOnly ? 'none' : '';
    $('btnConfirmCancel').textContent = infoOnly ? 'OK' : 'Cancel';
    $('confirmOverlay').classList.add('open');
  }
  function closeConfirm() { $('confirmOverlay').classList.remove('open'); confirmCallback = null; $('btnConfirmOk').style.display = ''; $('btnConfirmCancel').textContent = 'Cancel'; }
  $('btnConfirmCancel').addEventListener('click', closeConfirm);
  $('btnConfirmOk').addEventListener('click', function () { var cb = confirmCallback; closeConfirm(); if (cb) cb(); });
  $('confirmOverlay').addEventListener('click', function (e) { if (e.target === $('confirmOverlay')) closeConfirm(); });

  /* =========================================================
     Invoice
  ========================================================= */
  function nextInvoiceNumber() {
    if (currentInvoiceNo) return currentInvoiceNo;
    var seq = loadJSON(LS.invoiceSeq, 1);
    currentInvoiceNo = 'SKF-' + String(seq).padStart(5, '0');
    saveJSON(LS.invoiceSeq, seq + 1);
    saveDraft();
    return currentInvoiceNo;
  }
  // When called with no argument, builds the invoice for the current live
  // draft (exact original behaviour). When called with a saved bill object
  // (from Date History), builds a read-only snapshot of that bill instead —
  // used so a saved bill can be viewed, printed and downloaded exactly as
  // it was saved, without touching the current in-progress bill.
  function buildInvoiceHTML(bill) {
    var isHistorical = !!bill;
    var company = isHistorical
      ? (companies.find(function (c) { return c.id === bill.companyId; }) || DEFAULT_COMPANY)
      : getActiveCompany();
    var invNo = isHistorical ? bill.invoiceNo : nextInvoiceNumber();
    // Invoice date always reflects the selected Bill Date — for a saved
    // bill that's the date it was stored under; for the live draft it's
    // whatever is currently chosen in the Bill Date field (defaults to
    // today, but must never silently fall back to "today" once the user
    // has picked a different date).
    var effectiveDateISO = isHistorical ? bill.date : (billDate || todayISO());
    var edt = new Date(effectiveDateISO + 'T00:00:00');
    var dateStr = isNaN(edt.getTime()) ? formatDateDMY(effectiveDateISO) : edt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    var theItems = isHistorical ? (bill.items || []) : items;
    var total = theItems.reduce(function (s, it) { return s + it.amount; }, 0);

    var rows = theItems.map(function (it) {
      return '<tr>' +
        '<td>' + esc(PRODUCT_LABELS[it.type] || it.type) + '</td>' +
        '<td>' + esc(it.desc) + '</td>' +
        '<td>' + esc(it.size) + '</td>' +
        '<td>' + esc(it.frameWidth || '—') + '</td>' +
        '<td class="num">' + fmtNum(it.qty || 1) + '</td>' +
        '<td class="num">' + fmtMoney(it.rate) + '</td>' +
        '<td class="num">' + fmtMoney(it.amount) + '</td>' +
        '</tr>';
    }).join('');

    var custName = isHistorical ? ((bill.customer && bill.customer.name) || '') : elCustName.value.trim();
    var custPhone = isHistorical ? ((bill.customer && bill.customer.phone) || '') : elCustPhone.value.trim();
    var custAddress = isHistorical ? ((bill.customer && bill.customer.address) || '') : elCustAddress.value.trim();
    var custBlock = custName
      ? '<div><b>' + esc(custName) + '</b>' + (custPhone ? '<div>' + esc(custPhone) + '</div>' : '') + (custAddress ? '<div>' + esc(custAddress) + '</div>' : '') + '</div>'
      : '<div><b>Walk-in Customer</b></div>';

    return '' +
      '<div class="inv-head">' +
        '<div class="inv-brand"><img src="' + (company.logo || 'assets/logo.png') + '" alt="Logo">' +
          '<div><h2>' + esc(company.name || 'SK Flex') + '</h2>' +
            '<p>' + (company.phone ? 'Ph: ' + esc(company.phone) + '<br>' : '') + esc(company.address || '') + '</p>' +
          '</div>' +
        '</div>' +
        '<div class="inv-meta"><b>INVOICE</b>#' + invNo + '<br>' + dateStr + '</div>' +
      '</div>' +
      '<div class="inv-customer"><div>Billed To:' + custBlock + '</div></div>' +
      '<table class="inv-table"><thead><tr>' +
        '<th>Product</th><th>Description</th><th>Size</th><th>Frame Width</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="inv-total-row"><div class="inv-total-box">' +
        '<div class="row grand"><span>Grand Total</span><span>' + fmtMoney(total) + '</span></div>' +
      '</div></div>' +
      '<div class="inv-footer"><div class="thanks">Thank you for your business!</div><div class="tag">' + esc(company.name || 'SK Flex') + (company.phone ? ' · ' + esc(company.phone) : '') + '</div></div>';
  }
  function previewInvoice() {
    if (items.length === 0) {
      openConfirm(isTa() ? 'பில் காலியாக இருக்கு' : 'Bill is empty', isTa() ? 'இன்வாய்ஸ் பார்க்க முதலில் ஐட்டம் சேருங்க.' : 'Add at least one item before previewing the invoice.', null, true);
      return;
    }
    viewingBill = null;
    upsertCustomerFromBillForm();
    $('invoiceArea').innerHTML = buildInvoiceHTML();
    $('invoiceOverlay').classList.add('open');
  }
  function viewSavedBill(bill) {
    viewingBill = bill;
    $('invoiceArea').innerHTML = buildInvoiceHTML(bill);
    $('invoiceOverlay').classList.add('open');
  }
  function closeInvoiceOverlay() {
    $('invoiceOverlay').classList.remove('open');
    viewingBill = null;
  }
  $('btnPreviewInvoice').addEventListener('click', previewInvoice);
  $('btnCloseInvoice').addEventListener('click', closeInvoiceOverlay);
  $('btnPrint').addEventListener('click', function () { window.print(); });
  $('btnDownloadPdf').addEventListener('click', downloadInvoicePdf);

  /* =========================================================
     Save Bill (date-wise storage)
  ========================================================= */
  function saveBill() {
    if (items.length === 0) {
      openConfirm(isTa() ? 'பில் காலியாக இருக்கு' : 'Bill is empty', isTa() ? 'சேமிக்க முதலில் ஐட்டம் சேருங்க.' : 'Add at least one item before saving the bill.', null, true);
      return;
    }
    upsertCustomerFromBillForm();
    var invNo = nextInvoiceNumber();
    var dateKey = billDate || todayISO();
    var total = items.reduce(function (s, it) { return s + it.amount; }, 0);
    var bill = {
      id: Date.now(),
      invoiceNo: invNo,
      date: dateKey,
      companyId: activeCompanyId,
      customer: {
        name: elCustName.value.trim(),
        phone: elCustPhone.value.trim(),
        address: elCustAddress.value.trim()
      },
      items: JSON.parse(JSON.stringify(items)),
      total: total,
      savedAt: new Date().toISOString()
    };
    // Use the currently selected date strictly as its own storage key —
    // each date's array is independent and only ever appended to under
    // its own key, so bills saved under one date can never end up mixed
    // into another date's list.
    if (!billsByDate[dateKey]) billsByDate[dateKey] = [];
    billsByDate[dateKey].push(bill);
    saveJSON(LS.bills, billsByDate);
    renderHistoryDatesList();
    renderSettingsBillsList();

    // Bug fix: the current bill's items/customer were never cleared after
    // saving, so if the user then picked a different date and added new
    // items, those leftover items were saved again into the new date's
    // bill too — making bills from different dates appear "mixed". Start
    // a clean, empty bill immediately after a successful save (the Bill
    // Date field itself is left exactly as the user set it).
    items = []; itemSeq = 1; currentInvoiceNo = null;
    elCustName.value = ''; elCustPhone.value = ''; elCustAddress.value = '';
    saveDraft();
    renderBillList();

    openConfirm(
      isTa() ? 'பில் சேமிக்கப்பட்டது' : 'Bill Saved',
      (isTa() ? 'இந்த தேதியில் பில் சேமிக்கப்பட்டது: ' : 'Bill has been saved under ') + formatDateDMY(dateKey),
      null, true
    );
  }
  $('btnSaveBill').addEventListener('click', saveBill);

  /* =========================================================
     Date History
  ========================================================= */
  function showHistoryDatesView() {
    currentHistoryDate = null;
    $('historyBillsView').classList.add('hidden');
    $('historyDatesView').classList.remove('hidden');
    renderHistoryDatesList();
  }
  function showHistoryBillsForDate(date) {
    currentHistoryDate = date;
    $('historyBillsDateTitle').textContent = formatDateDMY(date);
    renderHistoryBillsList();
    $('historyDatesView').classList.add('hidden');
    $('historyBillsView').classList.remove('hidden');
  }
  function renderHistoryDatesList() {
    var wrap = $('historyDatesList');
    if (!wrap) return;
    var dates = Object.keys(billsByDate).filter(function (d) { return billsByDate[d] && billsByDate[d].length; }).sort().reverse();
    if (dates.length === 0) {
      wrap.innerHTML = '<p class="sub">' + (isTa() ? 'இன்னும் பில் சேமிக்கப்படவில்லை.' : 'No bills saved yet.') + '</p>';
      return;
    }
    wrap.innerHTML = dates.map(function (d) {
      var bills = billsByDate[d];
      var total = bills.reduce(function (s, b) { return s + (b.total || 0); }, 0);
      var billWord = bills.length === 1 ? (isTa() ? 'பில்' : 'bill') : (isTa() ? 'பில்கள்' : 'bills');
      return '<div class="list-row history-date-row" data-date="' + esc(d) + '" style="cursor:pointer;">' +
        '<div class="info"><b>' + esc(formatDateDMY(d)) + '</b><span>' + bills.length + ' ' + billWord + ' · ' + fmtMoney(total) + '</span></div>' +
        '<div class="row-actions"><button class="use view-date" data-date="' + esc(d) + '" title="View">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"></path></svg>' +
        '</button></div></div>';
    }).join('');
    wrap.querySelectorAll('.history-date-row').forEach(function (row) {
      row.addEventListener('click', function (e) { if (e.target.closest('button')) return; showHistoryBillsForDate(row.getAttribute('data-date')); });
    });
    wrap.querySelectorAll('.view-date').forEach(function (b) {
      b.addEventListener('click', function (e) { e.stopPropagation(); showHistoryBillsForDate(b.getAttribute('data-date')); });
    });
  }
  function renderHistoryBillsList() {
    var wrap = $('historyBillsList');
    var bills = billsByDate[currentHistoryDate] || [];
    if (bills.length === 0) {
      wrap.innerHTML = '<p class="sub">' + (isTa() ? 'இந்த தேதியில் பில் இல்லை.' : 'No bills for this date.') + '</p>';
      return;
    }
    wrap.innerHTML = bills.map(function (b, idx) {
      var custLabel = (b.customer && b.customer.name) ? esc(b.customer.name) : (isTa() ? 'வாக்-இன் வாடிக்கையாளர்' : 'Walk-in Customer');
      return '<div class="list-row"><div class="info"><b>' + (isTa() ? 'பில் ' : 'Bill ') + (idx + 1) + ' · ' + esc(b.invoiceNo || '') + '</b>' +
        '<span>' + custLabel + ' · ' + fmtMoney(b.total || 0) + '</span></div>' +
        '<div class="row-actions">' +
        '<button class="use view-bill" data-id="' + b.id + '" title="View"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg></button>' +
        '<button class="del del-bill" data-id="' + b.id + '" title="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6h14z"></path></svg></button>' +
        '</div></div>';
    }).join('');
    wrap.querySelectorAll('.view-bill').forEach(function (b) {
      b.addEventListener('click', function () {
        var bill = bills.find(function (x) { return x.id === Number(b.getAttribute('data-id')); });
        if (bill) viewSavedBill(bill);
      });
    });
    wrap.querySelectorAll('.del-bill').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = Number(b.getAttribute('data-id'));
        openConfirm(
          isTa() ? 'பில் அழிக்கவா?' : 'Delete this bill?',
          isTa() ? 'இந்த பில் நிரந்தரமாக அழிக்கப்படும்.' : 'This bill will be permanently removed.',
          function () {
            billsByDate[currentHistoryDate] = (billsByDate[currentHistoryDate] || []).filter(function (x) { return x.id !== id; });
            if (billsByDate[currentHistoryDate].length === 0) delete billsByDate[currentHistoryDate];
            saveJSON(LS.bills, billsByDate);
            if (billsByDate[currentHistoryDate]) {
              renderHistoryBillsList();
            } else {
              showHistoryDatesView();
            }
            renderHistoryDatesList();
            renderSettingsBillsList();
          }
        );
      });
    });
  }
  $('btnBackToDates').addEventListener('click', showHistoryDatesView);

  /* =========================================================
     Settings → Saved Bills (simple list, opens the same
     Date History view when a date is tapped)
  ========================================================= */
  function openSavedBillsForDateFromSettings(date) {
    showPage('history');
    showHistoryBillsForDate(date);
  }
  function renderSettingsBillsList() {
    var wrap = $('settingsBillsList');
    if (!wrap) return;
    var dates = Object.keys(billsByDate).filter(function (d) { return billsByDate[d] && billsByDate[d].length; }).sort().reverse();
    if (dates.length === 0) {
      wrap.innerHTML = '<p class="sub">No bills saved yet.</p>';
      return;
    }
    wrap.innerHTML = dates.map(function (d) {
      var bills = billsByDate[d];
      var billWord = bills.length === 1 ? 'Bill' : 'Bills';
      return '<div class="list-row settings-bill-date-row" data-date="' + esc(d) + '" style="cursor:pointer;">' +
        '<div class="info"><b>' + esc(formatDateDMY(d)) + '</b><span>(' + bills.length + ' ' + billWord + ')</span></div>' +
        '<div class="row-actions"><button class="use view-settings-date" data-date="' + esc(d) + '" title="View">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"></path></svg>' +
        '</button></div></div>';
    }).join('');
    wrap.querySelectorAll('.settings-bill-date-row').forEach(function (row) {
      row.addEventListener('click', function (e) { if (e.target.closest('button')) return; openSavedBillsForDateFromSettings(row.getAttribute('data-date')); });
    });
    wrap.querySelectorAll('.view-settings-date').forEach(function (b) {
      b.addEventListener('click', function (e) { e.stopPropagation(); openSavedBillsForDateFromSettings(b.getAttribute('data-date')); });
    });
  }

  // Converts an <img> element's src to a base64 data: URL so html2canvas
  // never has to paint a cross-origin / local-file image onto its internal
  // canvas. Drawing such an image (e.g. <img src="assets/logo.png"> when the
  // app is opened via file://, or a custom-uploaded logo) marks that canvas
  // as "tainted", and canvas.toDataURL() then throws a SecurityError. That
  // was the real, silent cause of PDF generation failing. Returns a Promise
  // that always resolves (never rejects) — if a given image can't be
  // inlined, it's left as-is and the real reason is logged, but it doesn't
  // block the rest of the PDF.
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
          img.src = c.toDataURL('image/png'); // succeeds only if not tainted
        } catch (err) {
          console.error('Could not inline invoice image (will render without it):', err);
        }
        finish();
      };
      worker.onerror = function (err) {
        console.error('Could not load invoice image for inlining:', img.src, err);
        finish();
      };
      worker.src = img.src;
      // Safety timeout so a hung/broken image request can't stall the PDF.
      setTimeout(finish, 4000);
    });
  }

  function downloadInvoicePdf() {
    var btn = $('btnDownloadPdf'), label = $('btnDownloadPdfLabel');
    var originalLabel = label.textContent;

    // 3 & 6: verify the PDF libraries are actually present before using them.
    if (typeof window.html2canvas !== 'function') {
      var e1 = new Error('html2canvas failed to load — window.html2canvas is not a function.');
      console.error(e1);
      openConfirm(isTa() ? 'பிழை' : 'Error', e1.message, null, true);
      return;
    }
    if (!window.jspdf || typeof window.jspdf.jsPDF !== 'function') {
      var e2 = new Error('jsPDF failed to load — window.jspdf.jsPDF is not a function.');
      console.error(e2);
      openConfirm(isTa() ? 'பிழை' : 'Error', e2.message, null, true);
      return;
    }

    // 4 & 5: verify the bill element exists before generating the PDF.
    var area = $('invoiceArea');
    if (!area || !area.querySelector('.inv-head')) {
      var e3 = new Error('Invoice element (#invoiceArea) was not found or is empty.');
      console.error(e3);
      openConfirm(isTa() ? 'பிழை' : 'Error', e3.message, null, true);
      return;
    }

    btn.disabled = true;
    label.textContent = 'Generating…';

    var marginMm = 10; // margin: 10mm
    var images = Array.prototype.slice.call(area.querySelectorAll('img'));
    var originalSrcs = images.map(function (img) { return img.src; });

    Promise.all(images.map(inlineImageAsDataURL))
      .then(function () {
        return window.html2canvas(area, { scale: 2, backgroundColor: '#ffffff', useCORS: true }); // html2canvas scale: 2
      })
      .then(function (canvas) {
        var jsPDF = window.jspdf.jsPDF;
        var pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' }); // jsPDF unit: mm, format: a4, orientation: portrait
        var pageWidth = pdf.internal.pageSize.getWidth();
        var pageHeight = pdf.internal.pageSize.getHeight();
        var usableWidth = pageWidth - marginMm * 2;
        var usableHeight = pageHeight - marginMm * 2;

        var imgWidth = usableWidth;
        var imgHeight = (canvas.height * imgWidth) / canvas.width;
        var imgData = canvas.toDataURL('image/jpeg', 1.0); // image quality: 1.0

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

        var company = viewingBill
          ? (companies.find(function (c) { return c.id === viewingBill.companyId; }) || DEFAULT_COMPANY)
          : getActiveCompany();
        var invNoForFile = viewingBill ? viewingBill.invoiceNo : currentInvoiceNo;
        var fileName = ((company.name || 'SK-Flex') + '-Bill-' + (invNoForFile || Date.now()))
          .replace(/[^a-z0-9\-]+/gi, '_');
        pdf.save(fileName + '.pdf'); // auto-saves the file, no print dialog, no "Save as PDF" step
      })
      .catch(function (err) {
        // 1 & 2: no generic catch-all message — log and surface the real error.
        console.error(err);
        var msg = (err && err.message) ? err.message : String(err);
        openConfirm(isTa() ? 'பிழை' : 'Error', msg, null, true);
      })
      .finally(function () {
        // Restore original <img> src values (undo the inlining).
        images.forEach(function (img, i) { img.src = originalSrcs[i]; });
        btn.disabled = false;
        label.textContent = originalLabel;
      });
  }
  // Download JPEG — same rendering approach as Download PDF (image inlining
  // + html2canvas), but saves the rendered canvas directly as a .jpg file
  // instead of embedding it into a PDF. Kept fully separate from
  // downloadInvoicePdf so the PDF button's behaviour is untouched.
  function downloadInvoiceJpeg() {
    var btn = $('btnDownloadJpeg'), label = $('btnDownloadJpegLabel');
    var originalLabel = label.textContent;

    if (typeof window.html2canvas !== 'function') {
      var e1 = new Error('html2canvas failed to load — window.html2canvas is not a function.');
      console.error(e1);
      openConfirm(isTa() ? 'பிழை' : 'Error', e1.message, null, true);
      return;
    }

    var area = $('invoiceArea');
    if (!area || !area.querySelector('.inv-head')) {
      var e3 = new Error('Invoice element (#invoiceArea) was not found or is empty.');
      console.error(e3);
      openConfirm(isTa() ? 'பிழை' : 'Error', e3.message, null, true);
      return;
    }

    btn.disabled = true;
    label.textContent = 'Generating…';

    var images = Array.prototype.slice.call(area.querySelectorAll('img'));
    var originalSrcs = images.map(function (img) { return img.src; });

    Promise.all(images.map(inlineImageAsDataURL))
      .then(function () {
        return window.html2canvas(area, { scale: 2, backgroundColor: '#ffffff', useCORS: true }); // html2canvas scale: 2
      })
      .then(function (canvas) {
        var imgData = canvas.toDataURL('image/jpeg', 1.0); // high-quality JPEG

        var company = viewingBill
          ? (companies.find(function (c) { return c.id === viewingBill.companyId; }) || DEFAULT_COMPANY)
          : getActiveCompany();
        var invNoForFile = viewingBill ? viewingBill.invoiceNo : currentInvoiceNo;
        var fileName = ((company.name || 'SK-Flex') + '-Bill-' + (invNoForFile || Date.now()))
          .replace(/[^a-z0-9\-]+/gi, '_');

        var a = document.createElement('a');
        a.href = imgData;
        a.download = fileName + '.jpg';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      })
      .catch(function (err) {
        console.error(err);
        var msg = (err && err.message) ? err.message : String(err);
        openConfirm(isTa() ? 'பிழை' : 'Error', msg, null, true);
      })
      .finally(function () {
        images.forEach(function (img, i) { img.src = originalSrcs[i]; });
        btn.disabled = false;
        label.textContent = originalLabel;
      });
  }
  $('btnDownloadJpeg').addEventListener('click', downloadInvoiceJpeg);
  $('btnShare').addEventListener('click', function () {
    var srcItems = viewingBill ? (viewingBill.items || []) : items;
    var company = viewingBill
      ? (companies.find(function (c) { return c.id === viewingBill.companyId; }) || DEFAULT_COMPANY)
      : getActiveCompany();
    var invNoForShare = viewingBill ? viewingBill.invoiceNo : currentInvoiceNo;
    var total = srcItems.reduce(function (s, it) { return s + it.amount; }, 0);
    var lines = srcItems.map(function (it) { return '• ' + it.desc + (it.frameWidth ? ' (' + it.frameWidth + ')' : '') + ' x' + (it.qty || 1) + ' — ' + fmtMoney(it.amount); });
    var text = (company.name || 'SK Flex') + ' — Invoice ' + (invNoForShare || '') + '\n' +
      lines.join('\n') + '\n\nGrand Total: ' + fmtMoney(total) + '\nThank you for your business!';
    if (navigator.share) {
      navigator.share({ title: 'Invoice — ' + (company.name || 'SK Flex'), text: text }).catch(function () {});
    } else {
      window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
    }
  });
  $('invoiceOverlay').addEventListener('click', function (e) { if (e.target === $('invoiceOverlay')) closeInvoiceOverlay(); });

  /* =========================================================
     Language / lang toggle wiring
  ========================================================= */
  $('btnLangTa').addEventListener('click', function () { setLang('ta'); });
  $('btnLangEn').addEventListener('click', function () { setLang('en'); });

  /* =========================================================
     Init
  ========================================================= */
  function init() {
    populateFrameSizes();
    populateFrameWidths();
    elRate.value = settings.rate;
    $('currPrefix1').textContent = settings.currency;
    $('currPrefix2').textContent = settings.currency;
    vinylCalc.setRate(settings.vinylRate);
    starflexCalc.setRate(settings.starflexRate);
    sunpackCalc.setRate(settings.sunpackRate);
    vinylCalc.setCurrency(settings.currency);
    starflexCalc.setCurrency(settings.currency);
    sunpackCalc.setCurrency(settings.currency);

    elBillDate.value = billDate;

    applyActiveCompanyToHeader();
    renderCustomerDatalist();

    var storedLang = 'en';
    try { storedLang = localStorage.getItem(LS.lang) || 'en'; } catch (e) {}
    setLang(storedLang);

    showProduct('flex');
    updateFormula();
    updateFramePrice();
    renderBillList();

    // Try loading the external, editable data file when served over http(s);
    // silently keep the embedded copy when opened directly from disk (file://).
    if (location.protocol !== 'file:') {
      fetch('data/frame-prices.json').then(function (r) { return r.ok ? r.json() : null; }).then(function (data) {
        if (data && data.sizes) {
          FRAME_DATA = data;
          populateFrameSizes(); populateFrameWidths(); updateFramePrice();
        }
      }).catch(function () {});
    }
  }
  init();

  window.addEventListener('load', function () {
    setTimeout(function () { $('loadingScreen').classList.add('done'); }, 450);
  });
})();
