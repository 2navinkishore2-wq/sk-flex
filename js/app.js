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
    draft: 'skflex_draft_bill'
  };

  var DEFAULT_SETTINGS = { rate: 7.5, minSize: 2, maxSize: 100, currency: '₹' };

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

  var draft = loadJSON(LS.draft, null);
  if (draft && Array.isArray(draft.items)) {
    items = draft.items;
    itemSeq = draft.itemSeq || (items.length + 1);
    currentInvoiceNo = draft.invoiceNo || null;
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

  var elWidth = $('inputWidth'), elHeight = $('inputHeight'), elRate = $('inputRate');
  var elSqft = $('displaySqft'), elAmount = $('displayAmount'), elFormula = $('formulaText'), elWarn = $('warnMsg');
  var elAddFlex = $('btnAddFlex');

  var elSizeSel = $('selectFrameSize'), elWidthSel = $('selectFrameWidth');
  var elFramePriceBox = $('framePriceBox'), elFramePriceValue = $('framePriceValue');
  var elFrameQty = $('inputFrameQty'), elFrameLineTotal = $('frameLineTotal'), elAddFrame = $('btnAddFrame');

  var elBillList = $('billList'), elGrandTotal = $('grandTotal'), elGrandTotalValue = $('grandTotalValue');
  var elCustName = $('custName'), elCustPhone = $('custPhone'), elCustAddress = $('custAddress'), elCustomerNames = $('customerNames');

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
    if (name === 'settings') { renderCompanyList(); renderCustomerListUI(); fillPrefsForm(); }
    window.scrollTo(0, 0);
  }
  $('btnGotoSettings').addEventListener('click', function () { showPage('settings'); });
  $('btnBackToBilling').addEventListener('click', function () { showPage('billing'); });
  document.querySelectorAll('.bottom-nav button').forEach(function (b) {
    b.addEventListener('click', function () { showPage(b.getAttribute('data-page')); });
  });

  function showProduct(p) {
    currentProduct = p;
    $('btnTabFlex').classList.toggle('active', p === 'flex');
    $('btnTabFrame').classList.toggle('active', p === 'frame');
    $('flexCard').classList.toggle('hidden', p !== 'flex');
    $('frameCard').classList.toggle('hidden', p !== 'frame');
  }
  $('btnTabFlex').addEventListener('click', function () { showProduct('flex'); });
  $('btnTabFrame').addEventListener('click', function () { showProduct('frame'); });

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
  function currentFlexInputs() {
    var w = parseFloat(elWidth.value), h = parseFloat(elHeight.value), r = parseFloat(elRate.value);
    return { w: isNaN(w) ? 0 : w, h: isNaN(h) ? 0 : h, r: isNaN(r) ? 0 : r };
  }
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
  function updateFormula() {
    var inp = currentFlexInputs();
    var sqft = inp.w * inp.h;
    var amount = sqft * inp.r;
    elSqft.textContent = fmtNum(sqft);
    elAmount.textContent = fmtMoney(amount);
    elFormula.textContent = fmtNum(inp.w) + ' × ' + fmtNum(inp.h) + ' = ' + fmtNum(sqft) + ' sq.ft';
    var warning = validateSize(inp.w, inp.h);
    elWarn.textContent = warning;
    elAddFlex.disabled = !(inp.w > 0 && inp.h > 0 && inp.r > 0 && !warning);
  }
  function addFlexItem() {
    var inp = currentFlexInputs();
    if (inp.w <= 0 || inp.h <= 0 || inp.r <= 0 || validateSize(inp.w, inp.h)) return;
    var sqft = inp.w * inp.h;
    var amount = sqft * inp.r;
    items.push({
      id: itemSeq++, type: 'flex',
      desc: fmtNum(inp.w) + ' × ' + fmtNum(inp.h) + ' ft Flex',
      size: fmtNum(inp.w) + ' × ' + fmtNum(inp.h) + ' ft', frameWidth: '',
      qty: 1, rate: inp.r, sqft: sqft, amount: amount
    });
    saveDraft(); renderBillList();
    elWidth.value = ''; elHeight.value = '';
    updateFormula(); elWidth.focus();
  }
  [elWidth, elHeight, elRate].forEach(function (el) { el.addEventListener('input', updateFormula); });
  elAddFlex.addEventListener('click', addFlexItem);

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
    saveJSON(LS.draft, { items: items, itemSeq: itemSeq, invoiceNo: currentInvoiceNo });
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
    if (it.type === 'flex') {
      showProduct('flex');
      var parts = it.size.split('×');
      elWidth.value = parseFloat(parts[0]) || '';
      elHeight.value = parseFloat(parts[1]) || '';
      elRate.value = it.rate;
      updateFormula();
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
      var sub = it.type === 'flex'
        ? (it.sqft ? fmtNum(it.sqft) + ' sq.ft × ' + fmtMoney(it.rate) : '')
        : (it.frameWidth + ' × ' + it.qty + ' @ ' + fmtMoney(it.rate));
      html += '<div class="bill-item">' +
        '<div class="tag ' + it.type + '">' + (it.type === 'flex' ? 'FLX' : 'FRM') + '</div>' +
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
    $('prefsSavedNote').textContent = '';
  }
  $('btnSavePrefs').addEventListener('click', function () {
    var currency = $('settingCurrency').value.trim() || '₹';
    var rate = parseFloat($('settingRate').value);
    var min = parseFloat($('settingMin').value);
    var max = parseFloat($('settingMax').value);
    if (isNaN(rate) || rate <= 0 || isNaN(min) || min <= 0 || isNaN(max) || max <= min) {
      $('prefsSavedNote').style.color = 'var(--danger)';
      $('prefsSavedNote').textContent = 'Please enter valid values.';
      return;
    }
    settings = { currency: currency, rate: rate, minSize: min, maxSize: max };
    saveJSON(LS.settings, settings);
    elRate.value = settings.rate;
    $('currPrefix1').textContent = settings.currency;
    $('currPrefix2').textContent = settings.currency;
    updateFormula(); populateFrameWidths(); updateFramePrice(); renderBillList();
    $('prefsSavedNote').style.color = 'var(--green-dark)';
    $('prefsSavedNote').textContent = 'Saved!';
  });

  /* =========================================================
     Data: export / import / reset
  ========================================================= */
  $('btnExportData').addEventListener('click', function () {
    var backup = { settings: settings, companies: companies, activeCompanyId: activeCompanyId, customers: customers, exportedAt: new Date().toISOString() };
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
        saveJSON(LS.settings, settings); saveJSON(LS.companies, companies);
        saveJSON(LS.activeCompany, activeCompanyId); saveJSON(LS.customers, customers);
        applyActiveCompanyToHeader(); renderCompanyList(); renderCustomerListUI(); renderCustomerDatalist(); fillPrefsForm();
        elRate.value = settings.rate; updateFormula();
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
  function buildInvoiceHTML() {
    var company = getActiveCompany();
    var invNo = nextInvoiceNumber();
    var dateStr = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    var total = items.reduce(function (s, it) { return s + it.amount; }, 0);

    var rows = items.map(function (it) {
      return '<tr>' +
        '<td>' + (it.type === 'flex' ? 'Flex' : 'Frame') + '</td>' +
        '<td>' + esc(it.desc) + '</td>' +
        '<td>' + esc(it.size) + '</td>' +
        '<td>' + esc(it.frameWidth || '—') + '</td>' +
        '<td class="num">' + fmtNum(it.qty || 1) + '</td>' +
        '<td class="num">' + fmtMoney(it.rate) + '</td>' +
        '<td class="num">' + fmtMoney(it.amount) + '</td>' +
        '</tr>';
    }).join('');

    var custName = elCustName.value.trim();
    var custBlock = custName
      ? '<div><b>' + esc(custName) + '</b>' + (elCustPhone.value.trim() ? '<div>' + esc(elCustPhone.value.trim()) + '</div>' : '') + (elCustAddress.value.trim() ? '<div>' + esc(elCustAddress.value.trim()) + '</div>' : '') + '</div>'
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
    upsertCustomerFromBillForm();
    $('invoiceArea').innerHTML = buildInvoiceHTML();
    $('invoiceOverlay').classList.add('open');
  }
  $('btnPreviewInvoice').addEventListener('click', previewInvoice);
  $('btnCloseInvoice').addEventListener('click', function () { $('invoiceOverlay').classList.remove('open'); });
  $('btnPrint').addEventListener('click', function () { window.print(); });
  $('btnDownloadPdf').addEventListener('click', downloadInvoicePdf);

  function downloadInvoicePdf() {
    var btn = $('btnDownloadPdf'), label = $('btnDownloadPdfLabel');
    var originalLabel = label.textContent;

    // Graceful fallback if the CDN libraries didn't load (e.g. offline use).
    if (!window.html2canvas || !window.jspdf) {
      window.print();
      return;
    }

    btn.disabled = true;
    label.textContent = 'Generating…';

    var area = $('invoiceArea');
    window.html2canvas(area, { scale: 2, backgroundColor: '#ffffff', useCORS: true })
      .then(function (canvas) {
        var jsPDF = window.jspdf.jsPDF;
        var pdf = new jsPDF({ unit: 'pt', format: 'a4' });
        var pageWidth = pdf.internal.pageSize.getWidth();
        var pageHeight = pdf.internal.pageSize.getHeight();
        var imgWidth = pageWidth;
        var imgHeight = (canvas.height * imgWidth) / canvas.width;
        var imgData = canvas.toDataURL('image/png');

        var heightLeft = imgHeight;
        var position = 0;
        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
        while (heightLeft > 0) {
          position = heightLeft - imgHeight;
          pdf.addPage();
          pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
          heightLeft -= pageHeight;
        }

        var company = getActiveCompany();
        var fileName = ((company.name || 'SKFlex') + '-Invoice-' + (currentInvoiceNo || Date.now()))
          .replace(/[^a-z0-9\-]+/gi, '_');
        pdf.save(fileName + '.pdf');
      })
      .catch(function (err) {
        console.error('PDF generation failed, falling back to print dialog.', err);
        window.print();
      })
      .finally(function () {
        btn.disabled = false;
        label.textContent = originalLabel;
      });
  }
  $('btnShare').addEventListener('click', function () {
    var company = getActiveCompany();
    var total = items.reduce(function (s, it) { return s + it.amount; }, 0);
    var lines = items.map(function (it) { return '• ' + it.desc + (it.frameWidth ? ' (' + it.frameWidth + ')' : '') + ' x' + (it.qty || 1) + ' — ' + fmtMoney(it.amount); });
    var text = (company.name || 'SK Flex') + ' — Invoice ' + (currentInvoiceNo || '') + '\n' +
      lines.join('\n') + '\n\nGrand Total: ' + fmtMoney(total) + '\nThank you for your business!';
    if (navigator.share) {
      navigator.share({ title: 'Invoice — ' + (company.name || 'SK Flex'), text: text }).catch(function () {});
    } else {
      window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
    }
  });
  $('invoiceOverlay').addEventListener('click', function (e) { if (e.target === $('invoiceOverlay')) $('invoiceOverlay').classList.remove('open'); });

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
