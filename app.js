// ============================================================================
// نظام إدارة العُهد النقدية اليومية وحركة السائقين والستاف (Petty Cash - QAR)
// واجهة مبسطة ومريحة لكبار السن مع الاحتفاظ بجميع المميزات المتقدمة
// ============================================================================

const OLD_STORAGE_KEY = 'petty_cash_manager_v1';
const STORAGE_KEY = 'petty_cash_clean_v2';

const ARABIC_MONTHS = [
  '',
  'يناير', 'فبراير', 'مارس', 'إبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
];

const ARABIC_DAYS = [
  'الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'
];

function createCleanData() {
  return {
    schemaVersion: 5,
    people: [],        // { id, num, name, role: 'driver'|'staff', meta: 'رقم السيارة / القسم', archived: boolean, archivedAt: string|null }
    dailyReceipts: {}, // { "YYYY-MM-DD": number }
    dailyExtras: {},   // { "YYYY-MM-DD": { amount: number, note: string, excludeFromCompany: boolean } }
    entries: {},       // { "YYYY-MM-DD": { [personId]: { cash: number, invoice: number, returnedCash: number, note: string } } }
    custodyReceipts: [], // [ { id, date, amount, ref, note } ] (دفعات العهدة المستلمة من الشركة)
    custodySettlements: [], // [ { id, date, amount, period, periodKey, ref, note, settlementType, status } ] (كشوف الفواتير والتسويات المسلمة للشركة)
    safeInvoices: [], // [ { id, date, amount, periodKey, ref, note, settlementType, status, reversedAt, reversalReason } ] (فواتير مسلمة للخزنة لتسوية السحوبات)
    safeInvoicesAudit: [],
    tankerDeliveries: [], // [ { id, date, project, liters, pricePerLiter, amount, invoiceNo, receiver, supplier, notes, createdAt } ]
    projectsList: ['مشروع لوسيل', 'موقع الدوحة الجديدة', 'مشروع الخور', 'مشروع الوكرة', 'مشروع الريان'] // [ { action, invoice, timestamp, reason } ] (سجل التدقيق التاريخي للعمليات المحذوفة والمعكوسة)
  };
}

function create60BlankSlots() {
  const people = [];
  for (let i = 1; i <= 60; i++) {
    people.push({
      id: 'p_' + Date.now() + '_' + i,
      num: i,
      name: '',
      role: i <= 25 ? 'driver' : 'staff',
      meta: '',
      nameEn: '',
      archived: false,
      archivedAt: null
    });
  }
  return people;
}

const now = new Date();
const initY = now.getFullYear();
const initM = now.getMonth() + 1;
const initD = now.getDate();
const initDateKey = `${initY}-${String(initM).padStart(2, '0')}-${String(initD).padStart(2, '0')}`;

const state = {
  year: initY,
  month: initM,
  selectedDate: initDateKey,
  activeTab: 'daily',
  dailyCategoryFilter: 'all',
  dailySearch: '',
  showDetailedCols: false, // Simple view by default for 64-year-old customer
  fontXL: false,
  eyeComfort: false,
  theme: 'light', // 'light' | 'dark' (الوضع الليلي لكبار السن)
  monthlySearch: '',
  hideFridaysInMonthly: true,
  showOnlyActiveInMonthly: false,
  monthlyViewMode: 'cash',
  selectedPersonId: null,
  personSidebarFilter: 'all',
  personSidebarSearch: '',
  personSelectedMonth: 'current', // 'current' | 'all' | 1..12 (طلب الوالد)
  ledgerScope: 'month',
  annualFromMonth: 1,
  annualToMonth: 12,
  annualDataType: 'cash',
  peopleManageFilter: 'all',
  peopleManageSearch: '',
  editingCustodyReceiptId: null,
  editingCustodySettlementId: null,
  editingSafeInvoiceId: null,
  safeMonth: initM,
  safeShowYear: false,
  dispatchLang: 'ar',
  dispatchRoleFilter: 'all',
  tankerLang: 'ar',
  tankerSearch: '',
  tankerProjectFilter: 'all',
  tankerPeriodFilter: 'all',
  editingTankerDeliveryId: null,
  data: createCleanData()
};

if (typeof window !== 'undefined') {
  window.state = state;
}
if (typeof globalThis !== 'undefined') {
  globalThis.state = state;
}

// In-Memory Undo Stack (Last 10 Actions) & Backup Tracking
const undoStack = [];
const MAX_UNDO = 10;
let lastSavedDataJson = null;

// ============================================================================
// Initialization & Persistence
// ============================================================================

function loadState() {
  try {
    localStorage.removeItem(OLD_STORAGE_KEY);
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.people)) {
        const defaultProjects = ['مشروع لوسيل', 'موقع الدوحة الجديدة', 'مشروع الخور', 'مشروع الوكرة', 'مشروع الريان'];
        const loadedProjects = Array.isArray(parsed.projectsList) && parsed.projectsList.length > 0
          ? parsed.projectsList
          : defaultProjects;
        const projectSet = new Set([...defaultProjects, ...loadedProjects]);
        const loadedDeliveries = Array.isArray(parsed.tankerDeliveries) ? parsed.tankerDeliveries : [];
        loadedDeliveries.forEach(d => {
          if (d && d.project && typeof d.project === 'string' && d.project.trim()) {
            projectSet.add(d.project.trim());
          }
        });

        let finalDeliveries = loadedDeliveries;
        let finalProjects = Array.from(projectSet);

        // Emergency backup recovery if empty
        if (typeof localStorage !== 'undefined') {
          if (finalDeliveries.length === 0) {
            try {
              const bk = localStorage.getItem('petty_cash_tanker_deliveries_backup');
              if (bk) {
                const pbk = JSON.parse(bk);
                if (Array.isArray(pbk) && pbk.length > 0) finalDeliveries = pbk;
              }
            } catch (e) {}
          }
          try {
            const pbkProjects = localStorage.getItem('petty_cash_projects_backup');
            if (pbkProjects) {
              const prjListBk = JSON.parse(pbkProjects);
              if (Array.isArray(prjListBk) && prjListBk.length > 0) {
                prjListBk.forEach(p => projectSet.add(p));
                finalProjects = Array.from(projectSet);
              }
            }
          } catch (e) {}
        }

        state.data = {
          people: parsed.people.map((p, idx) => ({
            id: String(p.id || ('p_' + idx)),
            num: Number(p.num) || (idx + 1),
            name: p.name || '',
            role: (p.role === 'staff') ? 'staff' : 'driver',
            meta: p.meta || '',
            nameEn: p.nameEn || '',
            archived: !!p.archived,
            archivedAt: p.archivedAt || null
          })),
          dailyReceipts: parsed.dailyReceipts || {},
          dailyExtras: parsed.dailyExtras || {},
          entries: parsed.entries || {},
          custodyReceipts: Array.isArray(parsed.custodyReceipts) ? parsed.custodyReceipts : [],
          custodySettlements: Array.isArray(parsed.custodySettlements) ? parsed.custodySettlements : [],
          safeInvoices: Array.isArray(parsed.safeInvoices) ? parsed.safeInvoices : [],
          safeInvoicesAudit: Array.isArray(parsed.safeInvoicesAudit) ? parsed.safeInvoicesAudit : [],
          tankerDeliveries: finalDeliveries,
          projectsList: finalProjects
        };
      }
    }
  } catch (err) {
    console.error('Failed to load state:', err);
  }
  if (!state.data || !Array.isArray(state.data.people)) {
    state.data = createCleanData();
    saveState(true);
  }

  lastSavedDataJson = JSON.stringify(state.data);

  try {
    // Theme loading
    const savedTheme = localStorage.getItem('petty_cash_theme') || 'light';
    state.theme = savedTheme;
    if (state.theme === 'dark') {
      document.body.classList.add('dark-mode');
    }

    // Eye comfort preference (only if not dark mode)
    state.eyeComfort = localStorage.getItem('petty_cash_eye_comfort') === 'true';
    if (state.eyeComfort && state.theme !== 'dark') {
      document.body.classList.add('eye-comfort');
    }
  } catch (e) {}

  checkBackupReminder();
}

function saveState(skipUndo = false) {
  try {
    const currentJson = JSON.stringify(state.data);
    if (!skipUndo && lastSavedDataJson && lastSavedDataJson !== currentJson) {
      undoStack.push(lastSavedDataJson);
      if (undoStack.length > MAX_UNDO) {
        undoStack.shift();
      }
      updateUndoButtonState();
    }
    lastSavedDataJson = currentJson;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, currentJson);
      localStorage.setItem('petty_cash_last_modified', Date.now().toString());

      // Dual-layer emergency backup for Tanker & Projects
      if (state.data && Array.isArray(state.data.tankerDeliveries)) {
        localStorage.setItem('petty_cash_tanker_deliveries_backup', JSON.stringify(state.data.tankerDeliveries));
      }
      if (state.data && Array.isArray(state.data.projectsList)) {
        localStorage.setItem('petty_cash_projects_backup', JSON.stringify(state.data.projectsList));
      }
    }
    checkBackupReminder();
  } catch (err) {
    console.error('Failed to save state:', err);
    if (err && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
      alert('⚠️ تحذير: ذاكرة المتصفح ممتلئة ولا يمكن حفظ التعديل الأخير! يرجى الضغط على زر "نسخة احتياطية" من أعلى الصفحة وتنزيل ملف الحفظ فوراً.');
    }
  }
}

function performUndo() {
  if (undoStack.length === 0) {
    showToast('لا توجد خطوات سابقة للتراجع عنها');
    return;
  }
  const prevJson = undoStack.pop();
  try {
    state.data = JSON.parse(prevJson);
    saveState(true);
    renderAll();
    showToast('تم التراجع عن آخر تعديل بنجاح ↩️');
  } catch (err) {
    console.error('Failed to undo:', err);
  }
  updateUndoButtonState();
}

function updateUndoButtonState() {
  if (typeof document === 'undefined') return;
  const btn = document.getElementById('btnUndo');
  if (btn) {
    const canUndo = undoStack.length > 0;
    btn.disabled = !canUndo;
    btn.classList.toggle('disabled-btn', !canUndo);
  }
}

function checkBackupReminder() {
  if (typeof document === 'undefined') return;
  const lastBackupStr = typeof localStorage !== 'undefined' ? localStorage.getItem('petty_cash_last_backup_download') : null;
  const reminderBanner = document.getElementById('backupReminderBanner');
  const backupBtn = document.getElementById('btnBackupModal');
  if (!reminderBanner) return;

  const now = Date.now();
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const lastTime = lastBackupStr ? parseInt(lastBackupStr, 10) : 0;

  const hasAnyData = (state.data.people && state.data.people.some(p => p.name)) ||
                     Object.keys(state.data.entries || {}).length > 0 ||
                     (state.data.custodyReceipts && state.data.custodyReceipts.length > 0);

  if (hasAnyData && (now - lastTime > SEVEN_DAYS_MS)) {
    reminderBanner.classList.remove('hidden');
    if (backupBtn) backupBtn.classList.add('has-backup-reminder');
  } else {
    reminderBanner.classList.add('hidden');
    if (backupBtn) backupBtn.classList.remove('has-backup-reminder');
  }
}

// ============================================================================
// Financial Arithmetic Engine (Integer Minor Units - Qatari Dirhams / Cents)
// Prevents floating-point accumulation errors (e.g. 1,000 x 0.01 = 10.00 exactly)
// ============================================================================

function toCents(val) {
  if (val === null || val === undefined || val === '') return 0;
  const num = typeof val === 'number' ? val : parseFloat(String(val).replace(/,/g, '').trim());
  if (isNaN(num) || !isFinite(num)) return 0;
  return Math.round(num * 100);
}

function fromCents(cents) {
  if (isNaN(cents) || !isFinite(cents)) return 0;
  return Number((cents / 100).toFixed(2));
}

function addMoney(a, b) {
  return fromCents(toCents(a) + toCents(b));
}

function subMoney(a, b) {
  return fromCents(toCents(a) - toCents(b));
}

function mulMoney(val, factor) {
  return fromCents(Math.round(toCents(val) * factor));
}

function sumMoney(items, extractor) {
  let centsSum = 0;
  if (Array.isArray(items)) {
    for (let i = 0; i < items.length; i++) {
      const val = extractor ? extractor(items[i]) : items[i];
      centsSum += toCents(val);
    }
  }
  return fromCents(centsSum);
}

function validateMonetaryInput(val, allowNegative = false) {
  if (val === null || val === undefined || val === '') return { valid: false, value: 0 };
  const num = typeof val === 'number' ? val : parseFloat(String(val).replace(/,/g, '').trim());
  if (isNaN(num) || !isFinite(num)) return { valid: false, value: 0 };
  if (!allowNegative && num < 0) return { valid: false, value: 0 };
  if (num > 1000000000) return { valid: false, value: 0 }; // 1 billion limit
  return { valid: true, value: fromCents(Math.round(num * 100)) };
}

function formatNumber(val, forceTwoDecimals = false) {
  const cents = toCents(val);
  const num = fromCents(cents);
  const isNeg = num < 0;
  const absNum = Math.abs(num);
  const hasCents = (Math.abs(cents) % 100) !== 0;
  const opts = (forceTwoDecimals || hasCents)
    ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
    : { minimumFractionDigits: 0, maximumFractionDigits: 2 };
  const formatted = absNum.toLocaleString('en-US', opts);
  return isNeg ? ('\u200E-' + formatted) : formatted;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeArabic(str) {
  if (!str) return '';
  return String(str)
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '') // remove Arabic tashkeel
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي');
}

function matchArabicSearch(text, query) {
  if (!query) return true;
  const nText = normalizeArabic(text);
  const nQuery = normalizeArabic(query);
  return nText.includes(nQuery) || nText.replace(/\s+/g, '').includes(nQuery.replace(/\s+/g, ''));
}

function formatCsvCell(cell) {
  if (cell === null || cell === undefined) return '""';
  if (typeof cell === 'number') return String(cell);
  let str = String(cell);
  // CSV Formula Injection mitigation (CWE-1236): Prepend single quote if string starts with formula triggers
  if (/^[\=\+\-\@\t\r]/.test(str)) {
    str = "'" + str;
  }
  return `"${str.replace(/"/g, '""')}"`;
}

function parseDateParts(dateStr) {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
  }
  const [y, m, d] = dateStr.split('-').map(Number);
  return { y, m, d };
}

function formatDateKey(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function getDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function getDayOfWeekIndex(year, month, day) {
  return new Date(year, month - 1, day).getDay(); // 5 = Friday
}

function getArabicDayName(year, month, day) {
  return ARABIC_DAYS[getDayOfWeekIndex(year, month, day)];
}

function isFridayDate(dateStr) {
  const { y, m, d } = parseDateParts(dateStr);
  return getDayOfWeekIndex(y, m, d) === 5;
}

function getPersonDisplayName(person) {
  if (!person) return '';
  return person.name && person.name.trim() ? person.name.trim() : `شخص رقم ${person.num}`;
}

let activeToastTimer = null;
function showToast(msg) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  container.innerHTML = '';
  if (activeToastTimer) {
    clearTimeout(activeToastTimer);
  }
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  container.appendChild(el);
  activeToastTimer = setTimeout(() => {
    el.remove();
    activeToastTimer = null;
  }, 2600);
}

function hasPersonAnyEntryInYear(personId, year) {
  const prefix = `${year}-`;
  for (const [dateKey, dayObj] of Object.entries(state.data.entries || {})) {
    if (dateKey.startsWith(prefix) && dayObj && dayObj[personId]) {
      const e = dayObj[personId];
      if ((toCents(e.cash) > 0) || (toCents(e.invoice) > 0) || (toCents(e.returnedCash) > 0) || (e.note && e.note.trim() !== '')) {
        return true;
      }
    }
  }
  return false;
}

function hasPersonAnyEntryInHistory(personId) {
  for (const dayObj of Object.values(state.data.entries || {})) {
    if (dayObj && dayObj[personId]) {
      const e = dayObj[personId];
      if ((toCents(e.cash) > 0) || (toCents(e.invoice) > 0) || (toCents(e.returnedCash) > 0) || (e.note && e.note.trim() !== '')) {
        return true;
      }
    }
  }
  return false;
}

function getReportablePeople(year) {
  const all = state.data.people || [];
  // Active people who have names, OR archived people who had transactions in this year
  const list = all.filter(p => {
    const hasDataThisYear = hasPersonAnyEntryInYear(p.id, year);
    if (p.archived) {
      return hasDataThisYear;
    }
    return (p.name && p.name.trim() !== '') || hasDataThisYear;
  });
  return list.length > 0 ? list : all.filter(p => !p.archived);
}

function archivePerson(personId) {
  const p = (state.data.people || []).find(item => item.id === personId);
  if (!p) return false;
  p.archived = true;
  p.archivedAt = new Date().toISOString();
  saveState();
  renderAll();
  return true;
}

function unarchivePerson(personId) {
  const p = (state.data.people || []).find(item => item.id === personId);
  if (!p) return false;
  p.archived = false;
  p.archivedAt = null;
  saveState();
  renderAll();
  return true;
}

function deleteSafeInvoice(invoiceId, reason = 'حذف يدوي بواسطة المستخدم') {
  const existingItem = (state.data.safeInvoices || []).find(x => x.id === invoiceId);
  if (existingItem) {
    state.data.safeInvoicesAudit = state.data.safeInvoicesAudit || [];
    state.data.safeInvoicesAudit.push({
      action: 'deleted',
      invoiceId: existingItem.id,
      amount: existingItem.amount,
      periodKey: existingItem.periodKey,
      ref: existingItem.ref,
      invoice: { ...existingItem },
      timestamp: new Date().toISOString(),
      reason
    });
  }
  state.data.safeInvoices = (state.data.safeInvoices || []).filter(x => x.id !== invoiceId);
  if (state.editingSafeInvoiceId === invoiceId) {
    state.editingSafeInvoiceId = null;
    if (typeof document !== 'undefined') {
      const btnAdd = document.getElementById('btnAddSafeInvoice');
      if (btnAdd) {
        btnAdd.textContent = '📑 حفظ الفاتورة المسلّمة للخزنة';
        btnAdd.className = 'btn btn-primary';
      }
      const btnCancel = document.getElementById('btnCancelEditSafeInvoice');
      if (btnCancel) btnCancel.classList.add('hidden');
    }
  }
  saveState();
  if (typeof document !== 'undefined') {
    renderSafeTab();
  }
  return true;
}

function reverseSafeInvoice(invoiceId, reason = 'إلغاء وعكس فاتورة الخزنة') {
  const inv = (state.data.safeInvoices || []).find(x => x.id === invoiceId);
  if (!inv) return false;
  inv.status = 'reversed';
  inv.reversedAt = new Date().toISOString();
  inv.reversalReason = reason;
  state.data.safeInvoicesAudit = state.data.safeInvoicesAudit || [];
  state.data.safeInvoicesAudit.push({
    action: 'reversed',
    invoiceId: inv.id,
    amount: inv.amount,
    periodKey: inv.periodKey,
    ref: inv.ref,
    timestamp: inv.reversedAt,
    reason: inv.reversalReason
  });
  if (state.editingSafeInvoiceId === invoiceId) {
    state.editingSafeInvoiceId = null;
  }
  saveState();
  if (typeof document !== 'undefined') {
    renderSafeTab();
  }
  return true;
}

function rollbackPreRestore() {
  if (typeof localStorage === 'undefined') {
    throw new Error('localStorage غير متاح');
  }
  const snapRaw = localStorage.getItem('petty_cash_pre_restore_snapshot');
  if (!snapRaw) {
    throw new Error('لا توجد نقطة تراجع محفوظة');
  }
  const snap = JSON.parse(snapRaw);
  state.data = snap.data;
  saveState();
  if (typeof document !== 'undefined') {
    renderAll();
  }
  return true;
}

// ============================================================================
// Data Access & Calculation Helpers
// ============================================================================

function getDayReceived(dateStr) {
  return fromCents(toCents(state.data.dailyReceipts[dateStr]));
}

function setDayReceived(dateStr, amount) {
  const v = validateMonetaryInput(amount);
  if (!v.valid || v.value <= 0) {
    delete state.data.dailyReceipts[dateStr];
  } else {
    state.data.dailyReceipts[dateStr] = v.value;
  }
  saveState();
}

function getDayExtra(dateStr) {
  const ex = state.data.dailyExtras && state.data.dailyExtras[dateStr];
  if (!ex) return { amount: 0, note: '', excludeFromCompany: false };
  return {
    amount: fromCents(toCents(ex.amount)),
    note: ex.note || '',
    excludeFromCompany: !!ex.excludeFromCompany
  };
}

function setDayExtra(dateStr, updates) {
  if (!state.data.dailyExtras) state.data.dailyExtras = {};
  const cur = getDayExtra(dateStr);
  const vAmt = updates.amount !== undefined ? validateMonetaryInput(updates.amount) : { valid: true, value: cur.amount };
  const next = {
    amount: vAmt.valid ? vAmt.value : cur.amount,
    note: updates.note !== undefined ? String(updates.note) : cur.note,
    excludeFromCompany: updates.excludeFromCompany !== undefined ? !!updates.excludeFromCompany : cur.excludeFromCompany
  };
  if (next.amount <= 0 && !next.note.trim()) {
    delete state.data.dailyExtras[dateStr];
  } else {
    state.data.dailyExtras[dateStr] = next;
  }
  saveState();
}

function getPersonEntry(dateStr, personId) {
  const dayObj = state.data.entries[dateStr];
  if (!dayObj || !dayObj[personId]) {
    return { cash: 0, invoice: 0, returnedCash: 0, note: '' };
  }
  return {
    cash: fromCents(toCents(dayObj[personId].cash)),
    invoice: fromCents(toCents(dayObj[personId].invoice)),
    returnedCash: fromCents(toCents(dayObj[personId].returnedCash)),
    note: dayObj[personId].note || ''
  };
}

function setPersonEntry(dateStr, personId, updates) {
  if (!state.data.entries[dateStr]) {
    state.data.entries[dateStr] = {};
  }
  const current = getPersonEntry(dateStr, personId);
  const next = {
    cash: updates.cash !== undefined ? (validateMonetaryInput(updates.cash).value) : current.cash,
    invoice: updates.invoice !== undefined ? (validateMonetaryInput(updates.invoice).value) : current.invoice,
    returnedCash: updates.returnedCash !== undefined ? (validateMonetaryInput(updates.returnedCash).value) : current.returnedCash,
    note: updates.note !== undefined ? String(updates.note) : current.note
  };

  if (next.cash === 0 && next.invoice === 0 && next.returnedCash === 0 && !next.note.trim()) {
    delete state.data.entries[dateStr][personId];
    if (Object.keys(state.data.entries[dateStr]).length === 0) {
      delete state.data.entries[dateStr];
    }
  } else {
    state.data.entries[dateStr][personId] = next;
  }
  saveState();
}

function getLastPreviousReceipt(personId, beforeDateStr) {
  const allDates = Object.keys(state.data.entries).filter(d => d < beforeDateStr).sort();
  for (let i = allDates.length - 1; i >= 0; i--) {
    const dKey = allDates[i];
    const entry = state.data.entries[dKey] && state.data.entries[dKey][personId];
    if (entry && toCents(entry.cash) > 0) {
      const { m, d } = parseDateParts(dKey);
      return {
        dateKey: dKey,
        d,
        m,
        cash: fromCents(toCents(entry.cash))
      };
    }
  }
  return null;
}

function getDayTotals(dateStr) {
  const received = getDayReceived(dateStr);
  const extra = getDayExtra(dateStr);
  const dayEntries = state.data.entries[dateStr] || {};
  let distCents = 0;
  let drvCents = 0;
  let stfCents = 0;
  let invCents = 0;
  let retCents = 0;
  let activeCashCount = 0;
  let activeInvoiceCount = 0;

  Object.entries(dayEntries).forEach(([pid, entry]) => {
    const c = toCents(entry.cash);
    const inv = toCents(entry.invoice);
    const ret = toCents(entry.returnedCash);
    const person = state.data.people.find(p => p.id === pid);
    if (c > 0) {
      distCents += c;
      activeCashCount++;
      if (person && person.role === 'staff') {
        stfCents += c;
      } else {
        drvCents += c;
      }
    }
    if (inv > 0) {
      invCents += inv;
      activeInvoiceCount++;
    }
    if (ret > 0) {
      retCents += ret;
    }
  });

  const distributed = fromCents(distCents);
  const totalOut = addMoney(distributed, extra.amount);
  const returnedCashTotal = fromCents(retCents);
  const remaining = subMoney(addMoney(received, returnedCashTotal), totalOut);

  return {
    received,
    distributed,
    driversDistributed: fromCents(drvCents),
    staffDistributed: fromCents(stfCents),
    extraAmount: extra.amount,
    extraNote: extra.note,
    excludeFromCompany: extra.excludeFromCompany,
    totalOut,
    returnedCashTotal,
    remaining,
    invoices: fromCents(invCents),
    activeCashCount,
    activeInvoiceCount
  };
}

function getPersonMonthTotals(personId, year, month) {
  const daysCount = getDaysInMonth(year, month);
  let cashCents = 0;
  let invoiceCents = 0;
  let returnedCashCents = 0;
  for (let d = 1; d <= daysCount; d++) {
    const dateKey = formatDateKey(year, month, d);
    const entry = getPersonEntry(dateKey, personId);
    cashCents += toCents(entry.cash);
    invoiceCents += toCents(entry.invoice);
    returnedCashCents += toCents(entry.returnedCash);
  }
  const cash = fromCents(cashCents);
  const invoice = fromCents(invoiceCents);
  const returnedCash = fromCents(returnedCashCents);
  const diff = fromCents(cashCents - (invoiceCents + returnedCashCents));
  return { cash, invoice, returnedCash, diff };
}

function getPersonYearTotals(personId, year) {
  let cashCents = 0;
  let invoiceCents = 0;
  let returnedCashCents = 0;
  for (let m = 1; m <= 12; m++) {
    const mt = getPersonMonthTotals(personId, year, m);
    cashCents += toCents(mt.cash);
    invoiceCents += toCents(mt.invoice);
    returnedCashCents += toCents(mt.returnedCash);
  }
  const cash = fromCents(cashCents);
  const invoice = fromCents(invoiceCents);
  const returnedCash = fromCents(returnedCashCents);
  const diff = fromCents(cashCents - (invoiceCents + returnedCashCents));
  return { cash, invoice, returnedCash, diff };
}

function getPersonBalanceBeforeDate(personId, beforeDateStr) {
  let balCents = 0;
  const allDates = Object.keys(state.data.entries || {}).filter(d => d < beforeDateStr).sort();
  for (const dk of allDates) {
    const dayObj = state.data.entries[dk];
    if (dayObj && dayObj[personId]) {
      const e = dayObj[personId];
      const c = toCents(e.cash);
      const inv = toCents(e.invoice);
      const ret = toCents(e.returnedCash);
      balCents += (c - (inv + ret));
    }
  }
  return fromCents(balCents);
}

function getCustodyReceiptsForMonth(year, month) {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  return (state.data.custodyReceipts || []).filter(r => r && r.date && r.date.startsWith(prefix));
}

function getCustodyReceiptsForYear(year) {
  const prefix = `${year}-`;
  return (state.data.custodyReceipts || []).filter(r => r && r.date && r.date.startsWith(prefix));
}

function getCustodySettlementsForMonth(year, month) {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  return (state.data.custodySettlements || []).filter(r => r && r.date && r.date.startsWith(prefix));
}

function getCustodySettlementsForYear(year) {
  const prefix = `${year}-`;
  return (state.data.custodySettlements || []).filter(r => r && r.date && r.date.startsWith(prefix));
}

function getSafeInvoicesForMonth(year, month) {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  return (state.data.safeInvoices || []).filter(r => r && r.status !== 'reversed' && r.date && r.date.startsWith(prefix));
}

function getSafeInvoicesForYear(year) {
  const prefix = `${year}-`;
  return (state.data.safeInvoices || []).filter(r => r && r.status !== 'reversed' && r.date && r.date.startsWith(prefix));
}

function calculateMonthDriverInvoices(year, month, filterRole = 'all') {
  const daysInM = getDaysInMonth(year, month);
  let totalCents = 0;
  for (let d = 1; d <= daysInM; d++) {
    const dk = formatDateKey(year, month, d);
    const dayEntries = state.data.entries[dk] || {};
    for (const p of state.data.people) {
      if (filterRole === 'driver' && p.role !== 'driver') continue;
      if (filterRole === 'staff' && p.role !== 'staff') continue;
      const e = dayEntries[p.id];
      if (e && e.invoice) {
        totalCents += toCents(e.invoice);
      }
    }
    if (filterRole !== 'driver') {
      const extra = state.data.dailyExtras[dk];
      if (extra && extra.amount && !extra.excludeFromCompany) {
        totalCents += toCents(extra.amount);
      }
    }
  }
  return fromCents(totalCents);
}

function getPeriodSettlementSummary(year, month, type = 'safe', filterRole = 'driver') {
  const periodKey = `${year}-${String(month).padStart(2, '0')}`;
  const settlements = type === 'safe'
    ? (state.data.safeInvoices || []).filter(inv => {
        if (!inv || inv.status === 'reversed') return false;
        if (inv.periodKey) return inv.periodKey === periodKey;
        return (inv.date && inv.date.startsWith(periodKey)) ||
               (inv.ref && inv.ref.includes(periodKey)) ||
               (inv.note && inv.note.includes(periodKey));
      })
    : (state.data.custodySettlements || []).filter(s => {
        if (!s || s.status === 'reversed') return false;
        if (s.periodKey) return s.periodKey === periodKey;
        return (s.date && s.date.startsWith(periodKey)) ||
               (s.period && s.period.includes(periodKey)) ||
               (s.ref && s.ref.includes(periodKey));
      });

  let settledCents = 0;
  settlements.forEach(s => {
    settledCents += toCents(s.amount);
  });
  const totalSettled = fromCents(settledCents);
  const currentDriverInvoices = calculateMonthDriverInvoices(year, month, filterRole);
  const unSettledDiff = subMoney(currentDriverInvoices, totalSettled);

  return {
    periodKey,
    periodName: `شهر ${ARABIC_MONTHS[month]} ${year}`,
    settlements,
    totalSettled,
    currentDriverInvoices,
    unSettledDiff,
    isFullySettled: unSettledDiff <= 0 && totalSettled > 0,
    hasPartialSettlement: totalSettled > 0 && unSettledDiff > 0
  };
}

function getSettlementBadgeHtml(cash, invoice, returnedCash = 0) {
  const c = toCents(cash);
  const inv = toCents(invoice);
  const ret = toCents(returnedCash);
  if (c === 0 && inv === 0 && ret === 0) {
    return `<span class="settlement-badge idle">لا توجد حركة</span>`;
  }
  const settledTotalCents = inv + ret;
  const diffCents = c - settledTotalCents;
  if (diffCents === 0) {
    if (ret > 0 && inv > 0) {
      return `<span class="settlement-badge settled" title="فواتير: ${formatNumber(fromCents(inv))} + مرتجع: ${formatNumber(fromCents(ret))}">خالص ومصفى بالكامل ✓</span>`;
    } else if (ret > 0) {
      return `<span class="settlement-badge settled" title="مرتجع كاش بالكامل: ${formatNumber(fromCents(ret))}">خالص ومرتجع كاش ✓</span>`;
    }
    return `<span class="settlement-badge settled">خالص بالفواتير ✓</span>`;
  } else if (diffCents > 0) {
    return `<span class="settlement-badge owes">متبقي بذمته: ${formatNumber(fromCents(diffCents))}</span>`;
  } else {
    return `<span class="settlement-badge credit">له فرق مستحق: ${formatNumber(fromCents(Math.abs(diffCents)))}</span>`;
  }
}

function renumberPeople() {
  state.data.people.forEach((p, idx) => {
    p.num = idx + 1;
  });
}

// ============================================================================
// UI Rendering: Header & Period Controls
// ============================================================================

function initYearMonthSelectors() {
  const yearSelect = document.getElementById('globalYear');
  const monthSelect = document.getElementById('globalMonth');

  yearSelect.innerHTML = '';
  const currentY = new Date().getFullYear();
  for (let y = currentY - 2; y <= currentY + 4; y++) {
    const opt = document.createElement('option');
    opt.value = String(y);
    opt.textContent = String(y);
    if (y === state.year) opt.selected = true;
    yearSelect.appendChild(opt);
  }

  monthSelect.value = String(state.month);

  yearSelect.addEventListener('change', () => {
    state.year = Number(yearSelect.value);
    const n = new Date();
    if (state.year === n.getFullYear() && state.month === (n.getMonth() + 1)) {
      state.selectedDate = formatDateKey(state.year, state.month, n.getDate());
    } else {
      syncSelectedDateToMonth();
    }
    renderAll();
  });

  monthSelect.addEventListener('change', () => {
    state.month = Number(monthSelect.value);
    const n = new Date();
    if (state.year === n.getFullYear() && state.month === (n.getMonth() + 1)) {
      state.selectedDate = formatDateKey(state.year, state.month, n.getDate());
    } else {
      syncSelectedDateToMonth();
    }
    renderAll();
  });
}

function syncSelectedDateToMonth() {
  let d = 1;
  if (getDayOfWeekIndex(state.year, state.month, d) === 5) {
    d = 2;
  }
  state.selectedDate = formatDateKey(state.year, state.month, d);
}

function updateMonthLabels() {
  const label = `${ARABIC_MONTHS[state.month]} ${state.year}`;
  document.querySelectorAll('.current-month-label').forEach(el => {
    el.textContent = label;
  });
  document.querySelectorAll('.current-year-label').forEach(el => {
    el.textContent = String(state.year);
  });
  const annualYearEl = document.getElementById('annualYearLabel');
  if (annualYearEl) annualYearEl.textContent = String(state.year);

  const totalPeople = state.data.people.length;
  document.getElementById('navPeopleCount').textContent = totalPeople;
  document.getElementById('sidebarPeopleCount').textContent = totalPeople;
}

// ============================================================================
// TAB 1: Daily Entry & Distribution (Simple & Clear for 64yo User)
// ============================================================================

function updateActiveDayPillHasData() {
  const activePill = document.querySelector('#monthDaysStrip .day-pill.active');
  if (activePill) {
    const totals = getDayTotals(state.selectedDate);
    const hasData = totals.received > 0 || totals.distributed > 0 || totals.invoices > 0 || totals.extraAmount > 0 || (totals.returnedCashTotal || 0) > 0;
    activePill.classList.toggle('has-data', hasData);
  }
}

function renderDaysStrip(shouldCenter = false) {
  const strip = document.getElementById('monthDaysStrip');
  if (!strip) return;
  const daysCount = getDaysInMonth(state.year, state.month);
  strip.innerHTML = '';

  for (let d = 1; d <= daysCount; d++) {
    const dateKey = formatDateKey(state.year, state.month, d);
    const dayName = getArabicDayName(state.year, state.month, d);
    const isFri = getDayOfWeekIndex(state.year, state.month, d) === 5;
    const totals = getDayTotals(dateKey);
    const hasData = totals.received > 0 || totals.distributed > 0 || totals.invoices > 0 || totals.extraAmount > 0 || (totals.returnedCashTotal || 0) > 0;

    const pill = document.createElement('div');
    pill.className = 'day-pill';
    if (isFri) pill.classList.add('is-friday');
    if (hasData) pill.classList.add('has-data');
    if (dateKey === state.selectedDate) {
      pill.classList.add('active');
    }

    pill.innerHTML = `
      <span class="d-num">${d}</span>
      <span class="d-name">${isFri ? 'الجمعة (إجازة)' : dayName}</span>
      <span class="d-dot"></span>
    `;

    pill.addEventListener('click', () => {
      state.selectedDate = dateKey;
      renderDailyTab();
    });

    strip.appendChild(pill);
  }

  // Only scroll the strip horizontally, NEVER scroll the window vertically!
  if (shouldCenter) {
    setTimeout(() => {
      const activePill = strip.querySelector('.day-pill.active');
      if (activePill) {
        const scrollTarget = activePill.offsetLeft - (strip.clientWidth / 2) + (activePill.clientWidth / 2);
        strip.scrollTo({ left: scrollTarget, behavior: 'smooth' });
      }
    }, 50);
  }

  const datePicker = document.getElementById('dailyDatePicker');
  if (datePicker) {
    datePicker.value = state.selectedDate;
  }

  const friBanner = document.getElementById('fridayAlertBanner');
  if (isFridayDate(state.selectedDate)) {
    friBanner.classList.remove('hidden');
  } else {
    friBanner.classList.add('hidden');
  }
}

function renderDailySummaryCards() {
  const { y, m, d } = parseDateParts(state.selectedDate);
  const dayName = getArabicDayName(y, m, d);
  const badge = document.getElementById('selectedDateBadge');
  badge.textContent = `${dayName} ${d} ${ARABIC_MONTHS[m]} ${y}`;

  const totals = getDayTotals(state.selectedDate);

  const recInput = document.getElementById('dailyReceivedInput');
  if (document.activeElement !== recInput) {
    recInput.value = totals.received > 0 ? totals.received : '';
  }

  const extraRow = document.getElementById('extraExpenseRow');
  const extraInput = document.getElementById('dailyExtraInput');
  const extraNoteInput = document.getElementById('dailyExtraNoteInput');
  const extraExcludeChk = document.getElementById('dailyExtraExcludeCompany');
  if (totals.extraAmount > 0 || totals.extraNote || totals.excludeFromCompany) {
    extraRow.classList.remove('hidden');
  }
  if (document.activeElement !== extraInput) {
    extraInput.value = totals.extraAmount > 0 ? totals.extraAmount : '';
  }
  if (document.activeElement !== extraNoteInput) {
    extraNoteInput.value = totals.extraNote || '';
  }
  if (extraExcludeChk) {
    extraExcludeChk.checked = !!totals.excludeFromCompany;
  }

  document.getElementById('dailyDistributedTotal').textContent = formatNumber(totals.distributed);
  document.getElementById('dailyActivePeopleCount').textContent = totals.activeCashCount;
  document.getElementById('dailyDriversSplit').textContent = `سائقين: ${formatNumber(totals.driversDistributed)}`;
  document.getElementById('dailyStaffSplit').textContent = `ستاف: ${formatNumber(totals.staffDistributed)}`;

  document.getElementById('dailyInvoicesTotal').textContent = formatNumber(totals.invoices);
  document.getElementById('dailyInvoicePeopleCount').textContent = totals.activeInvoiceCount;

  const balanceBox = document.getElementById('dailyBalanceBox');
  const remValEl = document.getElementById('dailyRemainingValue');
  const statusEl = document.getElementById('dailyMatchStatus');
  const carryBtn = document.getElementById('btnCarryOverNextDay');

  balanceBox.classList.remove('matched', 'over');
  remValEl.className = 'summary-value';
  carryBtn.classList.add('hidden');

  if (totals.received === 0 && totals.totalOut === 0) {
    remValEl.textContent = '0';
    statusEl.textContent = 'اكتب المبلغ اللي استلمته اليوم بالأول';
  } else if (Math.abs(totals.remaining) < 0.001 && totals.received > 0) {
    balanceBox.classList.add('matched');
    remValEl.classList.add('text-green');
    remValEl.textContent = '0 ✓ مطابق';
    statusEl.textContent = 'ممتاز! المبلغ المستلم اتوزع بالكامل بالظبط';
  } else if (totals.remaining > 0) {
    remValEl.classList.add('text-amber');
    remValEl.textContent = formatNumber(totals.remaining);
    statusEl.textContent = `باقي ${formatNumber(totals.remaining)} ر.ق لسه ما اتوزعتش`;
    carryBtn.classList.remove('hidden');
  } else {
    balanceBox.classList.add('over');
    remValEl.classList.add('text-danger');
    remValEl.textContent = formatNumber(totals.remaining);
    statusEl.textContent = `تنبيه: التوزيع زاد عن المستلم بـ ${formatNumber(Math.abs(totals.remaining))} ر.ق`;
  }

  // Update filter pill counts
  const driversCount = state.data.people.filter(p => p.role === 'driver').length;
  const staffCount = state.data.people.filter(p => p.role === 'staff').length;
  const activeTodayCount = state.data.people.filter(p => {
    const e = getPersonEntry(state.selectedDate, p.id);
    return e.cash > 0 || e.invoice > 0 || (Number(e.returnedCash) || 0) > 0;
  }).length;
  const unsettledMonthCount = state.data.people.filter(p => {
    const mt = getPersonMonthTotals(p.id, state.year, state.month);
    return mt.diff > 0.001;
  }).length;

  document.getElementById('countAll').textContent = state.data.people.length;
  document.getElementById('countDrivers').textContent = driversCount;
  document.getElementById('countStaff').textContent = staffCount;
  document.getElementById('countTodayActive').textContent = activeTodayCount;
  document.getElementById('countUnsettled').textContent = unsettledMonthCount;

  // Footer totals
  document.getElementById('footDailyCash').textContent = formatNumber(totals.distributed);
  document.getElementById('footDailyInvoices').textContent = formatNumber(totals.invoices);
  const footDailyRetEl = document.getElementById('footDailyReturned');
  if (footDailyRetEl) {
    footDailyRetEl.textContent = formatNumber(totals.returnedCashTotal);
  }
  document.getElementById('footDailyNote').textContent =
    totals.received > 0 || totals.returnedCashTotal > 0
      ? `المستلم: ${formatNumber(totals.received)} ر.ق${totals.returnedCashTotal > 0 ? ` (+${formatNumber(totals.returnedCashTotal)} مرتجع)` : ''} | الموزع: ${formatNumber(totals.distributed)} ر.ق | المتبقي باليد: ${formatNumber(totals.remaining)} ر.ق`
      : '';

  updateFillRemainingChips();
}

function updateFillRemainingChips() {
  const totals = getDayTotals(state.selectedDate);
  const rem = totals.remaining;
  document.querySelectorAll('.fill-rem-chip').forEach(btn => {
    if (rem > 0.001) {
      btn.classList.add('has-rem');
      btn.textContent = `⚡ ضع المتبقي (${formatNumber(rem)} ر.ق)`;
    } else {
      btn.classList.remove('has-rem');
      btn.textContent = '';
    }
  });
}

function renderDailyTable() {
  const tbody = document.getElementById('dailyDistributionBody');
  tbody.innerHTML = '';

  // Toggle header extra columns visibility
  const showExt = state.showDetailedCols;
  document.querySelectorAll('#dailyTableEl th.col-extra').forEach(th => {
    th.classList.toggle('hidden', !showExt);
  });
  const footLabelTd = document.getElementById('footLabelColspan');
  if (footLabelTd) {
    footLabelTd.setAttribute('colspan', showExt ? '4' : '2');
  }
  const footNoteTd = document.getElementById('footDailyNote');
  if (footNoteTd) {
    footNoteTd.setAttribute('colspan', showExt ? '4' : '2');
  }
  const toggleBtn = document.getElementById('btnToggleDetailedCols');
  if (toggleBtn) {
    toggleBtn.textContent = showExt
      ? '👁️ إخفاء التفاصيل الإضافية (العودة للوضع البسيط)'
      : '👁️ إظهار تفاصيل إضافية (العهدة وآخر استلام)';
  }

  if (state.data.people.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="${showExt ? 10 : 6}">
          <div class="empty-state-box">
            <h4>✨ أهلاً بك! الجدول جاهز لإضافة الأسماء</h4>
            <p>اضغط على الزر الأخضر بالأسفل لتجهيز الـ 60 خانة مرقمة فوراً، أو اكتب الأسماء واحداً تلو الآخر من الأعلى:</p>
            <div class="empty-state-actions">
              <button type="button" class="btn btn-success" id="btnEmptyGenerate60">
                🔢 تجهيز 60 خانة مرقمة جاهزة الآن
              </button>
              <button type="button" class="btn btn-primary" id="btnEmptyFocusQuickAdd">
                ➕ كتابة اسم جديد بالأعلى
              </button>
              <button type="button" class="btn btn-outline" id="btnEmptyGoBulk">
                📋 لصق قائمة أسماء دفعة واحدة
              </button>
            </div>
          </div>
        </td>
      </tr>
    `;

    document.getElementById('btnEmptyFocusQuickAdd')?.addEventListener('click', () => {
      document.getElementById('quickAddPersonName').focus();
    });
    document.getElementById('btnEmptyGenerate60')?.addEventListener('click', () => {
      state.data.people = create60BlankSlots();
      saveState();
      renderAll();
      showToast('تم تجهيز 60 خانة مرقمة! يمكنك كتابة الاسم داخل أي خانة مباشرة');
    });
    document.getElementById('btnEmptyGoBulk')?.addEventListener('click', () => {
      switchTab('people');
      document.getElementById('bulkNamesTextarea').focus();
    });
    return;
  }

  const q = state.dailySearch.trim().toLowerCase();

  const filtered = state.data.people.filter(person => {
    // Archived people are hidden from new daily registrations unless they have an existing record on this day
    if (person.archived) {
      const eToday = getPersonEntry(state.selectedDate, person.id);
      if (eToday.cash <= 0 && eToday.invoice <= 0 && eToday.returnedCash <= 0 && !eToday.note) {
        return false;
      }
    }
    if (state.dailyCategoryFilter === 'driver' && person.role !== 'driver') return false;
    if (state.dailyCategoryFilter === 'staff' && person.role !== 'staff') return false;
    if (state.dailyCategoryFilter === 'active_today') {
      const e = getPersonEntry(state.selectedDate, person.id);
      if (e.cash <= 0 && e.invoice <= 0 && (Number(e.returnedCash) || 0) <= 0) return false;
    }
    if (state.dailyCategoryFilter === 'unsettled_month') {
      const mt = getPersonMonthTotals(person.id, state.year, state.month);
      if (mt.diff <= 0.001) return false;
    }
    if (q) {
      const dispName = getPersonDisplayName(person);
      const metaStr = person.meta || '';
      const matchName = matchArabicSearch(dispName, q) || matchArabicSearch(metaStr, q);
      const matchNum = String(person.num).includes(q);
      if (!matchName && !matchNum) return false;
    }
    return true;
  });

  filtered.forEach(person => {
    const entry = getPersonEntry(state.selectedDate, person.id);
    const monthTotals = getPersonMonthTotals(person.id, state.year, state.month);
    const lastPrev = getLastPreviousReceipt(person.id, state.selectedDate);

    let lastPrevHtml = `<span class="text-muted">-</span>`;
    let subtleSubLine = '';
    if (lastPrev) {
      const isHigh = lastPrev.cash >= 1000;
      lastPrevHtml = `
        <span class="last-receipt-badge ${isHigh ? 'recent-high' : ''}">
          يوم ${lastPrev.d}/${lastPrev.m}: ${formatNumber(lastPrev.cash)}
        </span>
      `;
      subtleSubLine = `<div class="sub-hint-line">آخر استلام: يوم ${lastPrev.d}/${lastPrev.m} (${formatNumber(lastPrev.cash)} ر.ق)</div>`;
    }

    const tr = document.createElement('tr');
    if (entry.cash > 0 || entry.invoice > 0 || entry.returnedCash > 0) {
      tr.classList.add('active-row');
    }

    const netDailyDiff = entry.cash - (entry.invoice + entry.returnedCash);

    tr.innerHTML = `
      <td><strong>${person.num}</strong></td>
      <td>
        <div style="display:flex; flex-direction:column;">
          <input
            type="text"
            class="inline-name-input"
            placeholder="اكتب اسم رقم ${person.num}..."
            value="${escapeHtml(person.name || '')}"
            data-inline-name="${person.id}"
            title="اضغط هنا لكتابة أو تعديل الاسم"
          />
          ${!showExt && subtleSubLine ? subtleSubLine : ''}
          ${person.meta ? `<span class="meta-badge" style="width:max-content; margin-top:2px;">${escapeHtml(person.meta)}</span>` : ''}
        </div>
      </td>
      <td class="col-extra ${showExt ? '' : 'hidden'}">
        <span class="role-badge ${person.role}">
          ${person.role === 'driver' ? '🚛 سائق' : '👔 ستاف'}
        </span>
      </td>
      <td class="col-extra ${showExt ? '' : 'hidden'} no-print">${lastPrevHtml}</td>
      <td>
        <input
          type="number"
          step="any"
          min="0"
          class="cell-input cash-input ${entry.cash > 0 ? 'has-val-cash' : ''}"
          placeholder="0"
          value="${entry.cash > 0 ? entry.cash : ''}"
          data-pid="${person.id}"
          data-field="cash"
        />
        <button type="button" class="fill-rem-chip no-print" data-fill-rem="${person.id}"></button>
      </td>
      <td>
        <input
          type="number"
          step="any"
          min="0"
          class="cell-input inv-input ${entry.invoice > 0 ? 'has-val-inv' : ''}"
          placeholder="0"
          value="${entry.invoice > 0 ? entry.invoice : ''}"
          data-pid="${person.id}"
          data-field="invoice"
        />
      </td>
      <td>
        <div style="position: relative; display: flex; align-items: center;">
          <input
            type="number"
            step="any"
            min="0"
            class="cell-input ret-input ${entry.returnedCash > 0 ? 'has-val-ret' : ''}"
            placeholder="0"
            value="${entry.returnedCash > 0 ? entry.returnedCash : ''}"
            data-pid="${person.id}"
            data-field="returnedCash"
            title="كاش مرتجع في اليد"
          />
          ${netDailyDiff > 0.001 ? `<button type="button" class="fill-settle-chip no-print" data-settle-rem="${person.id}" title="تصفير الباقي كاش (+${formatNumber(netDailyDiff)} ر.ق)">↩️ تصفير</button>` : ''}
        </div>
      </td>
      <td>
        <input
          type="text"
          class="cell-input"
          id="noteInp_${person.id}"
          placeholder="ملاحظة (اختياري)..."
          value="${escapeHtml(entry.note || '')}"
          data-pid="${person.id}"
          data-field="note"
        />
        <div class="cell-quick-tags no-print">
          <button type="button" class="tag-chip" data-row-tag="⛽ بترول/وقود" data-target-pid="${person.id}">⛽ وقود</button>
          <button type="button" class="tag-chip" data-row-tag="🔧 صيانة" data-target-pid="${person.id}">🔧 صيانة</button>
          <button type="button" class="tag-chip" data-row-tag="📦 مشتريات" data-target-pid="${person.id}">📦 مشتريات</button>
          <button type="button" class="tag-chip" data-row-tag="☕ نثريات" data-target-pid="${person.id}">☕ نثريات</button>
        </div>
      </td>
      <td class="col-extra ${showExt ? '' : 'hidden'} no-print" id="mTotalCell_${person.id}">
        <span class="text-green" style="font-weight:800;">${formatNumber(monthTotals.cash)}</span>
      </td>
      <td class="no-print" id="mSettleCell_${person.id}">
        ${getSettlementBadgeHtml(monthTotals.cash, monthTotals.invoice, monthTotals.returnedCash)}
      </td>
      <td class="no-print">
        <div style="display:flex; gap:5px;">
          <button type="button" class="btn btn-sm btn-outline" data-open-person="${person.id}">
            📄 فتح صفحته
          </button>
          ${showExt ? `<button type="button" class="btn btn-sm btn-outline" data-open-voucher="${person.id}" title="سند توقيع">🧾</button>` : ''}
        </div>
      </td>
    `;

    tbody.appendChild(tr);
  });

  // Inline Name editing
  tbody.querySelectorAll('input[data-inline-name]').forEach(nameInp => {
    nameInp.addEventListener('change', () => {
      const pid = nameInp.getAttribute('data-inline-name');
      const person = state.data.people.find(p => p.id === pid);
      if (person) {
        person.name = nameInp.value.trim();
        saveState();
        showToast(`تم حفظ الاسم: ${getPersonDisplayName(person)}`);
      }
    });
  });

  // 1-Click Fill Remaining Balance into focused person's cash input
  tbody.querySelectorAll('[data-fill-rem]').forEach(btn => {
    btn.addEventListener('click', () => {
      const pid = btn.getAttribute('data-fill-rem');
      const totals = getDayTotals(state.selectedDate);
      if (totals.remaining <= 0) return;
      const cashInp = tbody.querySelector(`input[data-pid="${pid}"][data-field="cash"]`);
      if (!cashInp) return;
      const curVal = Number(cashInp.value) || 0;
      const nextVal = Number((curVal + totals.remaining).toFixed(2));
      cashInp.value = nextVal;
      cashInp.dispatchEvent(new Event('input', { bubbles: true }));
      const person = state.data.people.find(p => p.id === pid);
      showToast(`تم وضع المتبقي بالكامل لـ ${getPersonDisplayName(person)} ✓`);
    });
  });

  // Quick invoice category tags (appear only on row focus)
  tbody.querySelectorAll('[data-row-tag]').forEach(chip => {
    chip.addEventListener('click', () => {
      const pid = chip.getAttribute('data-target-pid');
      const tag = chip.getAttribute('data-row-tag');
      const inp = document.getElementById(`noteInp_${pid}`);
      if (!inp) return;
      const cur = inp.value.trim();
      inp.value = cur ? `${cur} - ${tag}` : tag;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });

  // 1-Click Settle Remaining Balance as Returned Cash in Hand
  tbody.querySelectorAll('[data-settle-rem]').forEach(btn => {
    btn.addEventListener('click', () => {
      const pid = btn.getAttribute('data-settle-rem');
      const entry = getPersonEntry(state.selectedDate, pid);
      const remainingDiff = entry.cash - (entry.invoice + entry.returnedCash);
      if (remainingDiff <= 0) return;
      const nextRet = Number((entry.returnedCash + remainingDiff).toFixed(2));
      const retInp = tbody.querySelector(`input[data-pid="${pid}"][data-field="returnedCash"]`);
      if (retInp) {
        retInp.value = nextRet;
        retInp.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const person = state.data.people.find(p => p.id === pid);
      showToast(`تم تصفير باقي حساب ${getPersonDisplayName(person)} كمرتجع كاش باليد (${formatNumber(nextRet)} ر.ق) ✓`);
    });
  });

  // Attach input listeners + Keyboard Enter/Down/Up navigation between rows
  const allTableInputs = Array.from(tbody.querySelectorAll('input[data-pid]'));
  allTableInputs.forEach(input => {
    input.addEventListener('input', () => {
      const pid = input.getAttribute('data-pid');
      const field = input.getAttribute('data-field');
      const val = input.value;

      setPersonEntry(state.selectedDate, pid, { [field]: val });

      const updated = getPersonEntry(state.selectedDate, pid);
      const row = input.closest('tr');
      if (updated.cash > 0 || updated.invoice > 0 || updated.returnedCash > 0) {
        row.classList.add('active-row');
      } else {
        row.classList.remove('active-row');
      }

      const mTotals = getPersonMonthTotals(pid, state.year, state.month);

      if (field === 'cash') {
        input.classList.toggle('has-val-cash', updated.cash > 0);
        const mCell = document.getElementById(`mTotalCell_${pid}`);
        if (mCell) {
          mCell.innerHTML = `<span class="text-green" style="font-weight:800;">${formatNumber(mTotals.cash)}</span>`;
        }
      } else if (field === 'invoice') {
        input.classList.toggle('has-val-inv', updated.invoice > 0);
      } else if (field === 'returnedCash') {
        input.classList.toggle('has-val-ret', updated.returnedCash > 0);
      }

      const sCell = document.getElementById(`mSettleCell_${pid}`);
      if (sCell) {
        sCell.innerHTML = getSettlementBadgeHtml(mTotals.cash, mTotals.invoice, mTotals.returnedCash);
      }

      renderDailySummaryCards();
      updateActiveDayPillHasData();
    });

    // Senior-friendly Enter / ArrowDown / ArrowUp navigation to move to next person's same column
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const field = input.getAttribute('data-field');
        const sameColInputs = Array.from(tbody.querySelectorAll(`input[data-field="${field}"]`));
        const idx = sameColInputs.indexOf(input);
        if (idx !== -1) {
          const nextIdx = (e.key === 'ArrowUp') ? idx - 1 : idx + 1;
          if (sameColInputs[nextIdx]) {
            e.preventDefault();
            sameColInputs[nextIdx].focus();
            sameColInputs[nextIdx].select();
          }
        }
      }
    });
  });

  // Attach open person page & voucher links
  tbody.querySelectorAll('[data-open-person]').forEach(btn => {
    btn.addEventListener('click', () => {
      const pid = btn.getAttribute('data-open-person');
      openPersonLedgerPage(pid);
    });
  });

  tbody.querySelectorAll('[data-open-voucher]').forEach(btn => {
    btn.addEventListener('click', () => {
      const pid = btn.getAttribute('data-open-voucher');
      openVoucherModal(pid);
    });
  });

  updateFillRemainingChips();
}

function renderDailyTab() {
  renderDaysStrip(true);
  renderDailySummaryCards();
  renderDailyTable();
}

// ============================================================================
// TAB 2: Monthly Matrix View (كشف الشهر الشامل)
// ============================================================================

function renderMonthlyMatrixTab() {
  const daysCount = getDaysInMonth(state.year, state.month);
  const hideFridays = state.hideFridaysInMonthly;
  const viewMode = state.monthlyViewMode;
  const q = state.monthlySearch.trim().toLowerCase();

  const activeDays = [];
  for (let d = 1; d <= daysCount; d++) {
    const isFri = getDayOfWeekIndex(state.year, state.month, d) === 5;
    if (hideFridays && isFri) continue;
    activeDays.push({
      d,
      isFri,
      dayName: getArabicDayName(state.year, state.month, d),
      dateKey: formatDateKey(state.year, state.month, d)
    });
  }

  let monthRecTotal = 0;
  let monthDistTotal = 0;
  let monthDriversTotal = 0;
  let monthStaffTotal = 0;
  let monthExtraTotal = 0;
  let monthInvTotal = 0;

  for (let d = 1; d <= daysCount; d++) {
    const dateKey = formatDateKey(state.year, state.month, d);
    const dt = getDayTotals(dateKey);
    monthRecTotal += dt.received;
    monthDistTotal += dt.distributed;
    monthDriversTotal += dt.driversDistributed;
    monthStaffTotal += dt.staffDistributed;
    monthExtraTotal += dt.extraAmount;
    monthInvTotal += dt.invoices;
  }

  document.getElementById('monthTotalReceived').textContent = formatNumber(monthRecTotal);
  document.getElementById('monthTotalDistributed').textContent = formatNumber(monthDistTotal);
  const splitSubEl = document.getElementById('monthSplitSub');
  if (splitSubEl) {
    splitSubEl.textContent = `سائقين: ${formatNumber(monthDriversTotal)} | ستاف: ${formatNumber(monthStaffTotal)}`;
  }

  const diff = monthRecTotal - (monthDistTotal + monthExtraTotal);
  const diffEl = document.getElementById('monthTotalDiff');
  diffEl.textContent = diff === 0 && monthRecTotal > 0 ? '0 (مطابق ✓)' : formatNumber(diff);
  diffEl.className = 'kpi-value ' + (diff === 0 ? 'text-green' : 'text-amber');
  document.getElementById('monthTotalInvoices').textContent = formatNumber(monthInvTotal);

  const thead = document.getElementById('monthlyMatrixHead');
  let headHtml = `
    <tr>
      <th class="sticky-col"># / الاسم</th>
      <th>الفئة</th>
  `;
  activeDays.forEach(dayObj => {
    headHtml += `
      <th class="${dayObj.isFri ? 'friday-col' : ''}" title="${dayObj.dayName} ${dayObj.d}">
        <div>يوم ${dayObj.d}</div>
        <small style="font-weight:500; color:var(--text-muted);">${dayObj.dayName}</small>
      </th>
    `;
  });
  headHtml += `
      <th style="background:#dcfce7; color:#14532d;">توتال الفلوس بالشهر</th>
      <th style="background:#ede9fe; color:#4c1d95;">توتال الفواتير بالشهر</th>
    </tr>
  `;
  thead.innerHTML = headHtml;

  const tbody = document.getElementById('monthlyMatrixBody');
  let bodyHtml = '';

  bodyHtml += `
    <tr class="matrix-received-row">
      <td class="sticky-col" style="background:#ecfdf5;">💵 المستلم اليومي</td>
      <td>الوارد</td>
  `;
  activeDays.forEach(dayObj => {
    const rec = getDayReceived(dayObj.dateKey);
    bodyHtml += `
      <td class="matrix-cell-editable" data-jump-date="${dayObj.dateKey}" title="اضغط لفتح يوم ${dayObj.d}">
        ${rec > 0 ? formatNumber(rec) : '-'}
      </td>
    `;
  });
  bodyHtml += `
      <td><strong>${formatNumber(monthRecTotal)}</strong></td>
      <td>-</td>
    </tr>
  `;

  bodyHtml += `
    <tr class="matrix-distributed-row">
      <td class="sticky-col" style="background:#eff6ff;">📤 الموزع اليومي</td>
      <td>المنصرف</td>
  `;
  activeDays.forEach(dayObj => {
    const dt = getDayTotals(dayObj.dateKey);
    bodyHtml += `
      <td class="matrix-cell-editable" data-jump-date="${dayObj.dateKey}">
        ${dt.distributed > 0 ? formatNumber(dt.distributed) : '-'}
      </td>
    `;
  });
  bodyHtml += `
      <td><strong>${formatNumber(monthDistTotal)}</strong></td>
      <td><strong>${formatNumber(monthInvTotal)}</strong></td>
    </tr>
  `;

  const peopleToShowInMonth = q ? state.data.people : getReportablePeople(state.year);

  peopleToShowInMonth.forEach(person => {
    const dispName = getPersonDisplayName(person);
    const metaStr = person.meta || '';
    if (q && !matchArabicSearch(dispName, q) && !matchArabicSearch(metaStr, q) && !String(person.num).includes(q)) {
      return;
    }
    const pMonthTotals = getPersonMonthTotals(person.id, state.year, state.month);
    if (state.showOnlyActiveInMonthly && pMonthTotals.cash === 0 && pMonthTotals.invoice === 0) {
      return;
    }

    bodyHtml += `
      <tr>
        <td class="sticky-col">
          <a href="javascript:void(0)" data-open-person="${person.id}" style="font-weight:700; color:var(--text-main); text-decoration:none;">
            ${person.num}. ${escapeHtml(dispName)}
          </a>
        </td>
        <td>
          <span class="role-badge ${person.role}">
            ${person.role === 'driver' ? 'سائق' : 'ستاف'}
          </span>
        </td>
    `;

    activeDays.forEach(dayObj => {
      const entry = getPersonEntry(dayObj.dateKey, person.id);
      let cellContent = '-';
      if (viewMode === 'cash') {
        cellContent = entry.cash > 0 ? `<span class="matrix-val-cash">${formatNumber(entry.cash)}</span>` : '-';
      } else if (viewMode === 'invoices') {
        cellContent = entry.invoice > 0 ? `<span class="matrix-val-inv">${formatNumber(entry.invoice)}</span>` : '-';
      } else {
        if (entry.cash > 0 || entry.invoice > 0) {
          cellContent = `
            ${entry.cash > 0 ? `<span class="matrix-val-cash">${formatNumber(entry.cash)}</span>` : ''}
            ${entry.invoice > 0 ? `<span class="matrix-val-inv">ف: ${formatNumber(entry.invoice)}</span>` : ''}
          `;
        }
      }

      bodyHtml += `
        <td
          class="matrix-cell-editable ${dayObj.isFri ? 'friday-col' : ''}"
          data-edit-cell="1"
          data-date="${dayObj.dateKey}"
          data-pid="${person.id}"
          title="${dispName} - يوم ${dayObj.d} (اضغط للتعديل)"
        >
          ${cellContent}
        </td>
      `;
    });

    bodyHtml += `
        <td style="background:#f0fdf4; font-weight:800; color:var(--green);">
          ${pMonthTotals.cash > 0 ? formatNumber(pMonthTotals.cash) : '0'}
        </td>
        <td style="background:#faf5ff; font-weight:800; color:var(--purple);">
          ${pMonthTotals.invoice > 0 ? formatNumber(pMonthTotals.invoice) : '0'}
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = bodyHtml;

  const tfoot = document.getElementById('monthlyMatrixFoot');
  let footHtml = `
    <tr class="totals-row">
      <td class="sticky-col" style="background:#0f172a; color:#fff;">التوتال النهائي للشهر</td>
      <td>الكل</td>
  `;
  activeDays.forEach(dayObj => {
    const dt = getDayTotals(dayObj.dateKey);
    const val = viewMode === 'invoices' ? dt.invoices : dt.distributed;
    footHtml += `<td>${val > 0 ? formatNumber(val) : '-'}</td>`;
  });
  footHtml += `
      <td style="background:#15803d; color:#fff; font-weight:800;">${formatNumber(monthDistTotal)}</td>
      <td style="background:#6d28d9; color:#fff; font-weight:800;">${formatNumber(monthInvTotal)}</td>
    </tr>
  `;
  tfoot.innerHTML = footHtml;

  tbody.querySelectorAll('[data-open-person]').forEach(el => {
    el.addEventListener('click', () => {
      openPersonLedgerPage(el.getAttribute('data-open-person'));
    });
  });

  tbody.querySelectorAll('[data-jump-date]').forEach(el => {
    el.addEventListener('click', () => {
      state.selectedDate = el.getAttribute('data-jump-date');
      switchTab('daily');
    });
  });

  tbody.querySelectorAll('[data-edit-cell]').forEach(cell => {
    cell.addEventListener('click', () => {
      const dateStr = cell.getAttribute('data-date');
      const pid = cell.getAttribute('data-pid');
      const person = state.data.people.find(p => p.id === pid);
      if (!person) return;
      const dispName = getPersonDisplayName(person);
      const current = getPersonEntry(dateStr, pid);
      const { d, m } = parseDateParts(dateStr);

      const isInvMode = state.monthlyViewMode === 'invoices';
      const label = isInvMode
        ? `أدخل قيمة الفواتير المقدمة (بيتي كاش) لـ "${dispName}" يوم ${d} ${ARABIC_MONTHS[m]}:`
        : `أدخل المبلغ المستلم لـ "${dispName}" يوم ${d} ${ARABIC_MONTHS[m]}:`;

      const defaultVal = isInvMode ? (current.invoice || '') : (current.cash || '');
      const input = prompt(label, defaultVal);
      if (input === null) return;

      if (isInvMode) {
        setPersonEntry(dateStr, pid, { invoice: Number(input) || 0 });
      } else {
        setPersonEntry(dateStr, pid, { cash: Number(input) || 0 });
      }
      renderMonthlyMatrixTab();
      showToast(`تم تحديث بيان ${dispName} ليوم ${d} ${ARABIC_MONTHS[m]}`);
    });
  });
}

// ============================================================================
// TAB 3: Individual Person Page & Petty Cash Invoices (صفحة الشخص والفواتير)
// ============================================================================

function openPersonLedgerPage(personId) {
  state.selectedPersonId = personId;
  switchTab('person');
}

function renderPersonSidebar() {
  const listEl = document.getElementById('personSidebarList');
  listEl.innerHTML = '';

  if (state.data.people.length === 0) {
    listEl.innerHTML = `<div class="text-muted" style="padding:12px; text-align:center;">لا توجد أسماء مضافة بعد.</div>`;
    return;
  }

  const q = state.personSidebarSearch.trim().toLowerCase();
  const sidebarPeople = q ? state.data.people : getReportablePeople(state.year);
  document.getElementById('sidebarPeopleCount').textContent = sidebarPeople.length;

  sidebarPeople.forEach(person => {
    if (state.personSidebarFilter === 'driver' && person.role !== 'driver') return;
    if (state.personSidebarFilter === 'staff' && person.role !== 'staff') return;
    const dispName = getPersonDisplayName(person);
    const metaStr = person.meta || '';
    if (q && !matchArabicSearch(dispName, q) && !matchArabicSearch(metaStr, q) && !String(person.num).includes(q)) return;

    const mTotals = getPersonMonthTotals(person.id, state.year, state.month);

    const item = document.createElement('div');
    item.className = 'person-list-item' + (person.id === state.selectedPersonId ? ' active' : '');
    item.innerHTML = `
      <div class="p-item-name">
        <span class="p-item-num">#${person.num}</span>
        <span>${escapeHtml(dispName)}</span>
      </div>
      <div class="p-item-totals">
        ${mTotals.cash > 0 ? formatNumber(mTotals.cash) : ''}
      </div>
    `;

    item.addEventListener('click', () => {
      state.selectedPersonId = person.id;
      renderPersonTab();
    });

    listEl.appendChild(item);
  });
}

function renderPersonSheet() {
  const person = state.data.people.find(p => p.id === state.selectedPersonId) || state.data.people[0];
  const tbody = document.getElementById('personLedgerBody');

  if (!person) {
    document.getElementById('ledgerPersonNumber').textContent = '#-';
    document.getElementById('ledgerPersonName').textContent = 'لا يوجد أشخاص مسجلين بعد';
    document.getElementById('quickEntryPersonName').textContent = '-';
    document.getElementById('ledgerSettlementBadge').innerHTML = '';
    document.getElementById('ledgerPersonMeta').classList.add('hidden');
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center; padding: 28px; color: var(--text-muted);">
          يرجى إضافة أسماء الأشخاص أولاً من تبويب "1. التسجيل اليومي" أو "6. الأشخاص".
        </td>
      </tr>
    `;
    return;
  }

  state.selectedPersonId = person.id;
  const dispName = getPersonDisplayName(person);

  document.getElementById('ledgerPersonNumber').textContent = `#${person.num}`;
  document.getElementById('ledgerPersonName').textContent = dispName;
  document.getElementById('quickEntryPersonName').textContent = dispName;

  const roleEl = document.getElementById('ledgerPersonRole');
  roleEl.className = `role-badge ${person.role}`;
  roleEl.textContent = person.role === 'driver' ? '🚛 سائق' : '👔 موظف ستاف';

  const metaEl = document.getElementById('ledgerPersonMeta');
  if (person.meta) {
    metaEl.textContent = `${person.role === 'driver' ? '🚗 السيارة: ' : '🏢 القسم: '}${person.meta}`;
    metaEl.classList.remove('hidden');
  } else {
    metaEl.classList.add('hidden');
  }

  const isYearScope = state.personSelectedMonth === 'all';
  let startMonth = state.month;
  let endMonth = state.month;

  if (state.personSelectedMonth === 'all') {
    startMonth = 1;
    endMonth = 12;
  } else if (state.personSelectedMonth === 'current') {
    startMonth = state.month;
    endMonth = state.month;
  } else {
    const parsedM = Number(state.personSelectedMonth) || 1;
    startMonth = parsedM;
    endMonth = parsedM;
  }

  // Update pills active state
  document.querySelectorAll('#personMonthPills .p-pill').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-pmonth') === String(state.personSelectedMonth));
  });

  document.getElementById('ledgerPeriodSubtitle').textContent = isYearScope
    ? `كشف حساب السنة كاملة (${state.year}) - حركة الأيام والمبالغ المستلمة والفواتير (ر.ق)`
    : `كشف حساب شهر ${ARABIC_MONTHS[startMonth]} ${state.year} - حركة الأيام والمبالغ المستلمة والفواتير (ر.ق)`;

  const pEntryDate = document.getElementById('pEntryDate');
  if (!pEntryDate.value) {
    pEntryDate.value = state.selectedDate;
  }

  const startDateKey = formatDateKey(state.year, startMonth, 1);
  const openingBal = getPersonBalanceBeforeDate(person.id, startDateKey);

  const rows = [];
  for (let m = startMonth; m <= endMonth; m++) {
    const daysCount = getDaysInMonth(state.year, m);
    for (let d = 1; d <= daysCount; d++) {
      const dateKey = formatDateKey(state.year, m, d);
      const entry = getPersonEntry(dateKey, person.id);
      if (entry.cash > 0 || entry.invoice > 0 || entry.returnedCash > 0 || (entry.note && entry.note.trim() !== '')) {
        rows.push({
          dateKey,
          d,
          m,
          y: state.year,
          dayName: getArabicDayName(state.year, m, d),
          cash: entry.cash,
          invoice: entry.invoice,
          returnedCash: entry.returnedCash,
          note: entry.note
        });
      }
    }
  }

  tbody.innerHTML = '';

  let totalCashCents = 0;
  let totalInvoicesCents = 0;
  let totalReturnedCents = 0;
  let runningBalanceCents = toCents(openingBal);

  if (Math.abs(openingBal) > 0.001) {
    const trOp = document.createElement('tr');
    trOp.style.background = '#f8fafc';
    trOp.style.fontWeight = '700';
    let opClass = openingBal > 0 ? 'bal-owes' : 'bal-credit';
    let opText = openingBal > 0 ? `+${formatNumber(openingBal)} ر.ق (متبقي بذمته مرحل)` : `-${formatNumber(Math.abs(openingBal))} ر.ق (له فرق مرحل)`;
    trOp.innerHTML = `
      <td>📌</td>
      <td><strong>بداية الفترة</strong></td>
      <td>-</td>
      <td colspan="3" style="color: var(--text-muted); text-align: right;">رصيد سابق مرحل من الشهور/الفترات السابقة</td>
      <td>-</td>
      <td class="col-balance-cell"><span class="${opClass}">${opText}</span></td>
      <td class="no-print">-</td>
    `;
    tbody.appendChild(trOp);
  }

  if (rows.length === 0 && Math.abs(openingBal) <= 0.001) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align:center; padding: 28px; color: var(--text-muted);">
          لا توجد حركات مسجلة لـ <strong>${escapeHtml(dispName)}</strong> في هذه الفترة. يمكنك إضافتها من الأعلى أو من شاشة التسجيل اليومي.
        </td>
      </tr>
    `;
  } else {
    rows.forEach((r, idx) => {
      const cCents = toCents(r.cash);
      const iCents = toCents(r.invoice);
      const retCents = toCents(r.returnedCash || 0);

      totalCashCents += cCents;
      totalInvoicesCents += iCents;
      totalReturnedCents += retCents;
      runningBalanceCents += (cCents - (iCents + retCents));

      const runningBalance = fromCents(runningBalanceCents);

      let balClass = 'bal-settled';
      let balText = '0.00 ر.ق (مصفى)';
      if (runningBalanceCents > 0) {
        balClass = 'bal-owes';
        balText = `+${formatNumber(runningBalance)} ر.ق (متبقي بعهدته)`;
      } else if (runningBalanceCents < 0) {
        balClass = 'bal-credit';
        balText = `-${formatNumber(Math.abs(runningBalance))} ر.ق (له فرق)`;
      }

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${idx + 1}</strong></td>
        <td><strong>${r.d} ${ARABIC_MONTHS[r.m]} ${r.y}</strong></td>
        <td>${r.dayName}</td>
        <td class="col-cash-cell">${r.cash > 0 ? formatNumber(r.cash) : '0'}</td>
        <td class="col-inv-cell">${r.invoice > 0 ? formatNumber(r.invoice) : '0'}</td>
        <td class="col-ret-cell">${r.returnedCash > 0 ? formatNumber(r.returnedCash) : '0'}</td>
        <td>${escapeHtml(r.note) || '-'}</td>
        <td class="col-balance-cell"><span class="${balClass}">${balText}</span></td>
        <td class="no-print">
          <button type="button" class="btn btn-sm btn-outline" data-edit-pdate="${r.dateKey}" title="تعديل هذا السطر">✏️</button>
          <button type="button" class="btn btn-sm btn-danger-outline" data-del-pdate="${r.dateKey}" title="حذف هذا السطر">🗑️</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  const totalCash = fromCents(totalCashCents);
  const totalInvoices = fromCents(totalInvoicesCents);
  const totalReturned = fromCents(totalReturnedCents);
  const netDiff = fromCents(runningBalanceCents);

  document.getElementById('personTotalCash').textContent = formatNumber(totalCash);
  document.getElementById('personTotalInvoices').textContent = formatNumber(totalInvoices);
  const pTotRetEl = document.getElementById('personTotalReturned');
  if (pTotRetEl) pTotRetEl.textContent = formatNumber(totalReturned);

  document.getElementById('ledgerSettlementBadge').innerHTML = getSettlementBadgeHtml(totalCash + openingBal, totalInvoices, totalReturned);

  document.getElementById('personNetSummaryCell').innerHTML = `
    <span>الرصيد النهائي: <strong>${formatNumber(netDiff)} ر.ق</strong> ${netDiff > 0.001 ? '(متبقي بذمته)' : netDiff < -0.001 ? '(له فرق مستحق)' : '(خالص ومصفى بالكامل ✓)'}</span>
  `;

  document.getElementById('cardPersonCashTotal').textContent = `${formatNumber(totalCash)} ر.ق`;
  document.getElementById('cardPersonInvTotal').textContent = `${formatNumber(totalInvoices)} ر.ق`;
  const cardRetEl = document.getElementById('cardPersonRetTotal');
  if (cardRetEl) cardRetEl.textContent = `${formatNumber(totalReturned)} ر.ق`;
  document.getElementById('cardPersonNetDiff').textContent = `${formatNumber(netDiff)} ر.ق`;

  const statusSubEl = document.getElementById('cardPersonNetStatus');
  if (totalCash === 0 && totalInvoices === 0 && totalReturned === 0 && Math.abs(openingBal) <= 0.001) {
    statusSubEl.textContent = 'لا توجد مبالغ مسجلة';
    statusSubEl.className = 'p-total-sub text-muted';
  } else if (Math.abs(netDiff) < 0.001) {
    statusSubEl.textContent = '✓ خالص ومصفى بالكامل (فواتير + كاش مرتجع)';
    statusSubEl.className = 'p-total-sub text-green';
  } else if (netDiff > 0) {
    statusSubEl.textContent = `متبقي بذمته (لم يصفِ بعد): ${formatNumber(netDiff)} ر.ق`;
    statusSubEl.className = 'p-total-sub text-amber';
  } else {
    statusSubEl.textContent = `له فرق فواتير مستحق الصرف: ${formatNumber(Math.abs(netDiff))} ر.ق`;
    statusSubEl.className = 'p-total-sub text-blue';
  }

  tbody.querySelectorAll('[data-edit-pdate]').forEach(btn => {
    btn.addEventListener('click', () => {
      const dateKey = btn.getAttribute('data-edit-pdate');
      const entry = getPersonEntry(dateKey, person.id);
      document.getElementById('pEntryDate').value = dateKey;
      document.getElementById('pEntryCash').value = entry.cash || '';
      document.getElementById('pEntryInvoice').value = entry.invoice || '';
      const pRetInp = document.getElementById('pEntryReturnedCash');
      if (pRetInp) pRetInp.value = entry.returnedCash || '';
      document.getElementById('pEntryNote').value = entry.note || '';
      document.getElementById('pEntryCash').focus();
    });
  });

  tbody.querySelectorAll('[data-del-pdate]').forEach(btn => {
    btn.addEventListener('click', () => {
      const dateKey = btn.getAttribute('data-del-pdate');
      if (confirm('هل تريد حذف هذا السطر من صفحة الشخص؟')) {
        setPersonEntry(dateKey, person.id, { cash: 0, invoice: 0, returnedCash: 0, note: '' });
        renderPersonTab();
        showToast('تم حذف السطر بنجاح');
      }
    });
  });
}

function openVoucherModal(personId) {
  const person = state.data.people.find(p => p.id === (personId || state.selectedPersonId)) || state.data.people[0];
  if (!person) {
    alert('يرجى اختيار شخص أولاً');
    return;
  }
  const dispName = getPersonDisplayName(person);

  // Compute period based on state.personSelectedMonth
  let startM = state.month;
  let endM = state.month;
  let scopeLabel = `شهر ${ARABIC_MONTHS[state.month]} ${state.year}`;

  if (state.activeTab === 'person' || state.personSelectedMonth) {
    if (state.personSelectedMonth === 'all') {
      startM = 1;
      endM = 12;
      scopeLabel = `سنة ${state.year} كاملة`;
    } else if (state.personSelectedMonth === 'current' || !state.personSelectedMonth) {
      startM = state.month;
      endM = state.month;
      scopeLabel = `شهر ${ARABIC_MONTHS[state.month]} ${state.year}`;
    } else {
      const pm = parseInt(state.personSelectedMonth, 10);
      if (!isNaN(pm) && pm >= 1 && pm <= 12) {
        startM = pm;
        endM = pm;
        scopeLabel = `شهر ${ARABIC_MONTHS[pm]} ${state.year}`;
      }
    }
  }

  let totalCash = 0;
  let totalInv = 0;
  let totalRet = 0;

  for (let m = startM; m <= endM; m++) {
    const mt = getPersonMonthTotals(person.id, state.year, m);
    totalCash += mt.cash;
    totalInv += mt.invoice;
    totalRet += mt.returnedCash;
  }

  const diff = totalCash - (totalInv + totalRet);

  document.getElementById('vPeriodText').textContent = `تاريخ الإصدار: ${state.selectedDate}`;
  document.getElementById('vPersonName').textContent = dispName;
  document.getElementById('vPersonRole').textContent = `#${person.num} - ${person.role === 'driver' ? 'سائق' : 'موظف ستاف'}`;
  document.getElementById('vPersonMeta').textContent = person.meta || 'غير محدد';
  document.getElementById('vScopeLabel').textContent = scopeLabel;
  document.getElementById('vTotalCash').textContent = `${formatNumber(totalCash)} ر.ق`;
  document.getElementById('vTotalInv').textContent = `${formatNumber(totalInv)} ر.ق`;
  const vTotalRetEl = document.getElementById('vTotalRet');
  if (vTotalRetEl) {
    vTotalRetEl.textContent = `${formatNumber(totalRet)} ر.ق`;
  }
  document.getElementById('vNetStatus').textContent = Math.abs(diff) < 0.001
    ? '0 ر.ق (خالص ومصفى بالكامل ✓)'
    : (diff > 0 ? `${formatNumber(diff)} ر.ق (متبقي بذمته لم يصفِ بعد)` : `${formatNumber(Math.abs(diff))} ر.ق (له فرق فواتير مستحق الصرف)`);

  document.getElementById('voucherModal').classList.remove('hidden');
}

function sharePersonStatementWhatsApp() {
  const person = state.data.people.find(p => p.id === state.selectedPersonId) || state.data.people[0];
  if (!person) {
    alert('يرجى اختيار شخص أولاً');
    return;
  }
  const dispName = getPersonDisplayName(person);
  const isYearScope = state.personSelectedMonth === 'all';
  const periodTitle = isYearScope ? `سنة ${state.year}` : `شهر ${ARABIC_MONTHS[state.month]} ${state.year}`;

  const startMonth = isYearScope ? 1 : state.month;
  const endMonth = isYearScope ? 12 : state.month;

  let lines = [];
  let totalCashCents = 0;
  let totalInvCents = 0;
  let totalRetCents = 0;

  for (let m = startMonth; m <= endMonth; m++) {
    const daysCount = getDaysInMonth(state.year, m);
    for (let d = 1; d <= daysCount; d++) {
      const dk = formatDateKey(state.year, m, d);
      const e = getPersonEntry(dk, person.id);
      if (e.cash > 0 || e.invoice > 0 || e.returnedCash > 0 || e.note) {
        totalCashCents += toCents(e.cash);
        totalInvCents += toCents(e.invoice);
        totalRetCents += toCents(e.returnedCash || 0);
        let line = `• ${d}/${m}: استلام ${formatNumber(e.cash)} ر.ق | فواتير ${formatNumber(e.invoice)} ر.ق`;
        if (e.returnedCash > 0) line += ` | مرتجع كاش ${formatNumber(e.returnedCash)} ر.ق`;
        if (e.note) line += ` (${e.note})`;
        lines.push(line);
      }
    }
  }

  const totalCash = fromCents(totalCashCents);
  const totalInv = fromCents(totalInvCents);
  const totalRet = fromCents(totalRetCents);
  const diff = fromCents(totalCashCents - (totalInvCents + totalRetCents));
  const statusLine = Math.abs(diff) < 0.001
    ? 'خالص ومصفى بالكامل ✓'
    : (diff > 0 ? `متبقي بذمته (لم يأتِ بباقي التصفية بعد): ${formatNumber(diff)} ر.ق` : `له فرق فواتير مستحق الصرف: ${formatNumber(Math.abs(diff))} ر.ق`);

  const message = [
    `📋 *كشف حساب عهدة وفواتير (بيتي كاش)*`,
    `👤 الاسم: *${dispName}* (#${person.num})${person.meta ? ` - ${person.meta}` : ''}`,
    `📅 الفترة: *${periodTitle}*`,
    `-------------------------`,
    ...(lines.length > 0 ? lines : ['لا توجد حركات مسجلة']),
    `-------------------------`,
    `💵 *إجمالي المبالغ المستلمة (سُلف):* ${formatNumber(totalCash)} ر.ق`,
    `🧾 *إجمالي الفواتير المقدمة:* ${formatNumber(totalInv)} ر.ق`,
    ...(totalRet > 0 ? [`↩️ *إجمالي الكاش المرتجع باليد:* ${formatNumber(totalRet)} ر.ق`] : []),
    `⚖️ *الموقف النهائي:* ${statusLine}`
  ].join('\n');

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(message).catch(() => {});
  }

  const waUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;
  window.open(waUrl, '_blank');
  showToast('تم نسخ الكشف وفتح واتساب للإرسال 📲');
}

function renderPersonTab() {
  renderPersonSidebar();
  renderPersonSheet();
}

// ============================================================================
// TAB 4: Annual & Multi-Month Report (التقرير السنوي وتجميع الشهور)
// ============================================================================

function renderAnnualTab() {
  let mFrom = Number(state.annualFromMonth) || 1;
  let mTo = Number(state.annualToMonth) || 12;
  if (mFrom > mTo) {
    const tmp = mFrom;
    mFrom = mTo;
    mTo = tmp;
  }

  const elFrom = document.getElementById('annualFromMonth');
  const elTo = document.getElementById('annualToMonth');
  const elType = document.getElementById('annualDataType');
  if (elFrom) elFrom.value = String(mFrom);
  if (elTo) elTo.value = String(mTo);
  if (elType) elType.value = state.annualDataType || 'cash';

  const annualYearEl = document.getElementById('annualYearLabel');
  if (annualYearEl) annualYearEl.textContent = String(state.year);

  const monthsRange = [];
  for (let m = mFrom; m <= mTo; m++) {
    monthsRange.push(m);
  }

  const isInv = state.annualDataType === 'invoices';

  const monthSummary = {};
  let grandReceivedCents = 0;
  let grandDistributedCents = 0;
  let grandInvoicesCents = 0;

  monthsRange.forEach(m => {
    const daysCount = getDaysInMonth(state.year, m);
    let recCents = 0;
    let distCents = 0;
    let invCents = 0;
    for (let d = 1; d <= daysCount; d++) {
      const dt = getDayTotals(formatDateKey(state.year, m, d));
      recCents += toCents(dt.received);
      distCents += toCents(dt.distributed);
      invCents += toCents(dt.invoices);
    }
    monthSummary[m] = { rec: fromCents(recCents), dist: fromCents(distCents), inv: fromCents(invCents) };
    grandReceivedCents += recCents;
    grandDistributedCents += distCents;
    grandInvoicesCents += invCents;
  });

  const grandReceived = fromCents(grandReceivedCents);
  const grandDistributed = fromCents(grandDistributedCents);
  const grandInvoices = fromCents(grandInvoicesCents);

  document.getElementById('annualTotalReceived').textContent = formatNumber(grandReceived);
  document.getElementById('annualTotalDistributed').textContent = formatNumber(grandDistributed);
  document.getElementById('annualTotalInvoices').textContent = formatNumber(grandInvoices);

  const thead = document.getElementById('annualMatrixHead');
  let headHtml = `
    <tr>
      <th class="sticky-col"># / الاسم</th>
      <th>الفئة</th>
  `;
  monthsRange.forEach(m => {
    headHtml += `<th>${ARABIC_MONTHS[m]}</th>`;
  });
  headHtml += `
      <th style="background:#dcfce7; color:#14532d;">توتال الفلوس بالفترة</th>
      <th style="background:#ede9fe; color:#4c1d95;">توتال الفواتير بالفترة</th>
    </tr>
  `;
  thead.innerHTML = headHtml;

  const tbody = document.getElementById('annualMatrixBody');
  let bodyHtml = `
    <tr class="matrix-received-row">
      <td class="sticky-col" style="background:#ecfdf5;">💵 توتال المستلم بالشهر</td>
      <td>الوارد</td>
  `;
  monthsRange.forEach(m => {
    const val = monthSummary[m].rec;
    bodyHtml += `<td>${val > 0 ? formatNumber(val) : '-'}</td>`;
  });
  bodyHtml += `
      <td><strong>${formatNumber(grandReceived)}</strong></td>
      <td>-</td>
    </tr>
    <tr class="matrix-distributed-row">
      <td class="sticky-col" style="background:#eff6ff;">📤 توتال الموزع بالشهر</td>
      <td>المنصرف</td>
  `;
  monthsRange.forEach(m => {
    const val = monthSummary[m].dist;
    bodyHtml += `<td>${val > 0 ? formatNumber(val) : '-'}</td>`;
  });
  bodyHtml += `
      <td><strong>${formatNumber(grandDistributed)}</strong></td>
      <td><strong>${formatNumber(grandInvoices)}</strong></td>
    </tr>
  `;

  const annualPeople = getReportablePeople(state.year);

  if (annualPeople.length === 0) {
    const colSpan = monthsRange.length + 4;
    bodyHtml += `
      <tr>
        <td colspan="${colSpan}" style="text-align:center; padding:30px; color:var(--text-muted);">
          لا يوجد أشخاص أو سائقين مسجلين لهذه السنة حتى الآن
        </td>
      </tr>
    `;
  } else {
    annualPeople.forEach(person => {
      const dispName = getPersonDisplayName(person);
      let pGrandCashCents = 0;
      let pGrandInvCents = 0;

      let rowCells = '';
      monthsRange.forEach(m => {
        const mt = getPersonMonthTotals(person.id, state.year, m);
        pGrandCashCents += toCents(mt.cash);
        pGrandInvCents += toCents(mt.invoice);
        const val = isInv ? mt.invoice : mt.cash;
        rowCells += `<td>${val > 0 ? `<strong>${formatNumber(val)}</strong>` : '-'}</td>`;
      });

      bodyHtml += `
        <tr>
          <td class="sticky-col">
            <a href="javascript:void(0)" data-open-person="${person.id}" style="font-weight:700; color:var(--text-main); text-decoration:none;">
              ${person.num}. ${escapeHtml(dispName)}
            </a>
          </td>
          <td>
            <span class="role-badge ${person.role}">
              ${person.role === 'driver' ? 'سائق' : 'ستاف'}
            </span>
          </td>
          ${rowCells}
          <td style="background:#f0fdf4; font-weight:800; color:var(--green);">${formatNumber(fromCents(pGrandCashCents))}</td>
          <td style="background:#faf5ff; font-weight:800; color:var(--purple);">${formatNumber(fromCents(pGrandInvCents))}</td>
        </tr>
      `;
    });
  }

  tbody.innerHTML = bodyHtml;

  const tfoot = document.getElementById('annualMatrixFoot');
  let footHtml = `
    <tr class="totals-row">
      <td class="sticky-col" style="background:#0f172a; color:#fff;">التوتال العام للشهور</td>
      <td>الكل</td>
  `;
  monthsRange.forEach(m => {
    const val = isInv ? monthSummary[m].inv : monthSummary[m].dist;
    footHtml += `<td>${val > 0 ? formatNumber(val) : '-'}</td>`;
  });
  footHtml += `
      <td style="background:#15803d; color:#fff; font-weight:800;">${formatNumber(grandDistributed)}</td>
      <td style="background:#6d28d9; color:#fff; font-weight:800;">${formatNumber(grandInvoices)}</td>
    </tr>
  `;
  tfoot.innerHTML = footHtml;

  tbody.querySelectorAll('[data-open-person]').forEach(el => {
    el.addEventListener('click', () => {
      state.personSelectedMonth = 'all';
      switchTab('person');
      openPersonLedgerPage(el.getAttribute('data-open-person'));
    });
  });
}

// TAB 5: People Management (إدارة الأسماء)
// ============================================================================

function renderPeopleManagementTab() {
  const tbody = document.getElementById('peopleManagementTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const allPeople = state.data.people || [];

  // Update counter badges
  const countAll = allPeople.length;
  const countActivePeople = allPeople.filter(p => !p.archived).length;
  const countArchived = allPeople.filter(p => !!p.archived).length;
  const countDrivers = allPeople.filter(p => !p.archived && p.role === 'driver').length;
  const countStaff = allPeople.filter(p => !p.archived && p.role === 'staff').length;
  const countActiveBalance = allPeople.filter(p => hasPersonAnyEntryInYear(p.id, state.year)).length;

  const countAllEl = document.getElementById('pmCountAll');
  if (countAllEl) countAllEl.textContent = countAll;
  const countActPeopleEl = document.getElementById('pmCountActivePeople');
  if (countActPeopleEl) countActPeopleEl.textContent = countActivePeople;
  const countArchEl = document.getElementById('pmCountArchived');
  if (countArchEl) countArchEl.textContent = countArchived;
  const countDrvEl = document.getElementById('pmCountDrivers');
  if (countDrvEl) countDrvEl.textContent = countDrivers;
  const countStfEl = document.getElementById('pmCountStaff');
  if (countStfEl) countStfEl.textContent = countStaff;
  const countActEl = document.getElementById('pmCountActive');
  if (countActEl) countActEl.textContent = countActiveBalance;

  // Filter pills UI state
  document.querySelectorAll('#peopleManageFilterPills .pill').forEach(pill => {
    pill.classList.toggle('active', pill.getAttribute('data-pmfilter') === state.peopleManageFilter);
  });

  // Filter list
  let list = allPeople;
  if (state.peopleManageFilter === 'active_only') {
    list = list.filter(p => !p.archived);
  } else if (state.peopleManageFilter === 'archived') {
    list = list.filter(p => !!p.archived);
  } else if (state.peopleManageFilter === 'driver') {
    list = list.filter(p => !p.archived && p.role === 'driver');
  } else if (state.peopleManageFilter === 'staff') {
    list = list.filter(p => !p.archived && p.role === 'staff');
  } else if (state.peopleManageFilter === 'active') {
    list = list.filter(p => hasPersonAnyEntryInYear(p.id, state.year));
  }

  if (state.peopleManageSearch) {
    const q = state.peopleManageSearch.trim();
    list = list.filter(p =>
      matchArabicSearch(p.name, q) ||
      matchArabicSearch(p.meta, q) ||
      String(p.num) === q ||
      String(p.num).includes(q)
    );
  }

  if (list.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; padding: 32px; color: var(--text-muted);">
          ${state.peopleManageSearch ? 'لا توجد نتائج مطابقة لبحثك' : 'لا توجد أسماء مسجلة في هذا التصنيف حالياً.'}
        </td>
      </tr>
    `;
    return;
  }

  list.forEach(p => {
    const yTot = getPersonYearTotals(p.id, state.year);
    const hasHistory = hasPersonAnyEntryInHistory(p.id);
    let finBadge = '';
    if (yTot.cash === 0 && yTot.invoice === 0 && yTot.returnedCash === 0) {
      finBadge = `<span class="settlement-badge idle">لا توجد حركة</span>`;
    } else if (Math.abs(yTot.diff) < 0.001) {
      finBadge = `<span class="settlement-badge settled">خالص بالفواتير ✓</span>`;
    } else if (yTot.diff > 0) {
      finBadge = `<span class="settlement-badge owes">بعهدته: ${formatNumber(yTot.diff)} ر.ق</span>`;
    } else {
      finBadge = `<span class="settlement-badge credit">له فرق: ${formatNumber(Math.abs(yTot.diff))} ر.ق</span>`;
    }

    const tr = document.createElement('tr');
    if (p.archived) {
      tr.classList.add('archived-row');
    }

    const archiveBadgeHtml = p.archived
      ? `<span class="role-badge badge-archived">📦 مؤرشف</span>`
      : '';

    let actionButtonsHtml = '';
    if (p.archived) {
      actionButtonsHtml = `
        <button type="button" class="btn btn-sm btn-outline" data-open-person="${p.id}" title="فتح كشف حساب هذا الشخص">📄 صفحته</button>
        <button type="button" class="btn btn-sm btn-primary" data-unarchive-person="${p.id}" title="إلغاء الأرشفة واستعادة نشاطه في التسجيل اليومي">🔄 استعادة</button>
      `;
    } else if (hasHistory) {
      actionButtonsHtml = `
        <button type="button" class="btn btn-sm btn-outline" data-open-person="${p.id}" title="فتح صفحة هذا الشخص">📄 صفحته</button>
        <button type="button" class="btn btn-sm btn-outline text-amber" data-archive-person="${p.id}" title="أرشفة هذا الشخص مع الحفاظ التام على سجلاته ومعاملاته المالية">📦 أرشفة</button>
      `;
    } else {
      actionButtonsHtml = `
        <button type="button" class="btn btn-sm btn-outline" data-open-person="${p.id}" title="فتح صفحة هذا الشخص">📄 صفحته</button>
        <button type="button" class="btn btn-sm btn-outline text-amber" data-archive-person="${p.id}" title="أرشفة هذا الشخص">📦 أرشفة</button>
        <button type="button" class="btn btn-sm btn-danger-outline" data-del-person="${p.id}" title="حذف الخانة الفارغة نهائياً">🗑️</button>
      `;
    }

    tr.innerHTML = `
      <td><strong>#${p.num}</strong></td>
      <td>
        <div style="display: flex; align-items: center; gap: 6px;">
          <input
            type="text"
            class="input-control"
            style="width: 100%; font-weight: 700; ${p.archived ? 'text-decoration: line-through; color: var(--text-muted);' : ''}"
            placeholder="اسم رقم ${p.num}..."
            value="${escapeHtml(p.name || '')}"
            data-edit-pname="${p.id}"
          />
          ${archiveBadgeHtml}
        </div>
      </td>
      <td>
        <select class="select-control" data-edit-prole="${p.id}" style="width: 100%;">
          <option value="driver" ${p.role === 'driver' ? 'selected' : ''}>🚛 سائق</option>
          <option value="staff" ${p.role === 'staff' ? 'selected' : ''}>👔 ستاف</option>
        </select>
      </td>
      <td>
        <input
          type="text"
          class="input-control"
          style="width: 100%; font-size: 0.88rem;"
          placeholder="${p.role === 'driver' ? '🚗 رقم السيارة أو الشاحنة...' : '🏢 القسم أو الإدارة...'}"
          value="${escapeHtml(p.meta || '')}"
          data-edit-pmeta="${p.id}"
        />
      </td>
      <td>
        <div style="display: flex; flex-direction: column; gap: 3px;">
          ${finBadge}
          ${(yTot.cash > 0 || yTot.invoice > 0 || yTot.returnedCash > 0) ? `<small style="color:var(--text-muted); font-size:0.75rem;">(استلم: ${formatNumber(yTot.cash)} | فواتير: ${formatNumber(yTot.invoice)} | مرتجع: ${formatNumber(yTot.returnedCash)})</small>` : ''}
        </div>
      </td>
      <td class="no-print">
        <div style="display: flex; gap: 6px; flex-wrap: wrap;">
          ${actionButtonsHtml}
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Bind inline events
  tbody.querySelectorAll('[data-edit-pname]').forEach(inp => {
    inp.addEventListener('change', () => {
      const pid = inp.getAttribute('data-edit-pname');
      const p = state.data.people.find(item => item.id === pid);
      if (p) {
        p.name = inp.value.trim();
        saveState();
        showToast(`تم حفظ الاسم: ${getPersonDisplayName(p)}`);
      }
    });
  });

  tbody.querySelectorAll('[data-edit-pmeta]').forEach(inp => {
    inp.addEventListener('change', () => {
      const pid = inp.getAttribute('data-edit-pmeta');
      const p = state.data.people.find(item => item.id === pid);
      if (p) {
        p.meta = inp.value.trim();
        saveState();
        showToast(`تم حفظ البيانات لـ ${getPersonDisplayName(p)}`);
      }
    });
  });

  tbody.querySelectorAll('[data-edit-prole]').forEach(sel => {
    sel.addEventListener('change', () => {
      const pid = sel.getAttribute('data-edit-prole');
      const p = state.data.people.find(item => item.id === pid);
      if (p) {
        p.role = sel.value;
        saveState();
        renderPeopleManagementTab();
        showToast(`تم تحديث الفئة لـ ${getPersonDisplayName(p)}`);
      }
    });
  });

  tbody.querySelectorAll('[data-open-person]').forEach(btn => {
    btn.addEventListener('click', () => {
      openPersonLedgerPage(btn.getAttribute('data-open-person'));
    });
  });

  // Archive Handler (Mandatory protection of historical data)
  tbody.querySelectorAll('[data-archive-person]').forEach(btn => {
    btn.addEventListener('click', () => {
      const pid = btn.getAttribute('data-archive-person');
      const p = state.data.people.find(item => item.id === pid);
      if (!p) return;

      if (confirm(`هل تريد أرشفة "${getPersonDisplayName(p)}"\n\nالأرشفة تخفيه من شاشات التسجيل اليومي الجديدة مع الاحتفاظ التام بكافة معاملاته وفواتيره في التقارير التاريخية.`)) {
        archivePerson(pid);
        showToast(`تمت أرشفة ${getPersonDisplayName(p)} بنجاح مع الاحتفاظ بكافة سجلاته المالية 📦`);
      }
    });
  });

  // Unarchive / Reactivate Handler
  tbody.querySelectorAll('[data-unarchive-person]').forEach(btn => {
    btn.addEventListener('click', () => {
      const pid = btn.getAttribute('data-unarchive-person');
      const p = state.data.people.find(item => item.id === pid);
      if (!p) return;

      unarchivePerson(pid);
      showToast(`تمت استعادة وتنشيط ${getPersonDisplayName(p)} في جداول التسجيل اليومي بنجاح 🔄`);
    });
  });

  // Permanent Delete (Allowed ONLY if person has ZERO historical transactions)
  tbody.querySelectorAll('[data-del-person]').forEach(btn => {
    btn.addEventListener('click', () => {
      const pid = btn.getAttribute('data-del-person');
      const p = state.data.people.find(item => item.id === pid);
      if (!p) return;

      if (hasPersonAnyEntryInHistory(pid)) {
        alert(
          `⚠️ لا يمكن حذف "${getPersonDisplayName(p)}" نهائياً لوجود سجلات مالية مسجلة باسمه.\n\n` +
          `تم توجيهك لخيار الأرشفة (📦) للاحتفاظ بسلامة السجلات والمطابقة المالية التاريخية.`
        );
        p.archived = true;
        p.archivedAt = new Date().toISOString();
        saveState();
        renderAll();
        return;
      }

      if (confirm(`هل تريد حذف الخانة الفارغة "${getPersonDisplayName(p)}" نهائياً؟`)) {
        state.data.people = state.data.people.filter(item => item.id !== pid);
        if (state.selectedPersonId === pid) {
          state.selectedPersonId = state.data.people[0]?.id || null;
        }
        renumberPeople();
        saveState();
        renderAll();
        showToast('تم حذف الخانة بنجاح');
      }
    });
  });
}

// ============================================================================
// TAB 6: Company Petty Cash Custody Fund (عهدة الشركة ومطابقة الخزنة)
// ============================================================================

function renderCustodyTab() {
  const mRecList = getCustodyReceiptsForMonth(state.year, state.month);
  const yRecList = getCustodyReceiptsForYear(state.year);
  const monthReceived = mRecList.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  const yearReceived = yRecList.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

  const mSetList = getCustodySettlementsForMonth(state.year, state.month);
  const ySetList = getCustodySettlementsForYear(state.year);
  const monthSettled = mSetList.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
  const yearSettled = ySetList.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);

  // Decoupled Official Company Custody Balance (ما تم استلامه من الشركة ناقص ما سُلم لها من كشوف تصفية)
  const companyBalance = yearReceived - yearSettled;

  // Real Drawer Paper Cash Calculation (الخزنة الحقيقية في يد الوالد)
  // Inflows: Total company custody receipts + all daily receipts + all driver returned cash
  // Outflows: All cash advances distributed to drivers + all daily extra expenses
  let totalCustodyReceiptsAll = (state.data.custodyReceipts || []).reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  let totalDailyReceiptsAll = Object.values(state.data.dailyReceipts || {}).reduce((sum, v) => sum + (Number(v) || 0), 0);
  let totalReturnedCashAll = 0;
  let totalCashAdvancedAll = 0;
  let totalDailyExtrasAll = Object.values(state.data.dailyExtras || {}).reduce((sum, ex) => sum + (Number(ex.amount) || 0), 0);

  for (const dayEntries of Object.values(state.data.entries || {})) {
    if (dayEntries) {
      for (const e of Object.values(dayEntries)) {
        if (e) {
          totalCashAdvancedAll += (Number(e.cash) || 0);
          totalReturnedCashAll += (Number(e.returnedCash) || 0);
        }
      }
    }
  }

  // Prevent double-counting if company custody receipts are logged:
  // If custodyReceipts are present, the large fund is the source of drawer inflows.
  // Otherwise, fall back to daily recorded receipts.
  const drawerInflows = totalCustodyReceiptsAll > 0
    ? (totalCustodyReceiptsAll + totalReturnedCashAll)
    : (totalDailyReceiptsAll + totalReturnedCashAll);
  const drawerOutflows = totalCashAdvancedAll + totalDailyExtrasAll;
  const drawerCash = drawerInflows - drawerOutflows;

  // Update KPI Elements
  const yRecEl = document.getElementById('custodyYearReceived');
  if (yRecEl) yRecEl.textContent = `${formatNumber(yearReceived)} ر.ق`;
  const mRecSubEl = document.getElementById('custodyMonthReceivedSub');
  if (mRecSubEl) mRecSubEl.textContent = `حركة شهر ${ARABIC_MONTHS[state.month]}: ${formatNumber(monthReceived)} ر.ق`;

  const ySetEl = document.getElementById('custodyYearSettled');
  if (ySetEl) ySetEl.textContent = `${formatNumber(yearSettled)} ر.ق`;
  const mSetSubEl = document.getElementById('custodyMonthSettledSub');
  if (mSetSubEl) mSetSubEl.textContent = `حركة شهر ${ARABIC_MONTHS[state.month]}: ${formatNumber(monthSettled)} ر.ق`;

  const compBalEl = document.getElementById('custodyCompanyBalance');
  const compStatEl = document.getElementById('custodyCompanyStatus');
  if (compBalEl) {
    compBalEl.textContent = `${formatNumber(companyBalance)} ر.ق`;
    if (Math.abs(companyBalance) < 0.001) {
      compBalEl.className = 'kpi-value text-green';
      if (compStatEl) {
        compStatEl.textContent = 'خالصة ومسواة بالكامل مع الشركة ✓';
        compStatEl.className = 'kpi-sub-split text-green';
      }
    } else if (companyBalance > 0) {
      compBalEl.className = 'kpi-value text-amber';
      if (compStatEl) {
        compStatEl.textContent = `متبقي بذمتنا لصالح الشركة: ${formatNumber(companyBalance)} ر.ق`;
        compStatEl.className = 'kpi-sub-split text-amber';
      }
    } else {
      compBalEl.className = 'kpi-value text-blue';
      if (compStatEl) {
        compStatEl.textContent = `فواتيرنا تتجاوز المستلم: مطلوب استعاضة ${formatNumber(Math.abs(companyBalance))} ر.ق`;
        compStatEl.className = 'kpi-sub-split text-blue';
      }
    }
  }

  const drawerEl = document.getElementById('custodyDrawerCash');
  const drawerSubEl = document.getElementById('custodyDrawerCashSub');
  if (drawerEl) {
    drawerEl.textContent = `${formatNumber(drawerCash)} ر.ق`;
    if (drawerCash >= 0) {
      drawerEl.className = 'kpi-value text-blue';
      if (drawerSubEl) drawerSubEl.textContent = `فائض نقدي متاح بالخزنة: +${formatNumber(drawerCash)} ر.ق`;
    } else {
      drawerEl.className = 'kpi-value text-danger';
      if (drawerSubEl) drawerSubEl.textContent = `عجز نقدي بالخزنة: -${formatNumber(Math.abs(drawerCash))} ر.ق`;
    }
  }

  // Set default dates if empty
  const receiptDateInput = document.getElementById('custodyReceiptDate');
  if (receiptDateInput && !receiptDateInput.value) {
    receiptDateInput.value = state.selectedDate;
  }
  const settDateInput = document.getElementById('custodySettlementDate');
  if (settDateInput && !settDateInput.value) {
    settDateInput.value = state.selectedDate;
  }
  const settPeriodInput = document.getElementById('custodySettlementPeriod');
  if (settPeriodInput && !settPeriodInput.value) {
    settPeriodInput.value = `فواتير شهر ${ARABIC_MONTHS[state.month]} ${state.year}`;
  }

  // 1-Click Helper: Auto-fill monthly driver invoices into settlement form with Duplicate Protection
  const btnAutoFill = document.getElementById('btnAutoFillMonthInvoices');
  if (btnAutoFill && !btnAutoFill._bound) {
    btnAutoFill._bound = true;
    btnAutoFill.addEventListener('click', () => {
      const summary = getPeriodSettlementSummary(state.year, state.month, 'custody');
      const amtInput = document.getElementById('custodySettlementAmount');
      const perInput = document.getElementById('custodySettlementPeriod');
      const noteInput = document.getElementById('custodySettlementNote');

      if (summary.isFullySettled) {
        const prevDate = summary.settlements[0]?.date || 'سابقاً';
        const prevRef = summary.settlements[0]?.ref || '-';
        alert(
          `⚠️ تنبيه منع الازدواجية والتكرار:\n\n` +
          `فواتير شهر ${summary.periodName} تم تسليمها وتسويتها للشركة مسبقاً بمبلغ (${formatNumber(summary.totalSettled)} ر.ق) بتاريخ ${prevDate} (مرجع: ${prevRef}).\n` +
          `إجمالي فواتير الشهر الحالي: ${formatNumber(summary.currentDriverInvoices)} ر.ق.\n` +
          `لا توجد فواتير متبقية غير مسواة لهذا الشهر.\n\n` +
          `إذا كان لديك كشف تكميلي إضافي، يمكنك إدخال المبلغ يدوياً.`
        );
        return;
      }

      if (summary.hasPartialSettlement) {
        if (confirm(
          `💡 تنبيه - فواتير جديدة بعد التسوية السابقة:\n\n` +
          `تم تسليم كشف للشركة سابقاً بمبلغ (${formatNumber(summary.totalSettled)} ر.ق) لهذا الشهر.\n` +
          `إجمالي الفواتير الآن (${formatNumber(summary.currentDriverInvoices)} ر.ق).\n` +
          `الفرق المتبقي غير المسوى: (${formatNumber(summary.unSettledDiff)} ر.ق).\n\n` +
          `هل تريد تعبئة فارق الفواتير المتبقي (${formatNumber(summary.unSettledDiff)} ر.ق) ككشف تكميلي؟`
        )) {
          if (amtInput) amtInput.value = summary.unSettledDiff;
          if (perInput) perInput.value = `كشف تكميلي - فواتير شهر ${ARABIC_MONTHS[state.month]} ${state.year}`;
          if (noteInput && !noteInput.value) noteInput.value = `تسوية تكميلية لفارق فواتير شهر ${ARABIC_MONTHS[state.month]} ${state.year} (متبقي من أصل ${formatNumber(summary.currentDriverInvoices)})`;
          showToast(`تم سحب فارق الفواتير المتبقي (${formatNumber(summary.unSettledDiff)} ر.ق) بنجاح ⚡`);
          return;
        }
        return;
      }

      if (amtInput) amtInput.value = summary.currentDriverInvoices;
      if (perInput) perInput.value = `فواتير شهر ${ARABIC_MONTHS[state.month]} ${state.year}`;
      if (noteInput && !noteInput.value) noteInput.value = `تسوية فواتير سيارات وسائقي شهر ${ARABIC_MONTHS[state.month]} ${state.year}`;
      showToast(`تم سحب إجمالي فواتير شهر ${ARABIC_MONTHS[state.month]} (${formatNumber(summary.currentDriverInvoices)} ر.ق) بنجاح ⚡`);
    });
  }

  // Render Table 1: Company Custody Receipts
  const tbodyReceipts = document.getElementById('custodyReceiptsBody');
  if (tbodyReceipts) {
    tbodyReceipts.innerHTML = '';
    const sortedYearReceipts = [...yRecList].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    if (sortedYearReceipts.length === 0) {
      tbodyReceipts.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; padding: 24px; color: var(--text-muted);">
            لم يتم تسجيل دفعات عهدة مستلمة من الشركة في سنة ${state.year} حتى الآن. أضف الدفعة الأولى من النموذج أعلاه.
          </td>
        </tr>
      `;
    } else {
      sortedYearReceipts.forEach((r, idx) => {
        const { m } = parseDateParts(r.date);
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${idx + 1}</strong></td>
          <td><strong>${r.date}</strong></td>
          <td>${ARABIC_MONTHS[m]}</td>
          <td style="font-weight: 800; color: var(--green);">${formatNumber(r.amount)} ر.ق</td>
          <td>${escapeHtml(r.ref) || '-'}</td>
          <td>${escapeHtml(r.note) || '-'}</td>
          <td class="no-print">
            <div style="display:flex; gap:6px; justify-content:center;">
              <button type="button" class="btn btn-sm btn-outline" data-edit-custody="${r.id}" title="تعديل هذه الدفعة">✏️</button>
              <button type="button" class="btn btn-sm btn-danger-outline" data-del-custody="${r.id}" title="حذف الدفعة">🗑️</button>
            </div>
          </td>
        `;
        tbodyReceipts.appendChild(tr);
      });

      tbodyReceipts.querySelectorAll('[data-edit-custody]').forEach(btn => {
        btn.addEventListener('click', () => {
          const cid = btn.getAttribute('data-edit-custody');
          const r = (state.data.custodyReceipts || []).find(item => item.id === cid);
          if (!r) return;
          state.editingCustodyReceiptId = cid;
          document.getElementById('custodyReceiptDate').value = r.date || state.selectedDate;
          document.getElementById('custodyReceiptAmount').value = r.amount;
          document.getElementById('custodyReceiptRef').value = r.ref || '';
          document.getElementById('custodyReceiptNote').value = r.note || '';

          const btnAdd = document.getElementById('btnAddCustodyReceipt');
          if (btnAdd) {
            btnAdd.textContent = '💾 حفظ تعديل دفعة العهدة';
            btnAdd.className = 'btn btn-primary';
          }
          const btnCancel = document.getElementById('btnCancelEditCustodyReceipt');
          if (btnCancel) btnCancel.classList.remove('hidden');

          document.getElementById('custodyReceiptAmount').scrollIntoView({ behavior: 'smooth', block: 'center' });
          document.getElementById('custodyReceiptAmount').focus();
        });
      });

      tbodyReceipts.querySelectorAll('[data-del-custody]').forEach(btn => {
        btn.addEventListener('click', () => {
          const cid = btn.getAttribute('data-del-custody');
          if (confirm('هل أنت متأكد من حذف هذه الدفعة من سجل العهدة المستلمة؟')) {
            state.data.custodyReceipts = (state.data.custodyReceipts || []).filter(item => item.id !== cid);
            if (state.editingCustodyReceiptId === cid) {
              state.editingCustodyReceiptId = null;
              const btnAdd = document.getElementById('btnAddCustodyReceipt');
              if (btnAdd) {
                btnAdd.textContent = '➕ إضافة دفعة العهدة';
                btnAdd.className = 'btn btn-success';
              }
              const btnCancel = document.getElementById('btnCancelEditCustodyReceipt');
              if (btnCancel) btnCancel.classList.add('hidden');
            }
            saveState();
            renderCustodyTab();
            showToast('تم حذف الدفعة بنجاح');
          }
        });
      });
    }

    const footTotalEl = document.getElementById('footCustodyTotal');
    if (footTotalEl) footTotalEl.textContent = `${formatNumber(yearReceived)} ر.ق`;
  }

  // Render Table 2: Company Custody Settlements (Invoices Submitted)
  const tbodySettlements = document.getElementById('custodySettlementsBody');
  if (tbodySettlements) {
    tbodySettlements.innerHTML = '';
    const sortedYearSettlements = [...ySetList].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    if (sortedYearSettlements.length === 0) {
      tbodySettlements.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; padding: 24px; color: var(--text-muted);">
            لم يتم تسجيل كشوف فواتير مسلمة للشركة لتسوية العهدة في سنة ${state.year} حتى الآن. سجل كشف التصفية من النموذج أعلاه.
          </td>
        </tr>
      `;
    } else {
      sortedYearSettlements.forEach((s, idx) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${idx + 1}</strong></td>
          <td><strong>${s.date}</strong></td>
          <td><strong>${escapeHtml(s.period) || '-'}</strong></td>
          <td style="font-weight: 800; color: var(--purple);">${formatNumber(s.amount)} ر.ق</td>
          <td>${escapeHtml(s.ref) || '-'}</td>
          <td>${escapeHtml(s.note) || '-'}</td>
          <td class="no-print">
            <div style="display:flex; gap:6px; justify-content:center;">
              <button type="button" class="btn btn-sm btn-outline" data-edit-settlement="${s.id}" title="تعديل كشف التصفية">✏️</button>
              <button type="button" class="btn btn-sm btn-danger-outline" data-del-settlement="${s.id}" title="حذف كشف التصفية">🗑️</button>
            </div>
          </td>
        `;
        tbodySettlements.appendChild(tr);
      });

      tbodySettlements.querySelectorAll('[data-edit-settlement]').forEach(btn => {
        btn.addEventListener('click', () => {
          const sid = btn.getAttribute('data-edit-settlement');
          const s = (state.data.custodySettlements || []).find(item => item.id === sid);
          if (!s) return;
          state.editingCustodySettlementId = sid;
          document.getElementById('custodySettlementDate').value = s.date || state.selectedDate;
          document.getElementById('custodySettlementAmount').value = s.amount;
          document.getElementById('custodySettlementPeriod').value = s.period || '';
          document.getElementById('custodySettlementRef').value = s.ref || '';
          document.getElementById('custodySettlementNote').value = s.note || '';

          const btnAdd = document.getElementById('btnAddCustodySettlement');
          if (btnAdd) {
            btnAdd.textContent = '💾 حفظ تعديل كشف التصفية';
            btnAdd.className = 'btn btn-primary';
          }
          const btnCancel = document.getElementById('btnCancelEditCustodySettlement');
          if (btnCancel) btnCancel.classList.remove('hidden');

          document.getElementById('custodySettlementAmount').scrollIntoView({ behavior: 'smooth', block: 'center' });
          document.getElementById('custodySettlementAmount').focus();
        });
      });

      tbodySettlements.querySelectorAll('[data-del-settlement]').forEach(btn => {
        btn.addEventListener('click', () => {
          const sid = btn.getAttribute('data-del-settlement');
          if (confirm('هل أنت متأكد من حذف كشف التصفية هذا المسلم للشركة؟')) {
            state.data.custodySettlements = (state.data.custodySettlements || []).filter(item => item.id !== sid);
            if (state.editingCustodySettlementId === sid) {
              state.editingCustodySettlementId = null;
              const btnAdd = document.getElementById('btnAddCustodySettlement');
              if (btnAdd) {
                btnAdd.textContent = '📑 حفظ كشف التصفية للشركة';
                btnAdd.className = 'btn btn-primary';
              }
              const btnCancel = document.getElementById('btnCancelEditCustodySettlement');
              if (btnCancel) btnCancel.classList.add('hidden');
            }
            saveState();
            renderCustodyTab();
            showToast('تم حذف كشف التصفية بنجاح');
          }
        });
      });
    }

    const footSetTotEl = document.getElementById('footCustodySettlementsTotal');
    if (footSetTotEl) footSetTotEl.textContent = `${formatNumber(yearSettled)} ر.ق`;
  }

  // Render Table 3: Drivers Pending Balances
  const tbodyDrivers = document.getElementById('custodyDriversSummaryBody');
  if (tbodyDrivers) {
    tbodyDrivers.innerHTML = '';
    const driverSummaryList = [];

    state.data.people.forEach(p => {
      const mTot = getPersonMonthTotals(p.id, state.year, state.month);
      if (mTot.cash > 0 || mTot.invoice > 0 || mTot.returnedCash > 0) {
        driverSummaryList.push({
          person: p,
          cash: mTot.cash,
          invoice: mTot.invoice,
          returnedCash: mTot.returnedCash,
          diff: mTot.diff
        });
      }
    });

    if (driverSummaryList.length === 0) {
      tbodyDrivers.innerHTML = `
        <tr>
          <td colspan="9" style="text-align: center; padding: 24px; color: var(--text-muted);">
            لا توجد حركات عهدة أو فواتير مسجلة للسائقين في شهر ${ARABIC_MONTHS[state.month]} ${state.year}.
          </td>
        </tr>
      `;
    } else {
      driverSummaryList.sort((a, b) => b.diff - a.diff);

      driverSummaryList.forEach((item, idx) => {
        const badgeHtml = getSettlementBadgeHtml(item.cash, item.invoice, item.returnedCash);

        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${idx + 1}</strong></td>
          <td><strong>${escapeHtml(getPersonDisplayName(item.person))}</strong> ${item.person.meta ? `<small class="text-muted">(${escapeHtml(item.person.meta)})</small>` : ''}</td>
          <td><span class="role-badge ${item.person.role}">${item.person.role === 'driver' ? 'سائق' : 'ستاف'}</span></td>
          <td class="col-cash-cell">${formatNumber(item.cash)}</td>
          <td class="col-inv-cell">${formatNumber(item.invoice)}</td>
          <td class="col-ret-cell">${formatNumber(item.returnedCash)}</td>
          <td style="font-weight: 800; font-size: 1.02rem;">
            ${item.diff > 0.001 ? `<span class="text-amber">+${formatNumber(item.diff)} ر.ق</span>` : (item.diff < -0.001 ? `<span class="text-blue">-${formatNumber(Math.abs(item.diff))} ر.ق</span>` : '<span class="text-green">0.00 ر.ق</span>')}
          </td>
          <td>${badgeHtml}</td>
          <td class="no-print">
            <button type="button" class="btn btn-sm btn-outline" data-open-person="${item.person.id}">📄 صفحته</button>
          </td>
        `;
        tbodyDrivers.appendChild(tr);
      });

      tbodyDrivers.querySelectorAll('[data-open-person]').forEach(btn => {
        btn.addEventListener('click', () => {
          openPersonLedgerPage(btn.getAttribute('data-open-person'));
        });
      });
    }
  }
}

// ============================================================================
// TAB 7: My Transactions with the Treasury / Safe (معاملاتي مع الخزنة)
// ============================================================================

function getSafeTabFinancials(targetYear, targetMonth, isYearScope) {
  // 1. Period Movement
  let periodWithdrawalCents = 0;
  const withdrawalsList = [];
  const startM = isYearScope ? 1 : targetMonth;
  const endM = isYearScope ? 12 : targetMonth;

  for (let m = startM; m <= endM; m++) {
    const daysCount = getDaysInMonth(targetYear, m);
    for (let d = 1; d <= daysCount; d++) {
      const dk = formatDateKey(targetYear, m, d);
      const rec = getDayReceived(dk);
      if (rec > 0) {
        periodWithdrawalCents += toCents(rec);
        const dt = new Date(targetYear, m - 1, d);
        const dayName = ARABIC_DAYS[dt.getDay()];
        const totals = getDayTotals(dk);

        const dayEntries = state.data.entries[dk] || {};
        const recipients = [];
        for (const [pid, entry] of Object.entries(dayEntries)) {
          const cashVal = Number(entry.cash) || 0;
          if (cashVal > 0) {
            const p = state.data.people.find(person => person.id === pid);
            const pName = p ? getPersonDisplayName(p) : 'شخص';
            recipients.push(`${pName} (${formatNumber(cashVal)})`);
          }
        }

        withdrawalsList.push({
          date: dk,
          dayName,
          amount: rec,
          distributed: totals.distributed,
          extraAmount: totals.extraAmount,
          extraNote: totals.extraNote,
          remaining: totals.remaining,
          returnedCashTotal: totals.returnedCashTotal,
          recipientsSummary: recipients.join('، ')
        });
      }
    }
  }

  const prefix = isYearScope 
    ? `${targetYear}-` 
    : `${targetYear}-${String(targetMonth).padStart(2, '0')}`;

  const allPeriodInvoicesList = (state.data.safeInvoices || []).filter(r => r && r.date && r.date.startsWith(prefix));
  const periodInvoicesList = allPeriodInvoicesList.filter(r => r.status !== 'reversed');

  let periodInvoiceCents = 0;
  periodInvoicesList.forEach(inv => {
    periodInvoiceCents += toCents(inv.amount);
  });

  const periodWithdrawn = fromCents(periodWithdrawalCents);
  const periodInvoices = fromCents(periodInvoiceCents);
  const periodNet = fromCents(periodWithdrawalCents - periodInvoiceCents);

  // 2. Historical Cumulative Balance (up to end of selected period)
  const periodEndDate = isYearScope
    ? `${targetYear}-12-31`
    : formatDateKey(targetYear, targetMonth, getDaysInMonth(targetYear, targetMonth));

  const periodStartDate = isYearScope
    ? `${targetYear}-01-01`
    : formatDateKey(targetYear, targetMonth, 1);

  // Prior Opening Balance strictly before this period
  let priorWithdrawalCents = 0;
  for (const [dk, amt] of Object.entries(state.data.dailyReceipts || {})) {
    if (dk < periodStartDate) {
      priorWithdrawalCents += toCents(amt);
    }
  }

  let priorInvoiceCents = 0;
  (state.data.safeInvoices || []).forEach(inv => {
    if (inv && inv.status !== 'reversed' && inv.date && inv.date < periodStartDate) {
      priorInvoiceCents += toCents(inv.amount);
    }
  });

  const priorOpeningBalance = fromCents(priorWithdrawalCents - priorInvoiceCents);

  // Cumulative up to periodEndDate
  let cumulativeWithdrawalCents = 0;
  for (const [dk, amt] of Object.entries(state.data.dailyReceipts || {})) {
    if (dk <= periodEndDate) {
      cumulativeWithdrawalCents += toCents(amt);
    }
  }

  let cumulativeInvoiceCents = 0;
  (state.data.safeInvoices || []).forEach(inv => {
    if (inv && inv.status !== 'reversed' && inv.date && inv.date <= periodEndDate) {
      cumulativeInvoiceCents += toCents(inv.amount);
    }
  });

  const cumulativeWithdrawn = fromCents(cumulativeWithdrawalCents);
  const cumulativeInvoices = fromCents(cumulativeInvoiceCents);
  const cumulativeNet = fromCents(cumulativeWithdrawalCents - cumulativeInvoiceCents);

  return {
    periodWithdrawn,
    periodInvoices,
    periodNet,
    priorOpeningBalance,
    cumulativeWithdrawn,
    cumulativeInvoices,
    cumulativeNet,
    periodMovement: {
      withdrawn: periodWithdrawn,
      invoices: periodInvoices,
      netBalance: periodNet
    },
    cumulativeRunning: {
      priorOpeningBalance,
      cumulativeWithdrawn,
      cumulativeInvoices,
      cumulativeNetBalance: cumulativeNet
    },
    withdrawalsList,
    periodInvoicesList,
    allPeriodInvoicesList,
    periodStartDate,
    periodEndDate
  };
}

function renderSafeTab() {
  if (typeof document === 'undefined') return;
  const targetYear = state.year;
  const isYearScope = !!state.safeShowYear;
  const targetMonth = state.safeMonth || state.month;

  // Sync inputs
  const safeMonthSelect = document.getElementById('safeMonthSelect');
  if (safeMonthSelect) {
    safeMonthSelect.value = String(targetMonth);
    safeMonthSelect.disabled = isYearScope;
  }
  const chkSafeYear = document.getElementById('chkSafeShowYear');
  if (chkSafeYear) {
    chkSafeYear.checked = isYearScope;
  }

  // Update scope labels
  const scopeText = isYearScope 
    ? `سنة ${targetYear}` 
    : `شهر ${ARABIC_MONTHS[targetMonth]} ${targetYear}`;

  const wScopeEl = document.getElementById('safeWithdrawalsScope');
  if (wScopeEl) wScopeEl.textContent = scopeText;
  const iScopeEl = document.getElementById('safeInvoicesScope');
  if (iScopeEl) iScopeEl.textContent = scopeText;

  // Auto-fill button label
  const curMonthLabels = document.querySelectorAll('#tab-safe .current-month-label');
  curMonthLabels.forEach(el => {
    el.textContent = ARABIC_MONTHS[targetMonth];
  });

  // Set default date for invoice input if empty
  const safeInvoiceDate = document.getElementById('safeInvoiceDate');
  if (safeInvoiceDate && !safeInvoiceDate.value) {
    safeInvoiceDate.value = state.selectedDate;
  }

  // Calculate Dual Financial Views
  const fin = getSafeTabFinancials(targetYear, targetMonth, isYearScope);

  // 1. Update Selected Period KPIs
  const wTotalEl = document.getElementById('safeWithdrawnTotal');
  if (wTotalEl) wTotalEl.textContent = `${formatNumber(fin.periodWithdrawn)} ر.ق`;
  const wSubEl = document.getElementById('safeWithdrawnSub');
  if (wSubEl) wSubEl.textContent = `سحوبات ${scopeText}`;

  const iTotalEl = document.getElementById('safeInvoicesTotal');
  if (iTotalEl) iTotalEl.textContent = `${formatNumber(fin.periodInvoices)} ر.ق`;
  const iSubEl = document.getElementById('safeInvoicesSub');
  if (iSubEl) iSubEl.textContent = `فواتير مسلّمة في ${scopeText}`;

  const netBalEl = document.getElementById('safeNetBalance');
  const netStatEl = document.getElementById('safeNetStatus');
  if (netBalEl) {
    netBalEl.textContent = `${formatNumber(Math.abs(fin.periodNet))} ر.ق`;
    if (Math.abs(fin.periodNet) < 0.001) {
      netBalEl.className = 'kpi-value text-green';
      if (netStatEl) {
        netStatEl.textContent = 'خالص بالفواتير في هذه الفترة ✓';
        netStatEl.className = 'kpi-sub-split text-green';
      }
    } else if (fin.periodNet > 0) {
      netBalEl.className = 'kpi-value text-amber';
      if (netStatEl) {
        netStatEl.textContent = `سحوبات تزيد عن فواتير الفترة: ${formatNumber(fin.periodNet)} ر.ق`;
        netStatEl.className = 'kpi-sub-split text-amber';
      }
    } else {
      netBalEl.className = 'kpi-value text-blue';
      if (netStatEl) {
        netStatEl.textContent = `فواتير تزيد عن سحوبات الفترة: ${formatNumber(Math.abs(fin.periodNet))} ر.ق`;
        netStatEl.className = 'kpi-sub-split text-blue';
      }
    }
  }

  // 2. Update Historical Cumulative KPIs
  const priorOpenEl = document.getElementById('safePriorOpeningBalance');
  if (priorOpenEl) {
    priorOpenEl.textContent = `${fin.priorOpeningBalance > 0 ? '+' : ''}${formatNumber(fin.priorOpeningBalance)} ر.ق`;
    priorOpenEl.className = fin.priorOpeningBalance > 0 ? 'kpi-value text-amber' : (fin.priorOpeningBalance < 0 ? 'kpi-value text-blue' : 'kpi-value text-muted');
  }

  const cumWEl = document.getElementById('safeCumulativeWithdrawnTotal');
  if (cumWEl) cumWEl.textContent = `${formatNumber(fin.cumulativeWithdrawn)} ر.ق`;

  const cumIEl = document.getElementById('safeCumulativeInvoicesTotal');
  if (cumIEl) cumIEl.textContent = `${formatNumber(fin.cumulativeInvoices)} ر.ق`;

  const cumNetEl = document.getElementById('safeCumulativeNetBalance');
  const cumNetStatEl = document.getElementById('safeCumulativeNetStatus');
  if (cumNetEl) {
    cumNetEl.textContent = `${formatNumber(Math.abs(fin.cumulativeNet))} ر.ق`;
    if (Math.abs(fin.cumulativeNet) < 0.001) {
      cumNetEl.className = 'kpi-value text-green';
      if (cumNetStatEl) {
        cumNetStatEl.textContent = 'خالص ومصفى بالكامل مع الخزنة تاريخياً ✓';
        cumNetStatEl.className = 'kpi-sub-split text-green';
      }
    } else if (fin.cumulativeNet > 0) {
      cumNetEl.className = 'kpi-value text-amber';
      if (cumNetStatEl) {
        cumNetStatEl.textContent = `مطلوب منك تقديم فواتير بقيمة: ${formatNumber(fin.cumulativeNet)} ر.ق ⚠️`;
        cumNetStatEl.className = 'kpi-sub-split text-amber';
      }
    } else {
      cumNetEl.className = 'kpi-value text-blue';
      if (cumNetStatEl) {
        cumNetStatEl.textContent = `لك فائض فواتير لدى الخزنة: ${formatNumber(Math.abs(fin.cumulativeNet))} ر.ق ℹ️`;
        cumNetStatEl.className = 'kpi-sub-split text-blue';
      }
    }
  }

  // Render Table 1: Daily Withdrawals Body
  const tbodyWithdrawals = document.getElementById('safeWithdrawalsBody');
  if (tbodyWithdrawals) {
    tbodyWithdrawals.innerHTML = '';
    if (fin.withdrawalsList.length === 0) {
      tbodyWithdrawals.innerHTML = `
        <tr>
          <td colspan="5" style="text-align: center; padding: 24px; color: var(--text-muted);">
            لا توجد سحوبات نقدية مسجلة من الخزينة في ${scopeText}. (تظهر المبالغ تلقائياً مما تسجله في خانة "المستلم اليومي").
          </td>
        </tr>
      `;
    } else {
      fin.withdrawalsList.sort((a, b) => b.date.localeCompare(a.date));
      fin.withdrawalsList.forEach((w, idx) => {
        const tr = document.createElement('tr');
        
        let distBadge = '';
        if (w.distributed > 0) {
          distBadge += `<span style="display: inline-block; background: #e0f2fe; color: #0369a1; padding: 2px 8px; border-radius: 4px; font-weight: 700; font-size: 0.85rem; margin-left: 6px;">موزع سُلف: ${formatNumber(w.distributed)} ر.ق</span>`;
        }
        if (w.extraAmount > 0) {
          distBadge += `<span style="display: inline-block; background: #fef3c7; color: #b45309; padding: 2px 8px; border-radius: 4px; font-weight: 700; font-size: 0.85rem; margin-left: 6px;">مصروف جانبي: ${formatNumber(w.extraAmount)} ر.ق ${w.extraNote ? `(${escapeHtml(w.extraNote)})` : ''}</span>`;
        }
        if (w.returnedCashTotal > 0) {
          distBadge += `<span style="display: inline-block; background: #f0fdf4; color: #15803d; padding: 2px 8px; border-radius: 4px; font-weight: 700; font-size: 0.85rem; margin-left: 6px;">كاش مرتجع: ${formatNumber(w.returnedCashTotal)} ر.ق</span>`;
        }
        if (w.remaining !== 0) {
          const remColor = w.remaining > 0 ? '#15803d' : '#b91c1c';
          distBadge += `<span style="display: inline-block; background: #f1f5f9; color: ${remColor}; padding: 2px 8px; border-radius: 4px; font-weight: 700; font-size: 0.85rem;">المتبقي بالدرج: ${formatNumber(w.remaining)} ر.ق</span>`;
        }

        let recipientsHtml = '';
        if (w.recipientsSummary) {
          recipientsHtml = `<div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 4px;">👥 <strong>المستلمون:</strong> ${escapeHtml(w.recipientsSummary)}</div>`;
        }

        tr.innerHTML = `
          <td><strong>${idx + 1}</strong></td>
          <td><strong>${w.date}</strong></td>
          <td>${w.dayName}</td>
          <td style="font-weight: 800; color: var(--green); font-size: 1.05rem;">${formatNumber(w.amount)} ر.ق</td>
          <td>
            <div style="display: flex; flex-wrap: wrap; gap: 4px; align-items: center;">
              ${distBadge || '<span class="text-muted">لم يُوزع في هذا اليوم</span>'}
            </div>
            ${recipientsHtml}
          </td>
        `;
        tbodyWithdrawals.appendChild(tr);
      });
    }

    const footWithdrawalsEl = document.getElementById('footSafeWithdrawalsTotal');
    if (footWithdrawalsEl) footWithdrawalsEl.textContent = `${formatNumber(fin.periodWithdrawn)} ر.ق`;
  }

  // Render Table 2: Safe Invoices Body
  const tbodyInvoices = document.getElementById('safeInvoicesBody');
  if (tbodyInvoices) {
    tbodyInvoices.innerHTML = '';
    const sortedInvoices = [...(fin.allPeriodInvoicesList || fin.periodInvoicesList)].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    if (sortedInvoices.length === 0) {
      tbodyInvoices.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; padding: 24px; color: var(--text-muted);">
            لم يتم تسجيل فواتير مسلّمة للخزنة في ${scopeText}. يمكنك تسجيل الفواتير من النموذج أعلاه أو الضغط على زر "سحب فواتير سائقي شهر" لتعبئتها بضغطة زر واحدة ⚡.
          </td>
        </tr>
      `;
    } else {
      sortedInvoices.forEach((inv, idx) => {
        const isRev = inv.status === 'reversed';
        const tr = document.createElement('tr');
        if (isRev) {
          tr.style.background = '#fef2f2';
        }

        const amtDisplay = isRev
          ? `<del style="color: var(--text-muted); font-size: 0.95rem;">${formatNumber(inv.amount)} ر.ق</del> <span class="badge" style="background:#fee2e2; color:#991b1b; padding:2px 6px; border-radius:4px; font-size:0.75rem; margin-right:4px;">معكوسة ↩️</span>`
          : `<span style="font-weight: 800; color: var(--purple); font-size: 1.05rem;">${formatNumber(inv.amount)} ر.ق</span>`;

        const noteDisplay = isRev
          ? `<div>${escapeHtml(inv.note) || '-'}</div><div style="font-size:0.78rem; color:#b91c1c; margin-top:3px;">⚠️ عُكست: ${escapeHtml(inv.reversalReason || '')} (${inv.reversedAt ? inv.reversedAt.slice(0, 10) : ''})</div>`
          : (escapeHtml(inv.note) || '-');

        const actionsDisplay = isRev
          ? `<button type="button" class="btn btn-sm btn-outline text-danger" data-del-safe-inv="${inv.id}" title="حذف نهائي من السجل">🗑️</button>`
          : `
            <button type="button" class="btn btn-sm btn-outline" data-edit-safe-inv="${inv.id}" title="تعديل">✏️</button>
            <button type="button" class="btn btn-sm btn-outline text-warning" data-rev-safe-inv="${inv.id}" title="عكس الفاتورة مع التوثيق">↩️</button>
            <button type="button" class="btn btn-sm btn-outline text-danger" data-del-safe-inv="${inv.id}" title="حذف">🗑️</button>
          `;

        tr.innerHTML = `
          <td><strong>${idx + 1}</strong></td>
          <td><strong>${inv.date}</strong></td>
          <td>${amtDisplay}</td>
          <td>${escapeHtml(inv.ref) || '-'}</td>
          <td>${noteDisplay}</td>
          <td class="no-print">
            ${actionsDisplay}
          </td>
        `;
        tbodyInvoices.appendChild(tr);
      });

      // Bind Edit / Reverse / Delete buttons
      tbodyInvoices.querySelectorAll('[data-edit-safe-inv]').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-edit-safe-inv');
          const item = (state.data.safeInvoices || []).find(x => x.id === id);
          if (item) {
            state.editingSafeInvoiceId = item.id;
            document.getElementById('safeInvoiceDate').value = item.date;
            document.getElementById('safeInvoiceAmount').value = item.amount;
            document.getElementById('safeInvoiceRef').value = item.ref || '';
            document.getElementById('safeInvoiceNote').value = item.note || '';

            const btnAdd = document.getElementById('btnAddSafeInvoice');
            if (btnAdd) {
              btnAdd.textContent = '💾 حفظ تعديل الفاتورة';
              btnAdd.className = 'btn btn-primary';
            }
            const btnCancel = document.getElementById('btnCancelEditSafeInvoice');
            if (btnCancel) btnCancel.classList.remove('hidden');

            document.getElementById('safeInvoiceAmount').focus();
            showToast('وضع تعديل الفاتورة: عدّل المبالغ ثم اضغط حفظ');
          }
        });
      });

      tbodyInvoices.querySelectorAll('[data-rev-safe-inv]').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-rev-safe-inv');
          const reason = prompt('يرجى كتابة سبب عكس أو إلغاء هذه الفاتورة المسجلة للخزنة:', 'إلغاء فاتورة تسوية بطلب الإدارة');
          if (reason !== null && reason.trim() !== '') {
            reverseSafeInvoice(id, reason.trim());
            showToast('تم عكس الفاتورة وحفظها في سجل التدقيق بنجاح ↩️');
          }
        });
      });

      tbodyInvoices.querySelectorAll('[data-del-safe-inv]').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-del-safe-inv');
          if (confirm('هل أنت متأكد من حذف هذه الفاتورة المسلّمة للخزنة؟')) {
            deleteSafeInvoice(id);
            showToast('تم حذف الفاتورة بنجاح');
          }
        });
      });
    }

    const footInvoicesEl = document.getElementById('footSafeInvoicesTotal');
    if (footInvoicesEl) footInvoicesEl.textContent = `${formatNumber(fin.periodInvoices)} ر.ق`;
  }

  // Render Net Balance Summary Card Content
  const sumContentEl = document.getElementById('safeNetSummaryContent');
  if (sumContentEl) {
    const netClass = fin.cumulativeNet > 0 ? 'text-amber' : (fin.cumulativeNet < 0 ? 'text-blue' : 'text-green');
    let summaryHtml = `
      <div class="safe-net-grid">
        <div class="safe-net-card">
          <span class="safe-net-lbl">📥 سحوبات ${scopeText}:</span>
          <strong class="safe-net-val text-green">${formatNumber(fin.periodWithdrawn)} ر.ق</strong>
        </div>
        <div class="safe-net-card">
          <span class="safe-net-lbl">📤 فواتير ${scopeText}:</span>
          <strong class="safe-net-val text-purple">${formatNumber(fin.periodInvoices)} ر.ق</strong>
        </div>
        <div class="safe-net-card">
          <span class="safe-net-lbl">⏳ مرحّل من قبل هذه الفترة:</span>
          <strong class="safe-net-val text-muted">${fin.priorOpeningBalance > 0 ? '+' : ''}${formatNumber(fin.priorOpeningBalance)} ر.ق</strong>
        </div>
        <div class="safe-net-card safe-net-card-highlight">
          <span class="safe-net-lbl safe-net-lbl-highlight">⚖️ الصافي التراكمي الشامل المعلق:</span>
          <strong class="safe-net-val ${netClass}">
            ${formatNumber(Math.abs(fin.cumulativeNet))} ر.ق
          </strong>
        </div>
      </div>
    `;

    if (Math.abs(fin.cumulativeNet) < 0.001) {
      summaryHtml += `
        <div class="safe-net-message safe-net-msg-settled">
          ✅ ممتاز! حسابك مع الخزينة خالص ومصفى تماماً حتى نهاية ${scopeText}. الفواتير المسلّمة غطّت بالكامل جميع ما سحبته كاش عبر كافة الشهور.
        </div>
      `;
    } else if (fin.cumulativeNet > 0) {
      summaryHtml += `
        <div class="safe-net-message safe-net-msg-owed">
          ⚠️ موقف الحساب التراكمي: أنت سحبت كاش أكثر مما سلّمت فواتير. المتبقي بذمتك لتقديمه للخزينة حتى تاريخ ${scopeText} (سواء فواتير متبقية أو رد كاش) هو: <span class="safe-net-msg-highlight">${formatNumber(fin.cumulativeNet)} ر.ق</span>.
        </div>
      `;
    } else {
      summaryHtml += `
        <div class="safe-net-message safe-net-msg-credit">
          ℹ️ موقف الحساب التراكمي: الفواتير التي سلّمتها تتجاوز إجمالي ما سحبته كاش. لك رصيد مستحق لدى الخزنة أو استعاضة حتى تاريخ ${scopeText} بقيمة: <span class="safe-net-msg-highlight">${formatNumber(Math.abs(fin.cumulativeNet))} ر.ق</span>.
        </div>
      `;
    }

    sumContentEl.innerHTML = summaryHtml;
  }

  // Render Tab 7 Audit Trail (Modifications, Reversals, Deletions)
  const tbodyAudit = document.getElementById('safeAuditTrailBody');
  const badgeAudit = document.getElementById('safeAuditBadge');
  const auditList = state.data.safeInvoicesAudit || [];
  if (badgeAudit) badgeAudit.textContent = String(auditList.length);
  if (tbodyAudit) {
    tbodyAudit.innerHTML = '';
    if (auditList.length === 0) {
      tbodyAudit.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:16px; color:var(--text-muted);">لا توجد حركات تدقيق أو تعديلات مسجلة بعد في هذا السجل.</td></tr>`;
    } else {
      const sortedAudit = [...auditList].reverse();
      sortedAudit.forEach((item, idx) => {
        const tr = document.createElement('tr');
        let actionBadge = '';
        if (item.action === 'reversed') {
          actionBadge = '<span class="badge" style="background:#fee2e2; color:#991b1b; padding:2px 6px; border-radius:4px; font-weight:700;">معكوسة ↩️</span>';
        } else if (item.action === 'deleted') {
          actionBadge = '<span class="badge" style="background:#fef2f2; color:#dc2626; padding:2px 6px; border-radius:4px; font-weight:700;">محذوفة 🗑️</span>';
        } else if (item.action === 'edited') {
          actionBadge = '<span class="badge" style="background:#e0f2fe; color:#0369a1; padding:2px 6px; border-radius:4px; font-weight:700;">تعديل ✏️</span>';
        } else {
          actionBadge = `<span class="badge" style="background:#f1f5f9; color:#475569; padding:2px 6px; border-radius:4px; font-weight:700;">${escapeHtml(item.action || 'إجراء')}</span>`;
        }

        const amtNum = item.amount || (item.invoice && item.invoice.amount) || (item.updated && item.updated.amount);
        const amtDisplay = (amtNum !== undefined && amtNum !== null) ? `${formatNumber(amtNum)} ر.ق` : '-';
        const dateVal = (item.invoice && item.invoice.date) || (item.updated && item.updated.date) || item.periodKey || '-';
        const timeDisplay = item.timestamp ? new Date(item.timestamp).toLocaleString('ar-QA') : '-';
        const detailsDisplay = escapeHtml(item.reason || '') + (item.ref ? ` (مرجع: ${escapeHtml(item.ref)})` : '');

        tr.innerHTML = `
          <td><strong>${idx + 1}</strong></td>
          <td style="font-size:0.8rem; color:var(--text-muted);">${timeDisplay}</td>
          <td>${actionBadge}</td>
          <td style="font-weight:700;">${amtDisplay}</td>
          <td>${escapeHtml(dateVal)}</td>
          <td>${detailsDisplay}</td>
        `;
        tbodyAudit.appendChild(tr);
      });
    }
  }
}


// ============================================================================
// English Dates & Transliteration Dictionary
// ============================================================================
const ENGLISH_MONTHS = [
  '',
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];
const ENGLISH_DAYS = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'
];

function getEnglishDayName(y, m, d) {
  const dt = new Date(y, m - 1, d);
  return ENGLISH_DAYS[dt.getDay()];
}

function phoneticArabicToEnglish(arWord) {
  if (!arWord) return '';
  const charMap = {
    'ا': 'a', 'أ': 'a', 'إ': 'e', 'آ': 'aa', 'ء': '', 'ئ': 'e', 'ؤ': 'o',
    'ب': 'b', 'ت': 't', 'ث': 'th', 'ج': 'j', 'ح': 'h', 'خ': 'kh',
    'د': 'd', 'ذ': 'dh', 'ر': 'r', 'ز': 'z', 'س': 's', 'ش': 'sh',
    'ص': 's', 'ض': 'd', 'ط': 't', 'ظ': 'z', 'ع': 'a', 'غ': 'gh',
    'ف': 'f', 'ق': 'q', 'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n',
    'ه': 'h', 'و': 'w', 'ي': 'y', 'ى': 'a', 'ة': 'a'
  };
  let res = '';
  for (let i = 0; i < arWord.length; i++) {
    const ch = arWord[i];
    res += charMap[ch] !== undefined ? charMap[ch] : ch;
  }
  if (!res) return arWord;
  return res.charAt(0).toUpperCase() + res.slice(1);
}

function transliterateArabicNameToEnglish(arabicName) {
  if (!arabicName || typeof arabicName !== 'string') return '';
  let str = arabicName.trim();
  if (!str) return '';

  const compoundMap = {
    'عبد الله': 'Abdullah', 'عبدالله': 'Abdullah',
    'عبد الرحمن': 'Abdul Rahman', 'عبدالرحمن': 'Abdul Rahman',
    'عبد الرحيم': 'Abdul Raheem', 'عبدالرحيم': 'Abdul Raheem',
    'عبد العزيز': 'Abdul Aziz', 'عبدالعزيز': 'Abdul Aziz',
    'عبد السلام': 'Abdulsalam', 'عبدالسلام': 'Abdulsalam',
    'عبد الرشيد': 'Abdul Rashid', 'عبدالرشيد': 'Abdul Rashid',
    'عبد الكريم': 'Abdul Karim', 'عبدالكريم': 'Abdul Karim',
    'عبد المجيد': 'Abdul Majeed', 'عبدالمجيد': 'Abdul Majeed',
    'عبد الحميد': 'Abdul Hameed', 'عبدالحميد': 'Abdul Hameed',
    'عبد الغفور': 'Abdul Ghafoor', 'عبدالغفور': 'Abdul Ghafoor',
    'عبد القادر': 'Abdul Qadir', 'عبدالقادر': 'Abdul Qadir',
    'عبد الوهاب': 'Abdul Wahab', 'عبدالوهاب': 'Abdul Wahab',
    'عبد الحكيم': 'Abdul Hakeem', 'عبدالحكيم': 'Abdul Hakeem',
    'عبد الستار': 'Abdul Sattar', 'عبدالستار': 'Abdul Sattar',
    'عبد الجبار': 'Abdul Jabbar', 'عبدالجبار': 'Abdul Jabbar',
    'عبد الغفار': 'Abdul Ghaffar', 'عبدالغفار': 'Abdul Ghaffar',
    'عبد اللطيف': 'Abdul Latif', 'عبداللطيف': 'Abdul Latif',
    'عبد الفتاح': 'Abdul Fattah', 'عبدالفتاح': 'Abdul Fattah',
    'عبد الباسط': 'Abdul Basit', 'عبدالباسط': 'Abdul Basit',
    'عبد الرؤوف': 'Abdul Raouf', 'عبدالرؤوف': 'Abdul Raouf',
    'عبد المحسن': 'Abdul Mohsen', 'عبدالمحسن': 'Abdul Mohsen',
    'عبد العظيم': 'Abdul Azeem', 'عبدالعظيم': 'Abdul Azeem',
    'عبد الرازق': 'Abdul Razzaq', 'عبدالرازق': 'Abdul Razzaq',
    'عبد الرزاق': 'Abdul Razzaq', 'عبدالرزاق': 'Abdul Razzaq',
    'سيف الدين': 'Saifuddin', 'نور الدين': 'Nouruddin',
    'صلاح الدين': 'Salahuddin', 'علاء الدين': 'Alauddin',
    'جمال الدين': 'Jamaluddin', 'حسام الدين': 'Hossamuddin',
    'عماد الدين': 'Emaduddin', 'ضياء الدين': 'Diaauddin',
    'كمال الدين': 'Kamaluddin', 'بهاء الدين': 'Bahaauddin',
    'شمس الدين': 'Shamsuddin'
  };

  for (const [arComp, enComp] of Object.entries(compoundMap)) {
    const reg = new RegExp(`(^|\\s)${arComp}(\\s|$)`, 'g');
    str = str.replace(reg, `$1${enComp}$2`);
  }

  const nameDict = {
    'محمد': 'Mohamed', 'أحمد': 'Ahmed', 'احمد': 'Ahmed', 'محمود': 'Mahmoud', 'مصطفى': 'Mustafa',
    'علي': 'Ali', 'حسين': 'Hussein', 'حسن': 'Hassan', 'إبراهيم': 'Ibrahim', 'ابراهيم': 'Ibrahim',
    'يوسف': 'Youssef', 'عمر': 'Omar', 'عثمان': 'Osman', 'طارق': 'Tariq', 'بلال': 'Bilal',
    'خالد': 'Khaled', 'سليم': 'Salim', 'سالم': 'Salem', 'فاروق': 'Farooq', 'رشيد': 'Rashid',
    'سعيد': 'Saeed', 'كريم': 'Karim', 'جمال': 'Jamal', 'كمال': 'Kamal', 'حمزة': 'Hamza',
    'ياسين': 'Yassin', 'أنور': 'Anwar', 'أمجد': 'Amjad', 'أشرف': 'Ashraf', 'ناصر': 'Nasser',
    'منصور': 'Mansoor', 'صالح': 'Saleh', 'فيصل': 'Faisal', 'سلطان': 'Sultan', 'عادل': 'Adel',
    'وليد': 'Waleed', 'سامي': 'Sami', 'زياد': 'Ziad', 'ماجد': 'Majed', 'شريف': 'Sherif',
    'حسام': 'Hossam', 'عصام': 'Essam', 'عماد': 'Emad', 'موسى': 'Musa', 'عيسى': 'Isa',
    'رضا': 'Reda', 'رمضان': 'Ramadan', 'شعبان': 'Shaaban', 'رجب': 'Rajab', 'بدر': 'Badr',
    'نور': 'Nour', 'ضياء': 'Diaa', 'بشير': 'Basheer', 'نذير': 'Natheer', 'منير': 'Muneer',
    'سمير': 'Sameer', 'أمير': 'Ameer', 'رفيق': 'Rafeeq', 'شفيق': 'Shafeeq', 'وفيق': 'Wafeeq',
    'توفيق': 'Tawfeeq', 'جابر': 'Jaber', 'صابر': 'Saber', 'شاكر': 'Shaker', 'ماهر': 'Maher',
    'باسم': 'Bassem', 'حاتم': 'Hatem', 'قاسم': 'Qasim', 'هاشم': 'Hashem', 'فارس': 'Fares',
    'سيف': 'Saif', 'جهاد': 'Jihad', 'معاذ': 'Moaz', 'حميد': 'Hameed', 'مجيد': 'Majeed',
    'وحيد': 'Waheed', 'فريد': 'Fareed', 'وجدي': 'Wajdi', 'شادي': 'Shadi', 'هادي': 'Hadi',
    'فادي': 'Fadi', 'نادي': 'Nadi', 'رامي': 'Rami', 'سامر': 'Samer', 'تامر': 'Tamer',
    'ياسر': 'Yasser', 'جاسر': 'Jasser', 'آسر': 'Asser', 'صلاح': 'Salah', 'فلاح': 'Falah',
    'نجاح': 'Najah', 'صباح': 'Sabah', 'مراد': 'Murad', 'فؤاد': 'Fouad', 'زيان': 'Zayan',
    'ريان': 'Rayan', 'إحسان': 'Ihsan', 'احسان': 'Ihsan', 'غسان': 'Ghassan', 'عفان': 'Affan',
    'نعمان': 'Noman', 'سليمان': 'Sulaiman', 'لقمان': 'Luqman', 'سلمان': 'Salman',
    'حمد': 'Hamad', 'حمدان': 'Hamdan', 'مبارك': 'Mubarak', 'مبروك': 'Mabrouk', 'مسعود': 'Masoud',
    'سعود': 'Saud', 'محبوب': 'Mahboub', 'مأمون': 'Mamoun', 'هارون': 'Haroun', 'داود': 'Dawood',
    'داوود': 'Dawood', 'إدريس': 'Idris', 'ادريس': 'Idris', 'إلياس': 'Elias', 'الياس': 'Elias',
    'يونس': 'Younis', 'أيوب': 'Ayoub', 'ايوب': 'Ayoub', 'يعقوب': 'Yaqoub', 'إسحاق': 'Ishaq',
    'اسحاق': 'Ishaq', 'إسماعيل': 'Ismail', 'اسماعيل': 'Ismail', 'زكريا': 'Zakaria',
    'يحيى': 'Yahya', 'مختار': 'Mukhtar', 'أكرم': 'Akram', 'اكرم': 'Akram', 'أيمن': 'Ayman',
    'ايمن': 'Ayman', 'أمين': 'Ameen', 'امين': 'Ameen', 'إسلام': 'Islam', 'اسلام': 'Islam',
    'همام': 'Hammam', 'عزام': 'Azzam', 'بسام': 'Bassam', 'وسام': 'Wessam', 'هشام': 'Hisham',
    'عاصم': 'Assem', 'حازم': 'Hazem', 'ناظم': 'Nazem', 'كاظم': 'Kazem', 'عازم': 'Azem',
    'غانم': 'Ghanem', 'عالم': 'Alem', 'عارف': 'Aref', 'واصف': 'Wasef', 'عاطف': 'Atef',
    'رؤوف': 'Raouf', 'لطفي': 'Lotfi', 'فتحي': 'Fathi', 'صبحي': 'Sobhi', 'شوقي': 'Shawqi',
    'فوزي': 'Fawzi', 'رمزي': 'Ramzi', 'مجدي': 'Magdi', 'رشدي': 'Roshdi', 'مهدي': 'Mehdi',
    'هاني': 'Hani', 'راضي': 'Radi', 'ماضي': 'Madi', 'قاضي': 'Qadi', 'راجي': 'Raji',
    'ناجي': 'Naji', 'باهي': 'Bahi', 'زاهي': 'Zahi', 'صافي': 'Safi', 'وافي': 'Wafi',
    'غالي': 'Ghali', 'والي': 'Wali', 'خان': 'Khan', 'ميان': 'Mian', 'شاه': 'Shah',
    'سينغ': 'Singh', 'كومار': 'Kumar', 'باتيل': 'Patel', 'شارما': 'Sharma'
  };

  const parts = str.split(/\s+/).filter(Boolean);
  const translated = parts.map(part => {
    if (/^[A-Za-z\-']+$/.test(part)) return part;
    if (nameDict[part]) return nameDict[part];
    if (part.startsWith('ال') && part.length > 3) {
      const sub = part.slice(2);
      if (nameDict[sub]) return 'Al-' + nameDict[sub];
    }
    return phoneticArabicToEnglish(part);
  });

  return translated.join(' ');
}

function getPersonEnglishName(person) {
  if (!person) return '';
  if (person.nameEn && person.nameEn.trim()) {
    return person.nameEn.trim();
  }
  return transliterateArabicNameToEnglish(person.name) || person.name || `Person #${person.num}`;
}

function translateDispatchNoteToEnglish(note) {
  if (!note || typeof note !== 'string') return '-';
  let t = note.trim();
  if (!t) return '-';

  const phrases = [
    { ar: 'وقود وصيانة', en: 'Fuel & Maintenance' },
    { ar: 'وقود وبترول', en: 'Fuel' },
    { ar: 'صيانة وتصليح', en: 'Maintenance & Repair' },
    { ar: 'صيانة كبرى', en: 'Major Maintenance' },
    { ar: 'قطع غيار', en: 'Spare Parts' },
    { ar: 'تغيير زيت', en: 'Oil Change' },
    { ar: 'تبديل عجلات', en: 'Tire Replacement' },
    { ar: 'عجلات وإطارات', en: 'Tires' },
    { ar: 'غسيل سيارة', en: 'Car Wash' },
    { ar: 'سلفة رحلة', en: 'Trip Advance' },
    { ar: 'سلفة نقدية', en: 'Cash Advance' },
    { ar: 'سلفة طارئة', en: 'Emergency Advance' },
    { ar: 'مشتريات وقرطاسية', en: 'Stationery & Purchases' },
    { ar: 'أدوات مكتبية', en: 'Office Supplies' },
    { ar: 'مستلزمات مكتب', en: 'Office Materials' },
    { ar: 'نثريات ومشتريات', en: 'Petty Purchases' },
    { ar: 'رسوم فحص', en: 'Inspection Fees' },
    { ar: 'تجديد ترخيص', en: 'License Renewal' },
    { ar: 'بترول', en: 'Fuel' },
    { ar: 'وقود', en: 'Fuel' },
    { ar: 'صيانة', en: 'Maintenance' },
    { ar: 'تصليح', en: 'Repair' },
    { ar: 'سلفة', en: 'Advance' },
    { ar: 'سلفه', en: 'Advance' },
    { ar: 'مشتريات', en: 'Purchases' },
    { ar: 'نثريات', en: 'Petty Expenses' },
    { ar: 'غسيل', en: 'Car Wash' },
    { ar: 'إطارات', en: 'Tires' },
    { ar: 'عجلات', en: 'Tires' },
    { ar: 'زيت', en: 'Oil' },
    { ar: 'رسوم', en: 'Fees' }
  ];

  for (const p of phrases) {
    t = t.replace(new RegExp(p.ar, 'gi'), p.en);
  }
  return t;
}

function translateDispatchMetaToEnglish(meta) {
  if (!meta || typeof meta !== 'string') return '-';
  let t = meta.trim();
  if (!t) return '-';
  t = t.replace(/(سيارة|سياره)\s*(\d+)/gi, 'Vehicle $2');
  t = t.replace(/سيارة|سياره/gi, 'Vehicle');
  t = t.replace(/باص/gi, 'Bus');
  t = t.replace(/شاحنة|شاحنه/gi, 'Truck');
  t = t.replace(/المكتب/gi, 'Office');
  t = t.replace(/المشتريات/gi, 'Purchases');
  t = t.replace(/الصيانة|الصيانه/gi, 'Maintenance');
  t = t.replace(/المستودع/gi, 'Warehouse');
  t = t.replace(/الورشة|الورشه/gi, 'Workshop');
  t = t.replace(/الإدارة|الادارة|الاداره/gi, 'Management');
  return t;
}

// ============================================================================
// Tab 3: Daily Cash Distribution Sheet Business Logic
// ============================================================================

function getDailyDispatchList(dateStr, roleFilter = 'all') {
  const dayEntries = state.data.entries[dateStr] || {};
  const list = [];

  for (const [pid, entry] of Object.entries(dayEntries)) {
    const cash = Number(entry.cash) || 0;
    if (cash <= 0) continue; // Beneficiaries who took cash today

    const person = state.data.people.find(p => p.id === pid);
    if (!person) continue;

    if (roleFilter !== 'all' && person.role !== roleFilter) {
      continue;
    }

    list.push({
      person,
      cash,
      invoice: Number(entry.invoice) || 0,
      returnedCash: Number(entry.returnedCash) || 0,
      note: entry.note || '',
      cashCents: toCents(cash)
    });
  }

  // Strict sorting: Primary = cash amount descending. Tie-breaker = person.num ascending!
  list.sort((a, b) => {
    if (b.cashCents !== a.cashCents) {
      return b.cashCents - a.cashCents;
    }
    return (a.person.num || 0) - (b.person.num || 0);
  });

  return list;
}

function getDailyDispatchKpis(dateStr, roleFilter = 'all') {
  const list = getDailyDispatchList(dateStr, roleFilter);
  let totalDisbursedCents = 0;
  let topRecipient = null;

  list.forEach(item => {
    totalDisbursedCents += item.cashCents;
    if (!topRecipient || item.cashCents > topRecipient.cashCents) {
      topRecipient = item;
    }
  });

  const totals = getDayTotals(dateStr);

  return {
    count: list.length,
    totalDisbursed: fromCents(totalDisbursedCents),
    topRecipient: topRecipient ? {
      person: topRecipient.person,
      amount: topRecipient.cash
    } : null,
    drawerRemaining: totals.remaining,
    totalVaultReceived: totals.received
  };
}

// ============================================================================
// Corporate Tafqeet & Currency In Words Engine (Qatari Riyals - QAR)
// ============================================================================

function moneyToArabicWords(amount) {
  const cents = Math.round(Math.abs(amount) * 100);
  const riyals = Math.floor(cents / 100);
  const dirhams = cents % 100;

  if (riyals === 0 && dirhams === 0) return 'فقط صفر ريال قطري لا غير';

  const ones = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة',
    'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
  const tens = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
  const hundreds = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];

  function convertGroup(n) {
    if (n === 0) return '';
    let res = '';
    const h = Math.floor(n / 100);
    const rem = n % 100;
    if (h > 0) res += hundreds[h];
    if (rem > 0) {
      if (res) res += ' و';
      if (rem < 20) {
        res += ones[rem];
      } else {
        const u = rem % 10;
        const t = Math.floor(rem / 10);
        if (u > 0) res += ones[u] + ' و';
        res += tens[t];
      }
    }
    return res;
  }

  let parts = [];
  const millions = Math.floor(riyals / 1000000);
  const thousands = Math.floor((riyals % 1000000) / 1000);
  const remainingRiyals = riyals % 1000;

  if (millions > 0) {
    if (millions === 1) parts.push('مليون');
    else if (millions === 2) parts.push('مليونان');
    else if (millions >= 3 && millions <= 10) parts.push(convertGroup(millions) + ' ملايين');
    else parts.push(convertGroup(millions) + ' مليون');
  }

  if (thousands > 0) {
    if (thousands === 1) parts.push('ألف');
    else if (thousands === 2) parts.push('ألفان');
    else if (thousands >= 3 && thousands <= 10) parts.push(convertGroup(thousands) + ' آلاف');
    else parts.push(convertGroup(thousands) + ' ألف');
  }

  if (remainingRiyals > 0) {
    parts.push(convertGroup(remainingRiyals));
  }

  let text = parts.join(' و');
  let result = 'فقط ' + (text ? text + ' ريالاً قطرياً' : '');

  if (dirhams > 0) {
    const dirhamText = convertGroup(dirhams);
    result += (text ? ' و' : 'فقط ') + dirhamText + ' درهماً';
  }

  return result + ' لا غير';
}

function moneyToEnglishWords(amount) {
  const cents = Math.round(Math.abs(amount) * 100);
  const riyals = Math.floor(cents / 100);
  const dirhams = cents % 100;

  if (riyals === 0 && dirhams === 0) return 'Only Zero Qatari Riyals Only';

  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function convertGroup(n) {
    if (n === 0) return '';
    let res = '';
    const h = Math.floor(n / 100);
    const rem = n % 100;
    if (h > 0) {
      res += ones[h] + ' Hundred';
      if (rem > 0) res += ' and ';
    }
    if (rem > 0) {
      if (rem < 20) {
        res += ones[rem];
      } else {
        const u = rem % 10;
        const t = Math.floor(rem / 10);
        res += tens[t];
        if (u > 0) res += '-' + ones[u];
      }
    }
    return res;
  }

  let parts = [];
  const millions = Math.floor(riyals / 1000000);
  const thousands = Math.floor((riyals % 1000000) / 1000);
  const remaining = riyals % 1000;

  if (millions > 0) parts.push(convertGroup(millions) + ' Million');
  if (thousands > 0) parts.push(convertGroup(thousands) + ' Thousand');
  if (remaining > 0) parts.push(convertGroup(remaining));

  let text = parts.join(', ');
  let result = 'Only ' + (text ? text + ' Qatari Riyals' : '');

  if (dirhams > 0) {
    result += (text ? ' and ' : 'Only ') + convertGroup(dirhams) + ' Dirhams';
  }

  return result + ' Only';
}

function renderDispatchTab() {
  if (typeof document === 'undefined') return;
  const isEn = state.dispatchLang === 'en';
  const tabEl = document.getElementById('tab-dispatch');
  if (tabEl) {
    tabEl.removeAttribute('dir');
  }

  const titleEl = document.getElementById('dispatchMainTitle');
  const subEl = document.getElementById('dispatchSubTitle');
  if (titleEl) {
    titleEl.textContent = isEn 
      ? '📑 Daily Cash Sheet (Disbursement Log)'
      : '📑 كشف الصرف اليومي (Daily Cash Sheet)';
  }
  if (subEl) {
    subEl.textContent = isEn
      ? 'Daily cash disbursed to drivers & staff — sorted strictly from highest to lowest recipient'
      : 'كشف وتوثيق نقدية اليوم الموزعة على السائقين والموظفين — مرتب من الأكثر للأقل استلاماً';
  }

  const btnAr = document.getElementById('btnDispatchLangAr');
  const btnEn = document.getElementById('btnDispatchLangEn');
  if (btnAr) btnAr.classList.toggle('active', !isEn);
  if (btnEn) btnEn.classList.toggle('active', isEn);

  const dateInput = document.getElementById('dispatchDateInput');
  if (dateInput) {
    dateInput.value = state.selectedDate;
  }

  document.querySelectorAll('#dispatchRoleFilter .pill').forEach(pill => {
    pill.classList.toggle('active', pill.getAttribute('data-role') === state.dispatchRoleFilter);
  });

  const list = getDailyDispatchList(state.selectedDate, state.dispatchRoleFilter);
  const kpis = getDailyDispatchKpis(state.selectedDate, state.dispatchRoleFilter);

  const kpiTotalEl = document.getElementById('dispatchKpiTotalDisbursed');
  const kpiCountEl = document.getElementById('dispatchKpiBeneficiaries');
  const kpiTopEl = document.getElementById('dispatchKpiTopRecipient');
  const kpiDrawerEl = document.getElementById('dispatchKpiDrawerBalance');

  if (kpiTotalEl) {
    kpiTotalEl.textContent = isEn ? `${formatNumber(kpis.totalDisbursed)} QAR` : `${formatNumber(kpis.totalDisbursed)} ر.ق`;
  }
  if (kpiCountEl) {
    kpiCountEl.textContent = isEn ? `${kpis.count} Persons` : `${kpis.count} مستلم`;
  }
  if (kpiTopEl) {
    if (kpis.topRecipient) {
      const pName = isEn ? getPersonEnglishName(kpis.topRecipient.person) : getPersonDisplayName(kpis.topRecipient.person);
      const amtStr = isEn ? `${formatNumber(kpis.topRecipient.amount)} QAR` : `${formatNumber(kpis.topRecipient.amount)} ر.ق`;
      kpiTopEl.textContent = `${pName} (${amtStr})`;
    } else {
      kpiTopEl.textContent = isEn ? 'No disbursements' : 'لا يوجد صرف اليوم';
    }
  }
  if (kpiDrawerEl) {
    kpiDrawerEl.textContent = isEn ? `${formatNumber(kpis.drawerRemaining)} QAR` : `${formatNumber(kpis.drawerRemaining)} ر.ق`;
  }

  updateDispatchI18nLabels(isEn);
  renderDispatchTable(list, isEn);
}

function renderDispatchTable(list, isEn) {
  const thead = document.getElementById('dispatchTableHead');
  const tbody = document.getElementById('dispatchTableBody');
  const tfoot = document.getElementById('dispatchTableFoot');
  if (!thead || !tbody || !tfoot) return;

  const colgroupHtml = `
    <colgroup>
      <col style="width: 5%;">
      <col style="width: 25%;">
      <col style="width: 10%;">
      <col style="width: 14%;">
      <col style="width: 14%;">
      <col style="width: 16%;">
      <col style="width: 16%;">
    </colgroup>
  `;

  if (isEn) {
    thead.innerHTML = colgroupHtml + `
      <tr>
        <th style="text-align: center;">#</th>
        <th style="text-align: left;">Driver / Staff Name</th>
        <th style="text-align: center;">Role</th>
        <th style="text-align: center;">Vehicle / Dept</th>
        <th style="text-align: right;">Amount Issued (QAR)</th>
        <th style="text-align: left;">Purpose & Description</th>
        <th style="text-align: center;">Recipient Signature</th>
      </tr>
    `;
  } else {
    thead.innerHTML = colgroupHtml + `
      <tr>
        <th style="text-align: center;">م</th>
        <th style="text-align: right;">اسم السائق / الموظف</th>
        <th style="text-align: center;">الصفة</th>
        <th style="text-align: center;">المركبة أو القسم</th>
        <th style="text-align: right;">المبلغ المستلم (ر.ق)</th>
        <th style="text-align: right;">البيان والغرض</th>
        <th style="text-align: center;">توقيع الاستلام</th>
      </tr>
    `;
  }

  tbody.innerHTML = '';
  if (list.length === 0) {
    const emptyMsg = isEn
      ? `No cash was disbursed on ${state.selectedDate}. (Use the Daily tab to register driver advances).`
      : `لم يتم صرف أي مبالغ نقدية في تاريخ ${state.selectedDate}. (يمكن تسجيل سُلف السائقين من تبويب "التسجيل اليومي").`;
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 36px; color: var(--text-muted); font-size: 1.05rem;">
          ${emptyMsg}
        </td>
      </tr>
    `;
  } else {
    list.forEach((item, idx) => {
      const tr = document.createElement('tr');
      const p = item.person;
      const roleBadge = p.role === 'staff'
        ? `<span class="role-badge staff">${isEn ? 'Staff' : 'موظف'}</span>`
        : `<span class="role-badge driver">${isEn ? 'Driver' : 'سائق'}</span>`;

      let nameCellContent = '';
      if (isEn) {
        const enName = getPersonEnglishName(p);
        nameCellContent = `
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
            <div>
              <strong style="color: var(--text-color); font-size: 1rem;">${escapeHtml(enName)}</strong>
              <small style="display: block; color: var(--text-muted); font-size: 0.78rem;">${escapeHtml(p.name)} (#${p.num})</small>
            </div>
            <button type="button" class="btn btn-sm btn-outline no-print" data-edit-eng-name="${p.id}" title="Edit English spelling" style="padding: 2px 7px; font-size: 0.75rem;">
              ✏️ Edit
            </button>
          </div>
        `;
      } else {
        nameCellContent = `
          <div>
            <strong style="font-size: 1.02rem; color: var(--text-color);">${escapeHtml(p.name)}</strong>
            <small style="display: block; color: var(--text-muted); font-size: 0.8rem;">رقم #${p.num}</small>
          </div>
        `;
      }

      const metaDisplay = isEn ? translateDispatchMetaToEnglish(p.meta) : (p.meta || '-');
      const noteDisplay = isEn ? translateDispatchNoteToEnglish(item.note) : (item.note || '-');
      const amtDisplay = isEn ? `${formatNumber(item.cash)} QAR` : `${formatNumber(item.cash)} ر.ق`;

      tr.innerHTML = `
        <td style="text-align: center; font-weight: 700; color: var(--text-muted);">${idx + 1}</td>
        <td>${nameCellContent}</td>
        <td style="text-align: center;">${roleBadge}</td>
        <td style="text-align: center; color: var(--text-muted); font-size: 0.88rem;">${escapeHtml(metaDisplay)}</td>
        <td style="text-align: right; font-weight: 800; color: var(--success-color); font-size: 1.08rem; font-variant-numeric: tabular-nums;">${amtDisplay}</td>
        <td style="font-size: 0.88rem; color: var(--text-color);">${escapeHtml(noteDisplay)}</td>
        <td style="text-align: center;">
          <div class="only-print" style="min-height: 28px; border-bottom: 1px dashed #64748b; width: 85%; margin: 0 auto;"></div>
          <span class="no-print text-muted" style="font-size: 0.82rem;">[ ✍️ ${isEn ? 'Signature' : 'التوقيع'} ]</span>
        </td>
      `;
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll('[data-edit-eng-name]').forEach(btn => {
      btn.addEventListener('click', () => {
        const pid = btn.getAttribute('data-edit-eng-name');
        const p = state.data.people.find(item => item.id === pid);
        if (!p) return;
        const currentEn = getPersonEnglishName(p);
        const newEn = prompt(`Edit English Name for "${p.name}" (#${p.num}):`, currentEn);
        if (newEn !== null) {
          p.nameEn = newEn.trim();
          saveState();
          renderDispatchTab();
          showToast(`Updated English name for ${p.name} to "${p.nameEn}" ✓`);
        }
      });
    });
  }

  const kpis = getDailyDispatchKpis(state.selectedDate, state.dispatchRoleFilter);
  const totalLabel = isEn ? 'TOTAL DISBURSED (QAR):' : 'إجمالي المبالغ المنصرفة لليوم:';
  const totalAmt = isEn ? `${formatNumber(kpis.totalDisbursed)} QAR` : `${formatNumber(kpis.totalDisbursed)} ر.ق`;
  tfoot.innerHTML = `
    <tr>
      <td colspan="4" style="text-align: ${isEn ? 'left' : 'right'}; font-weight: 800; font-size: 0.95rem;">
        ${totalLabel}
      </td>
      <td style="text-align: right; font-weight: 800; color: #15803d; font-size: 1.15rem; font-variant-numeric: tabular-nums;">
        ${totalAmt}
      </td>
      <td colspan="2" style="font-size: 0.85rem; color: #64748b; text-align: center;">
        [ ${kpis.count} ${isEn ? 'Recipients' : 'مستلم'} ]
      </td>
    </tr>
  `;
}

function updateDispatchI18nLabels(isEn) {
  const lblPrint = document.getElementById('lblPrintDispatch');
  const lblExport = document.getElementById('lblExportDispatch');
  const lblWhatsApp = document.getElementById('lblWhatsAppDispatch');
  const lblDate = document.getElementById('lblDispatchSelectDate');
  const lblToday = document.getElementById('lblDispatchToday');
  const lblYesterday = document.getElementById('lblDispatchYesterday');
  const lblFilter = document.getElementById('lblDispatchFilterRole');
  const btnAll = document.getElementById('btnRoleAll');
  const btnDrivers = document.getElementById('btnRoleDrivers');
  const btnStaff = document.getElementById('btnRoleStaff');

  const lblKpi1 = document.getElementById('lblKpiTotalDisbursed');
  const subKpi1 = document.getElementById('dispatchKpiTotalDisbursedSub');
  const lblKpi2 = document.getElementById('lblKpiBeneficiaries');
  const subKpi2 = document.getElementById('dispatchKpiBeneficiariesSub');
  const lblKpi3 = document.getElementById('lblKpiTopRecipient');
  const subKpi3 = document.getElementById('dispatchKpiTopRecipientSub');
  const lblKpi4 = document.getElementById('lblKpiDrawerBalance');
  const subKpi4 = document.getElementById('dispatchKpiDrawerBalanceSub');

  if (lblPrint) lblPrint.textContent = isEn ? 'Print Daily Sheet' : 'طباعة الكشف اليومي';
  if (lblExport) lblExport.textContent = isEn ? 'Export Excel (CSV)' : 'تصدير إكسيل معتمد';
  if (lblWhatsApp) lblWhatsApp.textContent = isEn ? 'Copy WhatsApp Summary' : 'نسخ ملخص الواتساب';
  if (lblDate) lblDate.textContent = isEn ? '📅 Sheet Date:' : '📅 تاريخ اليومية:';
  if (lblToday) lblToday.textContent = isEn ? 'Today' : 'اليوم';
  if (lblYesterday) lblYesterday.textContent = isEn ? 'Yesterday' : 'الأمس';
  if (lblFilter) lblFilter.textContent = isEn ? 'Filter:' : 'تصفية:';
  if (btnAll) btnAll.textContent = isEn ? 'All (الكل)' : 'الكل (All)';
  if (btnDrivers) btnDrivers.textContent = isEn ? 'Drivers Only' : 'السائقين (Drivers)';
  if (btnStaff) btnStaff.textContent = isEn ? 'Staff Only' : 'الموظفين (Staff)';

  if (lblKpi1) lblKpi1.textContent = isEn ? '💰 Total Disbursed' : '💰 إجمالي المنصرف لليوم';
  if (subKpi1) subKpi1.textContent = isEn ? 'Total cash handed out to recipients' : 'مجموع السُلف الموزعة باليد';
  if (lblKpi2) lblKpi2.textContent = isEn ? '👥 Beneficiaries Count' : '👥 عدد المستلمين';
  if (subKpi2) subKpi2.textContent = isEn ? 'Drivers & staff who received cash' : 'سائق وموظف استلموا نقدية';
  if (lblKpi3) lblKpi3.textContent = isEn ? '🏆 Top Recipient' : '🏆 أعلى مستلم نقدية';
  if (subKpi3) subKpi3.textContent = isEn ? 'Highest cash amount today' : 'صاحب أكبر مبلغ اليوم';
  if (lblKpi4) lblKpi4.textContent = isEn ? '🏦 Physical Drawer Balance' : '🏦 المتبقي في الدرج / الخزنة';
  if (subKpi4) subKpi4.textContent = isEn ? 'Verified cash balance in hand' : 'مطابقة النقدية باليد';

  // Corporate Letterhead Elements
  const pComp = document.getElementById('printCorpCompanyName');
  const pDept = document.getElementById('printCorpDeptName');
  const pTitle = document.getElementById('printCorpDocTitle');
  const pVouchNoLbl = document.getElementById('printCorpVoucherNoLbl');
  const pDateLbl = document.getElementById('printCorpDateLbl');
  const pCurrLbl = document.getElementById('printCorpCurrencyLbl');
  const pCopyLbl = document.getElementById('printCorpCopyLbl');
  const pCopyVal = document.getElementById('printCorpCopyVal');

  if (pComp) pComp.textContent = isEn ? 'HELIOPOLIS ELECTRIC COMPANY' : 'شركة هليوبوليس للكهرباء (HELIOPOLIS ELECTRIC COMPANY)';
  if (pDept) pDept.textContent = isEn ? 'Corporate Treasury & Petty Cash Department' : 'قسم الخزينة والعهد النقدية — Corporate Treasury & Petty Cash Dept.';
  const pLegal = document.getElementById('printCorpLegalMeta');
  if (pLegal) {
    pLegal.textContent = isEn
      ? 'Official Website: heliopoliselectric.ae | Abu Dhabi: +971 2 641 2641 | Doha: +974 4463 4054'
      : 'الموقع الرسمي: heliopoliselectric.ae | هاتف أبوظبي: 26412641 (971+) | الدوحة: 44634054 (974+)';
  }
  if (pTitle) pTitle.textContent = isEn ? 'DAILY PETTY CASH DISBURSEMENT STATEMENT' : 'كشف الصرف اليومي للعهدة النقدية (DAILY DISBURSEMENT SHEET)';
  if (pVouchNoLbl) pVouchNoLbl.textContent = isEn ? 'Voucher Ref:' : 'رقم السند:';
  if (pDateLbl) pDateLbl.textContent = isEn ? 'Statement Date:' : 'تاريخ اليومية:';
  if (pCurrLbl) pCurrLbl.textContent = isEn ? 'Currency:' : 'العملة:';
  if (pCopyLbl) pCopyLbl.textContent = isEn ? 'Copy:' : 'النسخة:';
  if (pCopyVal) pCopyVal.textContent = isEn ? 'Original - Accounts' : 'الأصل - قسم الحسابات';

  const vouchVal = document.getElementById('printCorpVoucherNo');
  const dateVal = document.getElementById('printCorpDate');
  const { y, m, d } = parseDateParts(state.selectedDate);
  if (vouchVal) vouchVal.textContent = `DCD-${state.selectedDate.replace(/-/g, '')}-001`;
  if (dateVal) {
    dateVal.textContent = isEn
      ? `${getEnglishDayName(y, m, d)}, ${state.selectedDate}`
      : `${getArabicDayName(y, m, d)} ${state.selectedDate}`;
  }

  // Reconciliation Block Values
  const kpis = getDailyDispatchKpis(state.selectedDate, state.dispatchRoleFilter);
  const recVal = getDayReceived(state.selectedDate);
  const retVal = getDayTotals(state.selectedDate).returnedCashTotal || 0;

  const rLblDrawn = document.getElementById('reconLblDrawn');
  const rValDrawn = document.getElementById('reconValDrawn');
  const rLblDisb = document.getElementById('reconLblDisbursed');
  const rValDisb = document.getElementById('reconValDisbursed');
  const rLblRet = document.getElementById('reconLblReturned');
  const rValRet = document.getElementById('reconValReturned');
  const rLblDraw = document.getElementById('reconLblDrawer');
  const rValDraw = document.getElementById('reconValDrawer');

  if (rLblDrawn) rLblDrawn.textContent = isEn ? 'Cash Drawn from Treasury' : 'المسحوب من الخزنة (الوارد)';
  if (rValDrawn) rValDrawn.textContent = isEn ? `${formatNumber(recVal)} QAR` : `${formatNumber(recVal)} ر.ق`;

  if (rLblDisb) rLblDisb.textContent = isEn ? 'Total Disbursed Today' : 'إجمالي المنصرف (الموزع)';
  if (rValDisb) rValDisb.textContent = isEn ? `${formatNumber(kpis.totalDisbursed)} QAR` : `${formatNumber(kpis.totalDisbursed)} ر.ق`;

  if (rLblRet) rLblRet.textContent = isEn ? 'Returned Cash in Hand' : 'الكاش المرتجع باليد';
  if (rValRet) rValRet.textContent = isEn ? `${formatNumber(retVal)} QAR` : `${formatNumber(retVal)} ر.ق`;

  if (rLblDraw) rLblDraw.textContent = isEn ? 'Actual Physical Drawer Balance' : 'المتبقي الفعلي بالدرج';
  if (rValDraw) rValDraw.textContent = isEn ? `${formatNumber(kpis.drawerRemaining)} QAR` : `${formatNumber(kpis.drawerRemaining)} ر.ق`;

  // Tafqeet (Amount in words)
  const tafqeetText = isEn
    ? moneyToEnglishWords(kpis.totalDisbursed)
    : moneyToArabicWords(kpis.totalDisbursed);
  const tafqeetEl = document.getElementById('dispatchTafqeetText');
  const tafqeetLbl = document.getElementById('dispatchTafqeetLabel');
  if (tafqeetEl) tafqeetEl.textContent = tafqeetText;
  if (tafqeetLbl) tafqeetLbl.textContent = isEn ? 'Amount in Words (Fraud Prevention):' : 'المبلغ كتابة بالحروف:';

  // 3-Tier Signatures
  const sPrepT = document.getElementById('signPreparedByTitle');
  const sPrepS = document.getElementById('signPreparedBySub');
  const sRevT = document.getElementById('signReviewedByTitle');
  const sRevS = document.getElementById('signReviewedBySub');
  const sAppT = document.getElementById('signApprovedByTitle');
  const sAppS = document.getElementById('signApprovedBySub');
  const sSeal = document.getElementById('signSealTitle');

  if (sPrepT) sPrepT.textContent = isEn ? 'Prepared By (Cash Custodian)' : 'إعداد / أمين الصندوق';
  if (sPrepS) sPrepS.textContent = isEn ? 'Name, Signature & Date' : 'الاسم، التوقيع والتاريخ';
  if (sRevT) sRevT.textContent = isEn ? 'Audited By (Internal Accountant)' : 'تدقيق ومراجعة / المحاسب';
  if (sRevS) sRevS.textContent = isEn ? 'Name, Signature & Date' : 'الاسم، التوقيع والتاريخ';
  if (sAppT) sAppT.textContent = isEn ? 'Approved By (Financial Controller)' : 'اعتماد / المدير المالي';
  if (sAppS) sAppS.textContent = isEn ? 'Name, Signature & Date' : 'الاسم، التوقيع والتاريخ';
  const sSealTitle = document.getElementById('signSealTitle');
  const sSealSub = document.getElementById('signSealSub');
  if (sSealTitle) sSealTitle.textContent = isEn ? 'HELIOPOLIS ELECTRIC' : 'شركة هليوبوليس للكهرباء';
  if (sSealSub) sSealSub.textContent = isEn ? 'OFFICIAL COMPANY SEAL' : 'خاتم الاعتماد الرسمي';
}

function generateDispatchWhatsAppSummary(dateStr, isEn) {
  const list = getDailyDispatchList(dateStr, state.dispatchRoleFilter);
  const kpis = getDailyDispatchKpis(dateStr, state.dispatchRoleFilter);
  const { y, m, d } = parseDateParts(dateStr);

  if (isEn) {
    const dayName = getEnglishDayName(y, m, d);
    let text = `📊 *DAILY CASH DISTRIBUTION REPORT*\n`;
    text += `📅 Date: ${dayName}, ${dateStr}\n`;
    text += `━━━━━━━━━━━━━━━━━━━━\n`;
    text += `💰 *Total Disbursed:* ${formatNumber(kpis.totalDisbursed)} QAR\n`;
    text += `👥 *Beneficiaries Count:* ${kpis.count} recipients\n`;
    if (kpis.topRecipient) {
      text += `🏆 *Top Recipient:* ${getPersonEnglishName(kpis.topRecipient.person)} (${formatNumber(kpis.topRecipient.amount)} QAR)\n`;
    }
    text += `🏦 *Drawer Balance:* ${formatNumber(kpis.drawerRemaining)} QAR\n`;
    text += `━━━━━━━━━━━━━━━━━━━━\n`;
    text += `📋 *Disbursement Breakdown (Ranked):*\n`;

    if (list.length === 0) {
      text += `_No disbursements recorded for this date._\n`;
    } else {
      list.forEach((item, idx) => {
        const name = getPersonEnglishName(item.person);
        const meta = translateDispatchMetaToEnglish(item.person.meta);
        const note = translateDispatchNoteToEnglish(item.note);
        const role = item.person.role === 'staff' ? '[Staff]' : '[Driver]';
        text += `${idx + 1}. *${name}* ${role}: ${formatNumber(item.cash)} QAR`;
        if (meta && meta !== '-') text += ` — ${meta}`;
        if (note && note !== '-') text += ` (${note})`;
        text += `\n`;
      });
    }

    text += `━━━━━━━━━━━━━━━━━━━━\n`;
    text += `_Generated via Petty Cash Management System_`;
    return text;
  } else {
    const dayName = getArabicDayName(y, m, d);
    let text = `📊 *تقرير كشف الصرف والتوزيع اليومي*\n`;
    text += `📅 التاريخ: ${dayName} ${dateStr}\n`;
    text += `━━━━━━━━━━━━━━━━━━━━\n`;
    text += `💰 *إجمالي المنصرف:* ${formatNumber(kpis.totalDisbursed)} ر.ق\n`;
    text += `👥 *عدد المستلمين:* ${kpis.count} مستلم\n`;
    if (kpis.topRecipient) {
      text += `🏆 *أعلى مستلم:* ${kpis.topRecipient.person.name} (${formatNumber(kpis.topRecipient.amount)} ر.ق)\n`;
    }
    text += `🏦 *النقدية المتبقية بالدرج:* ${formatNumber(kpis.drawerRemaining)} ر.ق\n`;
    text += `━━━━━━━━━━━━━━━━━━━━\n`;
    text += `📋 *بيان توزيع النقدية (مرتب تنازلياً):*\n`;

    if (list.length === 0) {
      text += `_لا توجد مبالغ منصرفة مسجلة في هذا اليوم._\n`;
    } else {
      list.forEach((item, idx) => {
        const name = item.person.name;
        const meta = item.person.meta;
        const note = item.note;
        const role = item.person.role === 'staff' ? '[موظف]' : '[سائق]';
        text += `${idx + 1}. *${name}* ${role}: ${formatNumber(item.cash)} ر.ق`;
        if (meta) text += ` — ${meta}`;
        if (note) text += ` (${note})`;
        text += `\n`;
      });
    }

    text += `━━━━━━━━━━━━━━━━━━━━\n`;
    text += `_تم الاستخراج والتوثيق عبر نظام إدارة العهدة اليومية_`;
    return text;
  }
}

async function copyTextToClipboard(text) {
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      // Fallback
    }
  }
  if (typeof document !== 'undefined') {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-999999px';
    textarea.style.top = '-999999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    let success = false;
    try {
      success = document.execCommand('copy');
    } catch (err) {
      success = false;
    }
    document.body.removeChild(textarea);
    return success;
  }
  return false;
}


// Replenishment Statement Modal Logic
function openReplenishmentModal() {
  const mRecList = getCustodyReceiptsForMonth(state.year, state.month);
  let monthReceivedCents = 0;
  mRecList.forEach(r => {
    monthReceivedCents += toCents(r.amount);
  });
  const monthReceived = fromCents(monthReceivedCents);

  let monthDistributedCents = 0;
  let monthInvoicesCents = 0;
  let monthReturnedCents = 0;
  let monthExtrasCents = 0;
  let monthEligibleExtrasCents = 0;

  const categoryTotalsCents = {
    '⛽ بترول / وقود': 0,
    '🔧 صيانة وإصلاحات': 0,
    '📦 مشتريات ومواد': 0,
    '☕ نثريات وضيافة': 0,
    '📋 مصروفات أخرى': 0
  };

  const daysInM = getDaysInMonth(state.year, state.month);
  for (let d = 1; d <= daysInM; d++) {
    const dk = formatDateKey(state.year, state.month, d);
    const dayEntries = state.data.entries[dk] || {};
    for (const p of state.data.people) {
      const e = dayEntries[p.id];
      if (e) {
        const cashC = toCents(e.cash);
        const invC = toCents(e.invoice);
        const retC = toCents(e.returnedCash || 0);
        monthDistributedCents += cashC;
        monthInvoicesCents += invC;
        monthReturnedCents += retC;

        if (invC > 0) {
          const note = (e.note || '').toLowerCase();
          if (note.includes('بترول') || note.includes('وقود') || note.includes('ديزل') || note.includes('بنزين') || note.includes('petrol')) {
            categoryTotalsCents['⛽ بترول / وقود'] += invC;
          } else if (note.includes('صيانة') || note.includes('تصليح') || note.includes('ميكانيك') || note.includes('غسيل') || note.includes('إطارات')) {
            categoryTotalsCents['🔧 صيانة وإصلاحات'] += invC;
          } else if (note.includes('مشتريات') || note.includes('أغراض') || note.includes('قطع') || note.includes('شراء')) {
            categoryTotalsCents['📦 مشتريات ومواد'] += invC;
          } else if (note.includes('نثريات') || note.includes('شاي') || note.includes('ضيافة') || note.includes('ماء')) {
            categoryTotalsCents['☕ نثريات وضيافة'] += invC;
          } else {
            categoryTotalsCents['📋 مصروفات أخرى'] += invC;
          }
        }
      }
    }

    const extra = state.data.dailyExtras[dk];
    if (extra && extra.amount) {
      const exAmtC = toCents(extra.amount);
      monthExtrasCents += exAmtC;
      if (!extra.excludeFromCompany) {
        monthInvoicesCents += exAmtC;
        monthEligibleExtrasCents += exAmtC;
        categoryTotalsCents['📋 مصروفات أخرى'] += exAmtC;
      }
    }
  }

  const monthDistributed = fromCents(monthDistributedCents);
  const monthInvoices = fromCents(monthInvoicesCents);
  const cashInHand = fromCents((monthReceivedCents + monthReturnedCents) - (monthDistributedCents + monthExtrasCents));

  document.getElementById('repPeriodSubtitle').textContent = `الفترة المحاسبية: شهر ${ARABIC_MONTHS[state.month]} ${state.year} — تاريخ الإصدار: ${state.selectedDate}`;
  document.getElementById('repTotalReceived').textContent = `${formatNumber(monthReceived)} ر.ق`;
  document.getElementById('repTotalDistributed').textContent = `${formatNumber(monthDistributed)} ر.ق`;
  document.getElementById('repTotalInvoices').textContent = `${formatNumber(monthInvoices)} ر.ق`;
  document.getElementById('repCashRemaining').textContent = `${formatNumber(cashInHand)} ر.ق`;

  const tbody = document.getElementById('repCategoryBreakdownBody');
  tbody.innerHTML = '';
  for (const [catName, catValCents] of Object.entries(categoryTotalsCents)) {
    const catVal = fromCents(catValCents);
    if (catVal > 0 || monthInvoices === 0) {
      const pct = monthInvoices > 0 ? ((catVal / monthInvoices) * 100).toFixed(1) : '0';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${catName}</strong></td>
        <td style="font-weight: 800; color: var(--purple);">${formatNumber(catVal)} ر.ق</td>
        <td><strong>${pct}%</strong></td>
      `;
      tbody.appendChild(tr);
    }
  }

  const trTot = document.createElement('tr');
  trTot.className = 'totals-row rep-totals-row';
  trTot.innerHTML = `
    <td><strong>إجمالي الفواتير المطلوب استعاضتها</strong></td>
    <td class="rep-total-invoices-val">${formatNumber(monthInvoices)} ر.ق</td>
    <td><strong>100%</strong></td>
  `;
  tbody.appendChild(trTot);

  document.getElementById('replenishmentModal').classList.remove('hidden');
}

function printReplenishmentSheet() {
  document.body.classList.add('printing-replenishment');
  window.print();
  setTimeout(() => {
    document.body.classList.remove('printing-replenishment');
  }, 500);
}

// ============================================================================
// Move / Copy Day's Distribution
// ============================================================================

function openMoveDistModal() {
  const { y, m, d } = parseDateParts(state.selectedDate);
  document.getElementById('moveDistSourceDateDisplay').value = `${getArabicDayName(y, m, d)} - ${d} ${ARABIC_MONTHS[m]} ${y} (${state.selectedDate})`;
  document.getElementById('moveDistTargetDateInput').value = '';
  document.getElementById('moveDistModal').classList.remove('hidden');
}

function confirmMoveOrCopyDistribution() {
  const targetDate = document.getElementById('moveDistTargetDateInput').value;
  if (!targetDate) {
    alert('يرجى اختيار التاريخ المستهدف لنقل أو نسخ التوزيعة إليه');
    return;
  }
  if (targetDate === state.selectedDate) {
    alert('التاريخ المستهدف هو نفسه التاريخ الحالي!');
    return;
  }

  const mode = document.querySelector('input[name="moveDistMode"]:checked')?.value || 'move';

  const sourceEntries = state.data.entries[state.selectedDate];
  const sourceReceipt = state.data.dailyReceipts[state.selectedDate];
  const sourceExtra = state.data.dailyExtras[state.selectedDate];

  const hasData = (sourceEntries && Object.keys(sourceEntries).length > 0) || sourceReceipt || sourceExtra;
  if (!hasData) {
    alert('اليوم الحالي لا يحتوي على أي مبالغ أو توزيعات لنقلها!');
    return;
  }

  const targetHasData = (state.data.entries[targetDate] && Object.keys(state.data.entries[targetDate]).length > 0) ||
                        state.data.dailyReceipts[targetDate] ||
                        state.data.dailyExtras[targetDate];

  if (targetHasData) {
    if (!confirm(`اليوم المستهدف (${targetDate}) يحتوي بالفعل على بيانات وتوزيعات سابقة. هل تريد استبدالها/دمجها مع بيانات اليوم المنقول؟`)) {
      return;
    }
  }

  state.data.entries[targetDate] = state.data.entries[targetDate] || {};
  if (sourceEntries) {
    for (const [pid, e] of Object.entries(sourceEntries)) {
      state.data.entries[targetDate][pid] = { ...e };
    }
  }
  if (sourceReceipt !== undefined) {
    state.data.dailyReceipts[targetDate] = sourceReceipt;
  }
  if (sourceExtra !== undefined) {
    state.data.dailyExtras[targetDate] = { ...sourceExtra };
  }

  if (mode === 'move') {
    delete state.data.entries[state.selectedDate];
    delete state.data.dailyReceipts[state.selectedDate];
    delete state.data.dailyExtras[state.selectedDate];
  }

  state.selectedDate = targetDate;
  const { y, m } = parseDateParts(targetDate);
  state.year = y;
  state.month = m;
  document.getElementById('globalYear').value = String(y);
  document.getElementById('globalMonth').value = String(m);

  saveState();
  renderAll();
  document.getElementById('moveDistModal').classList.add('hidden');
  showToast(mode === 'move' ? 'تم نقل توزيعة اليوم للتاريخ الجديد بنجاح ✓' : 'تم نسخ توزيعة اليوم للتاريخ الجديد بنجاح ✓');
}

// ============================================================================
// Popup Quick Calculator
// ============================================================================

let calcDisplayVal = '0';
function initQuickCalculator() {
  const display = document.getElementById('calcDisplay');
  if (!display) return;

  function updateCalcDisplay() {
    display.value = calcDisplayVal;
  }

  document.querySelectorAll('.btn-calc').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = btn.getAttribute('data-calc');
      if (val === 'C') {
        calcDisplayVal = '0';
      } else if (val === 'DEL') {
        calcDisplayVal = calcDisplayVal.length > 1 ? calcDisplayVal.slice(0, -1) : '0';
      } else if (val === '=') {
        try {
          const safeExpr = calcDisplayVal.replace(/×/g, '*').replace(/÷/g, '/');
          if (/^[0-9+\-*/. ()]+$/.test(safeExpr)) {
            const res = Function(`'use strict'; return (${safeExpr})`)();
            if (typeof res === 'number' && isFinite(res) && !isNaN(res)) {
              calcDisplayVal = String(Number(res.toFixed(4)));
            } else {
              calcDisplayVal = 'خطأ';
            }
          }
        } catch (e) {
          calcDisplayVal = 'خطأ';
        }
      } else {
        if (calcDisplayVal === '0' || calcDisplayVal === 'خطأ') {
          calcDisplayVal = val;
        } else {
          calcDisplayVal += val;
        }
      }
      updateCalcDisplay();
    });
  });
}

// ============================================================================
// Smart Actions: Copy Previous Day & Carry-Over Remaining Balance
// ============================================================================

function copyPreviousDayDistribution() {
  const allDates = Object.keys(state.data.entries).sort();
  const prevDates = allDates.filter(d => d < state.selectedDate && Object.keys(state.data.entries[d] || {}).length > 0);

  if (prevDates.length === 0) {
    alert('لا توجد توزيعة مسجلة في أي يوم سابق لنسخها.');
    return;
  }

  const lastDate = prevDates[prevDates.length - 1];
  const prevEntries = state.data.entries[lastDate];

  if (!confirm(`هل تريد نسخ مبالغ التوزيع من يوم (${lastDate}) إلى اليوم الحالي (${state.selectedDate})؟`)) {
    return;
  }

  state.data.entries[state.selectedDate] = state.data.entries[state.selectedDate] || {};
  Object.keys(prevEntries).forEach(pid => {
    const existing = getPersonEntry(state.selectedDate, pid);
    state.data.entries[state.selectedDate][pid] = {
      cash: prevEntries[pid].cash || 0,
      invoice: existing.invoice || 0,
      note: existing.note || prevEntries[pid].note || ''
    };
  });

  saveState();
  renderDailyTab();
  showToast(`تم نسخ توزيعة يوم ${lastDate} بنجاح 📋`);
}

function carryOverRemainingToNextWorkday() {
  const totals = getDayTotals(state.selectedDate);
  if (totals.remaining <= 0) return;

  const { y, m, d } = parseDateParts(state.selectedDate);
  const nextDt = new Date(y, m - 1, d);
  nextDt.setDate(nextDt.getDate() + 1);
  if (nextDt.getDay() === 5) {
    nextDt.setDate(nextDt.getDate() + 1);
  }
  const nextDateKey = formatDateKey(nextDt.getFullYear(), nextDt.getMonth() + 1, nextDt.getDate());

  const remAmount = totals.remaining;
  if (!confirm(`هل تريد ترحيل المتبقي (${formatNumber(remAmount)} ر.ق) ليُضاف إلى مستلم يوم العمل التالي (${nextDateKey})؟`)) {
    return;
  }

  const curExtra = getDayExtra(state.selectedDate);
  setDayExtra(state.selectedDate, {
    amount: curExtra.amount + remAmount,
    note: curExtra.note ? `${curExtra.note} + مرحل ليوم ${nextDateKey}` : `مرحل ليوم ${nextDateKey}`,
    excludeFromCompany: true
  });

  const nextRec = getDayReceived(nextDateKey);
  setDayReceived(nextDateKey, nextRec + remAmount);

  renderDailyTab();
  showToast(`تم ترحيل ${formatNumber(remAmount)} ر.ق إلى يوم ${nextDateKey} بنجاح 🔄`);
}

// ============================================================================
// Navigation & Event Listeners
// ============================================================================


// ============================================================================
// Tab 9: Tanker Diesel & Project Allocation Module
// ============================================================================

function getTankerDeliveries(options = {}) {
  const deliveries = (state.data && Array.isArray(state.data.tankerDeliveries)) ? state.data.tankerDeliveries : [];
  const period = options.periodFilter || state.tankerPeriodFilter || 'current';
  const project = options.projectFilter || state.tankerProjectFilter || 'all';
  const search = (options.search !== undefined ? options.search : (state.tankerSearch || '')).trim().toLowerCase();

  return deliveries.filter(item => {
    // Period filter
    if (period === 'current') {
      const monthPrefix = `${state.year}-${String(state.month).padStart(2, '0')}-`;
      if (!item.date || !item.date.startsWith(monthPrefix)) return false;
    } else if (period === 'year') {
      const yearPrefix = `${state.year}-`;
      if (!item.date || !item.date.startsWith(yearPrefix)) return false;
    }

    // Project filter
    if (project && project !== 'all') {
      if (item.project !== project) return false;
    }

    // Live search filter across multiple fields
    if (search) {
      const matchProject = item.project && item.project.toLowerCase().includes(search);
      const matchInvoice = item.invoiceNo && item.invoiceNo.toLowerCase().includes(search);
      const matchReceiver = item.receiver && item.receiver.toLowerCase().includes(search);
      const matchSupplier = item.supplier && item.supplier.toLowerCase().includes(search);
      const matchNotes = item.notes && item.notes.toLowerCase().includes(search);
      if (!matchProject && !matchInvoice && !matchReceiver && !matchSupplier && !matchNotes) {
        return false;
      }
    }

    return true;
  }).sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
}

function calculateTankerKpis(deliveries = []) {
  const list = Array.isArray(deliveries) ? deliveries : [];
  let totalLiters = 0;
  let totalAmountCents = 0;
  const projectMap = {};

  list.forEach(item => {
    const liters = Number.isFinite(Number(item.liters)) && Number(item.liters) > 0 ? Number(item.liters) : 0;
    const amountCents = toCents(item.amount || 0);
    totalLiters += liters;
    totalAmountCents += amountCents;

    const prjName = item.project ? item.project.trim() : 'غير محدد';
    if (!projectMap[prjName]) {
      projectMap[prjName] = { project: prjName, liters: 0, amountCents: 0 };
    }
    projectMap[prjName].liters += liters;
    projectMap[prjName].amountCents += amountCents;
  });

  const totalAmount = fromCents(totalAmountCents);
  const avgPrice = totalLiters > 0 ? Number((totalAmount / totalLiters).toFixed(2)) : 0;

  const projectsBreakdown = Object.values(projectMap).map(p => {
    const pAmt = fromCents(p.amountCents);
    const pLiters = p.liters;
    const percentLiters = totalLiters > 0 ? Number(((pLiters / totalLiters) * 100).toFixed(1)) : 0;
    const percentAmount = totalAmount > 0 ? Number(((pAmt / totalAmount) * 100).toFixed(1)) : 0;
    return {
      project: p.project,
      liters: pLiters,
      amount: pAmt,
      percentLiters,
      percentAmount
    };
  }).sort((a, b) => b.amount - a.amount || b.liters - a.liters);

  return {
    totalLiters,
    totalAmount,
    avgPrice,
    count: list.length,
    projectsCount: Object.keys(projectMap).length,
    projectsBreakdown
  };
}

function addTankerDelivery(data = {}) {
  if (!state.data) state.data = createCleanData();
  if (!Array.isArray(state.data.tankerDeliveries)) state.data.tankerDeliveries = [];
  if (!Array.isArray(state.data.projectsList)) {
    state.data.projectsList = ['مشروع لوسيل', 'موقع الدوحة الجديدة', 'مشروع الخور', 'مشروع الوكرة', 'مشروع الريان'];
  }

  const project = typeof data.project === 'string' ? data.project.trim() : '';
  if (!project) {
    throw new Error('يرجى تحديد اسم المشروع / الموقع');
  }

  const liters = Number(data.liters);
  if (!Number.isFinite(liters) || liters <= 0) {
    throw new Error('يرجى إدخال كمية لترات صحيحة أكبر من الصفر');
  }

  let pricePerLiter = Number(data.pricePerLiter);
  let rawAmount = (data.amount !== undefined && data.amount !== null && data.amount !== '')
    ? Number(data.amount)
    : (Number.isFinite(liters) && liters > 0 ? (Number.isFinite(pricePerLiter) && pricePerLiter > 0 ? liters * pricePerLiter : liters * 2.100) : NaN);

  if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
    throw new Error('يرجى إدخال إجمالي مبلغ الفاتورة بشكل صحيح أكبر من الصفر');
  }
  const amount = fromCents(toCents(rawAmount));

  if (!Number.isFinite(pricePerLiter) || pricePerLiter <= 0) {
    pricePerLiter = Number((amount / liters).toFixed(3));
  } else {
    pricePerLiter = Number(pricePerLiter.toFixed(3));
  }

  const date = (typeof data.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.date))
    ? data.date
    : new Date().toISOString().split('T')[0];

  const delivery = {
    id: 'tank_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    date,
    project,
    liters,
    pricePerLiter,
    amount,
    invoiceNo: typeof data.invoiceNo === 'string' ? data.invoiceNo.trim() : '',
    receiver: typeof data.receiver === 'string' ? data.receiver.trim() : '',
    supplier: typeof data.supplier === 'string' ? data.supplier.trim() : '',
    notes: typeof data.notes === 'string' ? data.notes.trim() : '',
    createdAt: new Date().toISOString()
  };

  state.data.tankerDeliveries.push(delivery);

  if (!state.data.projectsList.includes(project)) {
    state.data.projectsList.push(project);
  }

  if (typeof saveState === 'function') {
    saveState();
  }

  return delivery;
}

function updateTankerDelivery(id, data = {}) {
  if (!state.data || !Array.isArray(state.data.tankerDeliveries)) return null;
  const item = state.data.tankerDeliveries.find(d => d.id === id);
  if (!item) return null;

  if (data.project !== undefined) {
    const prj = typeof data.project === 'string' ? data.project.trim() : '';
    if (!prj) throw new Error('يرجى تحديد اسم المشروع / الموقع');
    item.project = prj;
    if (!state.data.projectsList.includes(prj)) {
      state.data.projectsList.push(prj);
    }
  }

  if (data.date !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
    item.date = data.date;
  }

  let litersChanged = false;
  if (data.liters !== undefined) {
    const l = Number(data.liters);
    if (!Number.isFinite(l) || l <= 0) throw new Error('يرجى إدخال كمية لترات صحيحة أكبر من الصفر');
    item.liters = l;
    litersChanged = true;
  }

  let amountChanged = false;
  if (data.amount !== undefined) {
    const a = Number(data.amount);
    if (Number.isFinite(a) && a > 0) {
      item.amount = fromCents(toCents(a));
      amountChanged = true;
    }
  }

  if (data.pricePerLiter !== undefined && Number.isFinite(Number(data.pricePerLiter)) && Number(data.pricePerLiter) > 0) {
    item.pricePerLiter = Number(Number(data.pricePerLiter).toFixed(3));
  } else if (litersChanged || amountChanged) {
    item.pricePerLiter = item.liters > 0 ? Number((item.amount / item.liters).toFixed(3)) : item.pricePerLiter;
  }

  if (data.invoiceNo !== undefined) item.invoiceNo = typeof data.invoiceNo === 'string' ? data.invoiceNo.trim() : '';
  if (data.receiver !== undefined) item.receiver = typeof data.receiver === 'string' ? data.receiver.trim() : '';
  if (data.supplier !== undefined) item.supplier = typeof data.supplier === 'string' ? data.supplier.trim() : '';
  if (data.notes !== undefined) item.notes = typeof data.notes === 'string' ? data.notes.trim() : '';

  if (typeof saveState === 'function') {
    saveState();
  }

  return item;
}

function deleteTankerDelivery(id) {
  if (!state.data || !Array.isArray(state.data.tankerDeliveries)) return false;
  const idx = state.data.tankerDeliveries.findIndex(d => d.id === id);
  if (idx === -1) return false;
  state.data.tankerDeliveries.splice(idx, 1);
  if (typeof saveState === 'function') {
    saveState();
  }
  return true;
}

function updateTankerDatalists() {
  if (typeof document === 'undefined') return;
  const prjDatalist = document.getElementById('tankerProjectsDatalist');
  const recDatalist = document.getElementById('tankerReceiversDatalist');
  const supDatalist = document.getElementById('tankerSuppliersDatalist');

  const deliveries = (state.data && Array.isArray(state.data.tankerDeliveries)) ? state.data.tankerDeliveries : [];
  const projects = Array.from(new Set([
    ...(state.data?.projectsList || []),
    ...deliveries.map(d => d.project)
  ])).filter(Boolean).sort();

  const receivers = Array.from(new Set(deliveries.map(d => d.receiver))).filter(Boolean).sort();
  const suppliers = Array.from(new Set(deliveries.map(d => d.supplier))).filter(Boolean).sort();

  if (prjDatalist) prjDatalist.innerHTML = projects.map(p => `<option value="${escapeHtml(p)}"></option>`).join('');
  if (recDatalist) recDatalist.innerHTML = receivers.map(r => `<option value="${escapeHtml(r)}"></option>`).join('');
  if (supDatalist) supDatalist.innerHTML = suppliers.map(s => `<option value="${escapeHtml(s)}"></option>`).join('');
}

function addProjectToMasterList(projectName) {
  if (!projectName || typeof projectName !== 'string') throw new Error('يرجى إدخال اسم المشروع أو الموقع أولاً');
  const clean = projectName.trim();
  if (!clean) throw new Error('يرجى إدخال اسم المشروع أو الموقع أولاً');
  if (!state.data) state.data = createCleanData();
  if (!Array.isArray(state.data.projectsList)) {
    state.data.projectsList = ['مشروع لوسيل', 'موقع الدوحة الجديدة', 'مشروع الخور', 'مشروع الوكرة', 'مشروع الريان'];
  }
  if (state.data.projectsList.some(p => p.toLowerCase() === clean.toLowerCase())) {
    throw new Error('هذا المشروع مسجل بالفعل في الدليل');
  }
  state.data.projectsList.push(clean);
  if (typeof saveState === 'function') {
    saveState();
  }
  updateTankerDatalists();
  renderTankerTab();
  renderProjectsDirectoryList();
  return clean;
}

function removeProjectFromMasterList(projectName) {
  if (!state.data || !Array.isArray(state.data.projectsList)) return false;
  const deliveries = state.data.tankerDeliveries || [];
  const hasDeliveries = deliveries.some(d => d.project === projectName);
  if (hasDeliveries) {
    throw new Error('لا يمكن حذف هذا المشروع لوجود بونات تفريغ ديزل مسجلة عليه');
  }
  state.data.projectsList = state.data.projectsList.filter(p => p !== projectName);
  if (typeof saveState === 'function') {
    saveState();
  }
  updateTankerDatalists();
  renderTankerTab();
  renderProjectsDirectoryList();
  return true;
}

function openTankerProjectsModal() {
  if (typeof document === 'undefined') return;
  const modal = document.getElementById('tankerProjectsModal');
  if (modal) {
    modal.classList.remove('hidden');
    renderProjectsDirectoryList();
    const inp = document.getElementById('newTankerProjectInput');
    if (inp) {
      inp.value = '';
      inp.focus();
    }
  }
}

function closeTankerProjectsModal() {
  if (typeof document === 'undefined') return;
  const modal = document.getElementById('tankerProjectsModal');
  if (modal) modal.classList.add('hidden');
  updateTankerDatalists();
  renderTankerTab();
}

function renderProjectsDirectoryList() {
  if (typeof document === 'undefined') return;
  const container = document.getElementById('tankerProjectsListContainer');
  const badge = document.getElementById('tankerProjectsTotalBadge');
  if (!container) return;

  const isEn = state.tankerLang === 'en';
  const deliveries = state.data?.tankerDeliveries || [];
  const projects = Array.from(new Set([
    ...(state.data?.projectsList || [])
  ])).filter(Boolean).sort();

  if (badge) {
    badge.textContent = isEn ? `${projects.length} Sites` : `${projects.length} مشاريع`;
  }

  if (projects.length === 0) {
    container.innerHTML = `<div class="text-muted" style="text-align: center; padding: 18px;">${isEn ? 'No projects registered in directory.' : 'لا توجد مشاريع مسجلة في الدليل حالياً.'}</div>`;
    return;
  }

  container.innerHTML = projects.map(p => {
    const projectDeliveries = deliveries.filter(d => d.project === p);
    const count = projectDeliveries.length;
    const totalLiters = projectDeliveries.reduce((acc, d) => acc + (Number(d.liters) || 0), 0);
    const totalAmount = fromCents(projectDeliveries.reduce((acc, d) => acc + toCents(d.amount || 0), 0));
    const canDelete = count === 0;

    return `
      <div class="card" style="margin: 0; padding: 10px 14px; display: flex; align-items: center; justify-content: space-between; gap: 10px; background: var(--bg-hover); border: 1px solid var(--border-color); border-radius: 8px;">
        <div style="flex: 1; min-width: 0;">
          <div style="font-weight: 700; color: var(--text-color); font-size: 0.95rem; display: flex; align-items: center; gap: 6px;">
            <span>🏗️</span>
            <span>${escapeHtml(p)}</span>
          </div>
          <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 3px;">
            ${count > 0
              ? `<span>⛽ <strong>${count}</strong> ${isEn ? 'Vouchers' : 'بون تفريغ'}</span> • <span>${formatNumber(totalLiters)} ${isEn ? 'L' : 'لتر'}</span> • <span>${formatNumber(totalAmount, true)} ${isEn ? 'QAR' : 'ر.ق'}</span>`
              : `<span class="text-muted">${isEn ? 'Available site (No deliveries logged yet)' : 'مشروع متاح بالدليل (لم يُسجل عليه تفريغ بعد)'}</span>`}
          </div>
        </div>
        <div>
          ${canDelete
            ? `<button type="button" class="btn btn-sm btn-outline btn-delete-project" data-project="${escapeHtml(p)}" style="color: var(--danger-color); padding: 4px 10px; font-size: 0.8rem;" title="${isEn ? 'Delete Project' : 'حذف المشروع'}">🗑️ ${isEn ? 'Delete' : 'حذف'}</button>`
            : `<span class="badge" style="background: rgba(34, 197, 94, 0.15); color: var(--success-color); font-size: 0.78rem;">${isEn ? 'Active & Supplied' : 'نشط ومستفيد'}</span>`
          }
        </div>
      </div>
    `;
  }).join('');
}

function openTankerModal(deliveryId = null) {
  state.editingTankerDeliveryId = deliveryId;
  const modal = document.getElementById('tankerDeliveryModal');
  const title = document.getElementById('tankerModalTitle');
  const idInput = document.getElementById('tankerDeliveryId');
  const dateInput = document.getElementById('tankerDateInput');
  const prjInput = document.getElementById('tankerProjectInput');
  const litersInput = document.getElementById('tankerLitersInput');
  const priceInput = document.getElementById('tankerPricePerLiterInput');
  const amountInput = document.getElementById('tankerAmountInput');
  const invoiceInput = document.getElementById('tankerInvoiceNoInput');
  const receiverInput = document.getElementById('tankerReceiverInput');
  const supplierInput = document.getElementById('tankerSupplierInput');
  const notesInput = document.getElementById('tankerNotesInput');

  updateTankerDatalists();

  if (deliveryId) {
    const d = (state.data?.tankerDeliveries || []).find(item => item.id === deliveryId);
    if (!d) return;
    if (title) title.textContent = state.tankerLang === 'en' ? 'Edit Tanker Diesel Voucher' : 'تعديل بون توريد ديزل / سولار';
    if (idInput) idInput.value = d.id;
    if (dateInput) dateInput.value = d.date;
    if (prjInput) prjInput.value = d.project;
    if (litersInput) litersInput.value = d.liters;
    if (priceInput) priceInput.value = d.pricePerLiter || '';
    if (amountInput) amountInput.value = d.amount;
    if (invoiceInput) invoiceInput.value = d.invoiceNo || '';
    if (receiverInput) receiverInput.value = d.receiver || '';
    if (supplierInput) supplierInput.value = d.supplier || '';
    if (notesInput) notesInput.value = d.notes || '';
  } else {
    state.editingTankerDeliveryId = null;
    if (title) title.textContent = state.tankerLang === 'en' ? 'Log New Tanker Delivery' : 'تسجيل تفريغ تانكر سولار جديد';
    if (idInput) idInput.value = '';
    const todayStr = new Date().toISOString().split('T')[0];
    if (dateInput) dateInput.value = todayStr;
    if (prjInput) prjInput.value = '';
    if (litersInput) litersInput.value = '';
    if (priceInput) priceInput.value = '2.100';
    if (amountInput) amountInput.value = '';
    if (invoiceInput) invoiceInput.value = '';
    if (receiverInput) receiverInput.value = '';
    if (supplierInput) supplierInput.value = 'شركة وقود (WOQOD)';
    if (notesInput) notesInput.value = '';
  }

  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('active');
    setTimeout(() => prjInput?.focus(), 50);
  }
}

function closeTankerModal() {
  const modal = document.getElementById('tankerDeliveryModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('active');
  }
  state.editingTankerDeliveryId = null;
  const idInput = document.getElementById('tankerDeliveryId');
  if (idInput) idInput.value = '';
}

function handleSaveTankerDelivery() {
  const idInput = document.getElementById('tankerDeliveryId');
  const dateInput = document.getElementById('tankerDateInput');
  const prjInput = document.getElementById('tankerProjectInput');
  const litersInput = document.getElementById('tankerLitersInput');
  const priceInput = document.getElementById('tankerPricePerLiterInput');
  const amountInput = document.getElementById('tankerAmountInput');
  const invoiceInput = document.getElementById('tankerInvoiceNoInput');
  const receiverInput = document.getElementById('tankerReceiverInput');
  const supplierInput = document.getElementById('tankerSupplierInput');
  const notesInput = document.getElementById('tankerNotesInput');

  let litersVal = parseFloat(litersInput?.value);
  let priceVal = parseFloat(priceInput?.value);
  let amountVal = parseFloat(amountInput?.value);

  // Auto-calculate amount if missing but liters are positive
  if ((!Number.isFinite(amountVal) || amountVal <= 0) && Number.isFinite(litersVal) && litersVal > 0) {
    if (Number.isFinite(priceVal) && priceVal > 0) {
      amountVal = Number((litersVal * priceVal).toFixed(2));
    } else {
      priceVal = 2.100;
      amountVal = Number((litersVal * 2.100).toFixed(2));
    }
    if (amountInput) amountInput.value = amountVal.toFixed(2);
  }

  const deliveryData = {
    date: dateInput?.value || new Date().toISOString().split('T')[0],
    project: prjInput?.value.trim() || '',
    liters: litersVal,
    pricePerLiter: priceVal || 0,
    amount: amountVal,
    invoiceNo: invoiceInput?.value.trim() || '',
    receiver: receiverInput?.value.trim() || '',
    supplier: supplierInput?.value.trim() || '',
    notes: notesInput?.value.trim() || ''
  };

  try {
    const editId = state.editingTankerDeliveryId || (idInput?.value ? idInput.value : null);
    if (editId) {
      updateTankerDelivery(editId, deliveryData);
      showToast(state.tankerLang === 'en' ? 'Diesel voucher updated successfully ⛽' : 'تم تحديث بيانات بون الديزل بنجاح ⛽');
    } else {
      addTankerDelivery(deliveryData);
      showToast(state.tankerLang === 'en' ? 'Diesel delivery logged successfully ⛽' : 'تم تسجيل تفريغ الديزل بنجاح ⛽');
    }

    // Crucial: Reset filters so the user 100% sees their newly added voucher in the table!
    state.tankerProjectFilter = 'all';
    state.tankerPeriodFilter = 'all';
    state.tankerSearch = '';

    const prjFilterSelect = document.getElementById('tankerProjectFilter');
    if (prjFilterSelect) prjFilterSelect.value = 'all';
    const perFilterSelect = document.getElementById('tankerPeriodFilter');
    if (perFilterSelect) perFilterSelect.value = 'all';
    const searchInput = document.getElementById('tankerSearchInput');
    if (searchInput) searchInput.value = '';

    closeTankerModal();
    renderTankerTab();
  } catch (err) {
    alert(err.message);
  }
}

function renderTankerTab() {
  if (typeof document === 'undefined') return;
  const isEn = state.tankerLang === 'en';

  // Toggle language button states
  const btnAr = document.getElementById('btnTankerLangAr');
  const btnEn = document.getElementById('btnTankerLangEn');
  if (btnAr) btnAr.classList.toggle('active', !isEn);
  if (btnEn) btnEn.classList.toggle('active', isEn);

  // Update Header Titles & Badge
  const titleEl = document.getElementById('tankerMainTitle');
  const badgeEl = document.getElementById('tankerBadge');
  const subEl = document.getElementById('tankerSubTitle');
  if (titleEl) {
    titleEl.textContent = isEn ? '⛽ Tanker Diesel & Projects Allocation' : '⛽ سولار التانكر وتوزيع المشاريع';
  }
  if (badgeEl) {
    badgeEl.textContent = isEn ? 'Fuel & Site Operations' : 'ديزل المحروقات والمواقع';
  }
  if (subEl) {
    subEl.textContent = isEn
      ? 'Diesel unloading from tanker, supplier invoice settlements, and site consumption allocation by liters and cost (QAR)'
      : 'تفريغ ديزل المحروقات من التانكر، سداد فواتير المورد، وتوزيع استهلاك كل موقع ومشروع باللتر والمبلغ (ر.ق)';
  }

  // Update Action Button Labels
  const lblAdd = document.getElementById('lblOpenTankerModal');
  const lblManagePrj = document.getElementById('lblManageTankerProjects');
  const lblPrint = document.getElementById('lblPrintTankerStatement');
  const lblExport = document.getElementById('lblExportTankerExcel');
  if (lblAdd) lblAdd.textContent = isEn ? 'Log Diesel Delivery' : 'تسجيل تفريغ تانكر جديد';
  if (lblManagePrj) lblManagePrj.textContent = isEn ? 'Projects Directory' : 'دليل المشاريع';
  if (lblPrint) lblPrint.textContent = isEn ? 'Print Diesel Statement' : 'طباعة كشف السولار';
  if (lblExport) lblExport.textContent = isEn ? 'Export Excel (CSV)' : 'تصدير إكسيل';

  const allDeliveries = (state.data && Array.isArray(state.data.tankerDeliveries)) ? state.data.tankerDeliveries : [];
  const deliveries = getTankerDeliveries({
    periodFilter: state.tankerPeriodFilter,
    projectFilter: state.tankerProjectFilter,
    search: state.tankerSearch
  });

  // Filter notice banner handling
  const noticeBanner = document.getElementById('tankerActiveFilterNotice');
  const noticeText = document.getElementById('tankerActiveFilterNoticeText');
  const noticeBtn = document.getElementById('btnResetTankerFilters');
  const isFiltered = (state.tankerPeriodFilter !== 'all' || state.tankerProjectFilter !== 'all' || (state.tankerSearch && state.tankerSearch.trim() !== ''));

  if (noticeBanner) {
    if (isFiltered && deliveries.length < allDeliveries.length) {
      noticeBanner.classList.remove('hidden');
      if (noticeText) {
        noticeText.textContent = isEn
          ? `🔍 Filter active: Showing ${deliveries.length} of ${allDeliveries.length} vouchers.`
          : `🔍 يتم عرض بونات مفلترة حالياً: ${deliveries.length} من أصل ${allDeliveries.length} بون مسجل.`;
      }
      if (noticeBtn) {
        noticeBtn.textContent = isEn ? 'Show All Vouchers (Reset Filter)' : 'إظهار كافة البونات (عرض الكل)';
      }
    } else {
      noticeBanner.classList.add('hidden');
    }
  }

  const kpis = calculateTankerKpis(deliveries);

  // 1. Update KPI cards
  const lblLiters = document.getElementById('lblKpiTankerLiters');
  const subLiters = document.getElementById('subKpiTankerLiters');
  const elLiters = document.getElementById('kpiTankerTotalLiters');
  if (lblLiters) lblLiters.textContent = isEn ? '⛽ Total Liters Delivered' : '⛽ إجمالي اللترات المفرغة';
  if (subLiters) subLiters.textContent = isEn ? 'Total diesel volume received' : 'مجموع كميات الديزل المستلمة';
  if (elLiters) elLiters.textContent = isEn ? `${formatNumber(kpis.totalLiters)} Liters` : `${formatNumber(kpis.totalLiters)} لتر`;

  const lblAmount = document.getElementById('lblKpiTankerAmount');
  const subAmount = document.getElementById('subKpiTankerAmount');
  const elAmount = document.getElementById('kpiTankerTotalAmount');
  if (lblAmount) lblAmount.textContent = isEn ? '💰 Total Diesel Cost' : '💰 إجمالي المدفوع للتانكر';
  if (subAmount) subAmount.textContent = isEn ? 'Total invoice expenditures' : 'إجمالي قيمة فواتير التوريد';
  if (elAmount) elAmount.textContent = isEn ? `${formatNumber(kpis.totalAmount, true)} QAR` : `${formatNumber(kpis.totalAmount, true)} ر.ق`;

  const lblAvg = document.getElementById('lblKpiTankerAvg');
  const subAvg = document.getElementById('subKpiTankerAvg');
  const elAvgPrice = document.getElementById('kpiTankerAvgPrice');
  if (lblAvg) lblAvg.textContent = isEn ? '🏷️ Average Price / Liter' : '🏷️ متوسط سعر اللتر';
  if (subAvg) subAvg.textContent = isEn ? 'Weighted average cost per liter' : 'المتوسط المرجح للتكلفة';
  if (elAvgPrice) elAvgPrice.textContent = isEn ? `${kpis.avgPrice.toFixed(3)} QAR/L` : `${kpis.avgPrice.toFixed(3)} ر.ق/لتر`;

  const lblProjects = document.getElementById('lblKpiTankerProjects');
  const subProjects = document.getElementById('subKpiTankerProjects');
  const elProjectsCount = document.getElementById('kpiTankerProjectsCount');
  const totalMasterProjects = Array.from(new Set([
    ...(state.data?.projectsList || []),
    ...(state.data?.tankerDeliveries || []).map(d => d.project)
  ])).filter(Boolean).length;

  if (lblProjects) lblProjects.textContent = isEn ? '🏗️ Allocated Projects' : '🏗️ المشاريع المستفيدة';
  if (subProjects) {
    subProjects.textContent = isEn
      ? `Supplied sites (${totalMasterProjects} in directory)`
      : `مواقع مفرغ بها (${totalMasterProjects} مسجلة بالدليل)`;
  }
  if (elProjectsCount) {
    elProjectsCount.textContent = kpis.projectsCount > 0
      ? (isEn ? `${kpis.projectsCount} Sites` : `${kpis.projectsCount} موقع`)
      : (isEn ? `0 Active (${totalMasterProjects} Registered)` : `0 مستفيدة (${totalMasterProjects} بالدليل)`);
  }

  // 2. Update Project Filter & Period Filter Labels
  const lblFilterPrj = document.getElementById('lblTankerFilterProject');
  const lblFilterPer = document.getElementById('lblTankerFilterPeriod');
  if (lblFilterPrj) lblFilterPrj.textContent = isEn ? 'Project:' : 'المشروع:';
  if (lblFilterPer) lblFilterPer.textContent = isEn ? 'Period:' : 'الفترة:';

  const optCur = document.getElementById('optPeriodCurrent');
  const optYr = document.getElementById('optPeriodYear');
  const optAll = document.getElementById('optPeriodAll');
  if (optCur) optCur.textContent = isEn ? 'Current Selected Month' : 'الشهر الحالي المحدد';
  if (optYr) optYr.textContent = isEn ? 'Full Current Year' : 'كامل السنة الحالية';
  if (optAll) optAll.textContent = isEn ? 'All Time (Full Log)' : 'كل الأوقات (سجل شامل)';

  const searchInput = document.getElementById('tankerSearchInput');
  if (searchInput) {
    searchInput.placeholder = isEn
      ? 'Search project, invoice, receiver, supplier...'
      : 'ابحث بالمشروع، رقم الفاتورة، المستلم...';
  }

  const prjFilterSelect = document.getElementById('tankerProjectFilter');
  if (prjFilterSelect) {
    const curVal = state.tankerProjectFilter || 'all';
    const allProjects = Array.from(new Set([
      ...(state.data.projectsList || []),
      ...(state.data.tankerDeliveries || []).map(d => d.project)
    ])).filter(Boolean).sort();

    let optionsHtml = `<option value="all">${isEn ? 'All Projects & Sites' : 'جميع المشاريع والمواقع'}</option>`;
    allProjects.forEach(p => {
      const selected = (p === curVal) ? 'selected' : '';
      optionsHtml += `<option value="${escapeHtml(p)}" ${selected}>${escapeHtml(p)}</option>`;
    });
    prjFilterSelect.innerHTML = optionsHtml;
  }

  // 3. Update Project Breakdown List
  const lblBreakdown = document.getElementById('lblTankerBreakdownTitle');
  if (lblBreakdown) {
    lblBreakdown.textContent = isEn ? '📊 Project Consumption & Cost Breakdown:' : '📊 ملخص توزيع الاستهلاك على المشاريع:';
  }
  const breakdownList = document.getElementById('tankerProjectsBreakdownList');
  const breakdownSummaryText = document.getElementById('tankerBreakdownSummaryText');
  if (breakdownSummaryText) {
    if (isEn) {
      breakdownSummaryText.textContent = kpis.projectsBreakdown.length > 0
        ? `Fuel and cost allocation across ${kpis.projectsBreakdown.length} sites:`
        : 'No projects registered for this period.';
    } else {
      breakdownSummaryText.textContent = kpis.projectsBreakdown.length > 0
        ? `توزيع استهلاك وتكلفة السولار على المشاريع (${kpis.projectsBreakdown.length} مواقع):`
        : 'لا توجد مشاريع مسجلة لهذه الفترة.';
    }
  }
  if (breakdownList) {
    if (kpis.projectsBreakdown.length === 0) {
      breakdownList.innerHTML = `<span class="text-muted" style="font-size: 0.85rem;">${isEn ? 'No project delivery data available.' : 'لا توجد بيانات تفريغ للمشاريع حالياً.'}</span>`;
    } else {
      breakdownList.innerHTML = kpis.projectsBreakdown.map(p => `
        <div class="project-breakdown-pill">
          <div class="pill-project-name">🏗️ ${escapeHtml(p.project)}</div>
          <div class="pill-stats">
            <span>⛽ <strong>${formatNumber(p.liters)}</strong> ${isEn ? 'L' : 'لتر'} (${p.percentLiters}%)</span>
            <span>💰 <strong>${formatNumber(p.amount, true)}</strong> ${isEn ? 'QAR' : 'ر.ق'} (${p.percentAmount}%)</span>
          </div>
        </div>
      `).join('');
    }
  }

  // 4. Update Table Headers
  const thead = document.getElementById('tankerTableHead');
  if (thead) {
    if (isEn) {
      thead.innerHTML = `
        <tr>
          <th class="col-tanker-num" style="text-align: center;">#</th>
          <th class="col-tanker-date" style="text-align: center;">Date</th>
          <th class="col-tanker-project" style="text-align: left;">Project / Site Name</th>
          <th class="col-tanker-liters" style="text-align: right;">Quantity (Liters)</th>
          <th class="col-tanker-price" style="text-align: right;">Price / Liter</th>
          <th class="col-tanker-amount" style="text-align: right;">Invoice Total (QAR)</th>
          <th class="col-tanker-invoiceno" style="text-align: center;">Invoice Ref</th>
          <th class="col-tanker-receiver" style="text-align: left;">Site Receiver</th>
          <th class="col-tanker-supplier" style="text-align: left;">Supplier / Tanker</th>
          <th class="col-tanker-actions no-print" style="text-align: center;">Actions</th>
        </tr>
      `;
    } else {
      thead.innerHTML = `
        <tr>
          <th class="col-tanker-num" style="text-align: center;">#</th>
          <th class="col-tanker-date" style="text-align: center;">التاريخ</th>
          <th class="col-tanker-project" style="text-align: right;">اسم المشروع / الموقع</th>
          <th class="col-tanker-liters" style="text-align: right;">الكمية (لتر)</th>
          <th class="col-tanker-price" style="text-align: right;">سعر اللتر</th>
          <th class="col-tanker-amount" style="text-align: right;">إجمالي الفاتورة</th>
          <th class="col-tanker-invoiceno" style="text-align: center;">رقم الفاتورة</th>
          <th class="col-tanker-receiver" style="text-align: right;">المستلم بالموقع</th>
          <th class="col-tanker-supplier" style="text-align: right;">المورد / التانكر</th>
          <th class="col-tanker-actions no-print" style="text-align: center;">الإجراءات</th>
        </tr>
      `;
    }
  }

  // 5. Update Table Body
  const tbody = document.getElementById('tankerTableBody');
  if (tbody) {
    if (deliveries.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="10" class="empty-state" style="text-align: center; padding: 28px; color: var(--text-muted);">
            ${isEn ? 'No fuel delivery vouchers found for this period or search criteria.' : 'لا توجد بونات توريد مسجلة لهذه الفترة أو معايير البحث المحددة.'}
          </td>
        </tr>
      `;
    } else {
      tbody.innerHTML = deliveries.map((item, idx) => `
        <tr>
          <td class="col-tanker-num" style="text-align: center; font-weight: 700;">${idx + 1}</td>
          <td class="col-tanker-date" style="font-family: monospace; white-space: nowrap; text-align: center;">${item.date}</td>
          <td class="col-tanker-project" style="font-weight: 700; color: var(--primary-color);"><span class="no-print">🏗️ </span>${escapeHtml(item.project)}</td>
          <td class="col-tanker-liters" style="font-weight: 700; text-align: right; white-space: nowrap;">${formatNumber(item.liters)} ${isEn ? 'L' : 'لتر'}</td>
          <td class="col-tanker-price" style="text-align: right; font-family: monospace; white-space: nowrap;">${item.pricePerLiter ? item.pricePerLiter.toFixed(3) : '-'}</td>
          <td class="col-tanker-amount" style="font-weight: 800; text-align: right; color: var(--success-color); white-space: nowrap;">${formatNumber(item.amount, true)} ${isEn ? 'QAR' : 'ر.ق'}</td>
          <td class="col-tanker-invoiceno" style="font-family: monospace; text-align: center; white-space: nowrap;">${escapeHtml(item.invoiceNo || '-')}</td>
          <td class="col-tanker-receiver">${escapeHtml(item.receiver || '-')}</td>
          <td class="col-tanker-supplier">${escapeHtml(item.supplier || '-')}</td>
          <td class="col-tanker-actions no-print" style="text-align: center; white-space: nowrap;">
            <button type="button" class="btn btn-sm btn-outline btn-edit-tanker" data-id="${item.id}" title="${isEn ? 'Edit voucher' : 'تعديل هذا البون'}" style="padding: 3px 8px; font-size: 0.8rem;">✏️ ${isEn ? 'Edit' : 'تعديل'}</button>
            <button type="button" class="btn btn-sm btn-outline btn-delete-tanker" data-id="${item.id}" title="${isEn ? 'Delete voucher' : 'حذف هذا البون'}" style="padding: 3px 8px; font-size: 0.8rem; color: var(--danger-color); margin-inline-start: 4px;">🗑️ ${isEn ? 'Delete' : 'حذف'}</button>
          </td>
        </tr>
      `).join('');
    }
  }

  // 6. Update Table Foot
  const tfoot = document.getElementById('tankerTableFoot');
  if (tfoot) {
    if (deliveries.length === 0) {
      tfoot.innerHTML = '';
    } else {
      tfoot.innerHTML = `
        <tr style="background: var(--bg-hover); font-weight: 800; border-top: 2px solid var(--border-color);">
          <td colspan="3" class="col-tanker-project" style="text-align: center;">${isEn ? `Grand Total (${deliveries.length} Deliveries)` : `الإجمالي العام (${deliveries.length} بون توريد)`}</td>
          <td class="col-tanker-liters" style="text-align: right; color: var(--primary-color); white-space: nowrap;">${formatNumber(kpis.totalLiters)} ${isEn ? 'L' : 'لتر'}</td>
          <td class="col-tanker-price" style="text-align: right; font-family: monospace; white-space: nowrap;">${kpis.avgPrice.toFixed(3)}</td>
          <td class="col-tanker-amount" style="text-align: right; color: var(--success-color); font-size: 1.05rem; white-space: nowrap;">${formatNumber(kpis.totalAmount, true)} ${isEn ? 'QAR' : 'ر.ق'}</td>
          <td class="col-tanker-invoiceno"></td>
          <td class="col-tanker-receiver"></td>
          <td class="col-tanker-supplier"></td>
          <td class="col-tanker-actions no-print"></td>
        </tr>
      `;
    }
  }

  // 7. Corporate Print Elements & Tafqeet
  const pComp = document.getElementById('printTankerCompanyName');
  const pDept = document.getElementById('printTankerDeptName');
  const pLegal = document.getElementById('printTankerLegalMeta');
  const pTitle = document.getElementById('printTankerDocTitle');
  const pVouchLbl = document.getElementById('printTankerVoucherNoLbl');
  const pDateLbl = document.getElementById('printTankerDateLbl');
  const pCurrLbl = document.getElementById('printTankerCurrencyLbl');
  const pCurrVal = document.getElementById('printTankerCurrencyVal');
  const pCopyLbl = document.getElementById('printTankerCopyLbl');
  const pCopyVal = document.getElementById('printTankerCopyVal');

  if (pComp) pComp.textContent = isEn ? 'HELIOPOLIS ELECTRIC COMPANY' : 'شركة هليوبوليس للكهرباء';
  if (pDept) pDept.textContent = isEn ? 'Projects Management & Logistics — Fuel & Diesel Department' : 'إدارة المشاريع والخدمات اللوجستية — قسم المحروقات والديزل';
  if (pLegal) {
    pLegal.textContent = isEn
      ? 'Official Website: heliopoliselectric.ae | Abu Dhabi: +971 2 641 2641 | Doha: +974 4463 4054'
      : 'الموقع الرسمي: heliopoliselectric.ae | هاتف أبوظبي: 26412641 (971+) | الدوحة: 44634054 (974+)';
  }
  if (pTitle) {
    pTitle.textContent = isEn
      ? 'DIESEL DISBURSEMENT & PROJECT ALLOCATION STATEMENT'
      : 'كشف تفريغ وتوزيع السولار على المشاريع';
  }
  if (pVouchLbl) pVouchLbl.textContent = isEn ? 'Voucher Ref:' : 'رقم السند:';
  if (pDateLbl) pDateLbl.textContent = isEn ? 'Statement Date:' : 'تاريخ الكشف:';
  if (pCurrLbl) pCurrLbl.textContent = isEn ? 'Currency:' : 'العملة:';
  if (pCurrVal) pCurrVal.textContent = isEn ? 'Qatari Riyal (QAR)' : 'ريال قطري (QAR)';
  if (pCopyLbl) pCopyLbl.textContent = isEn ? 'Copy:' : 'النسخة:';
  if (pCopyVal) pCopyVal.textContent = isEn ? 'Original - Accounts & Projects Dept.' : 'الأصل - قسم الحسابات والمشاريع';

  const rLitersLbl = document.getElementById('reconLblTankerLiters');
  const rAmountLbl = document.getElementById('reconLblTankerAmount');
  const rAvgLbl = document.getElementById('reconLblTankerAvgPrice');
  const rPrjLbl = document.getElementById('reconLblTankerProjects');
  if (rLitersLbl) rLitersLbl.textContent = isEn ? 'Total Diesel Volume' : 'إجمالي كمية الديزل';
  if (rAmountLbl) rAmountLbl.textContent = isEn ? 'Total Diesel Cost' : 'إجمالي تكلفة السولار';
  if (rAvgLbl) rAvgLbl.textContent = isEn ? 'Average Price / Liter' : 'متوسط سعر اللتر';
  if (rPrjLbl) rPrjLbl.textContent = isEn ? 'Supplied Sites Count' : 'عدد المواقع المفرغ بها';

  const elPrintDate = document.getElementById('printTankerDate');
  const elPrintVoucher = document.getElementById('printTankerVoucherNo');
  const elPrintLiters = document.getElementById('printReconTankerLiters');
  const elPrintAmount = document.getElementById('printReconTankerAmount');
  const elPrintAvg = document.getElementById('printReconTankerAvgPrice');
  const elPrintProjects = document.getElementById('printReconTankerProjectsCount');
  const elPrintTafqeet = document.getElementById('printTankerTafqeetText');
  const lblTafqeet = document.getElementById('tankerTafqeetLbl');

  const curDateStr = state.selectedDate || `${state.year}-${String(state.month).padStart(2, '0')}-01`;
  const { y: dy, m: dm, d: dd } = parseDateParts(curDateStr);
  if (elPrintDate) {
    elPrintDate.textContent = isEn
      ? `${getEnglishDayName(dy, dm, dd)}, ${curDateStr}`
      : `${getArabicDayName(dy, dm, dd)} ${curDateStr}`;
  }
  if (elPrintVoucher) elPrintVoucher.textContent = `DSL-${state.year}${String(state.month).padStart(2, '0')}-001`;
  if (elPrintLiters) elPrintLiters.textContent = isEn ? `${formatNumber(kpis.totalLiters)} Liters` : `${formatNumber(kpis.totalLiters)} لتر`;
  if (elPrintAmount) elPrintAmount.textContent = `${formatNumber(kpis.totalAmount, true)} QAR`;
  if (elPrintAvg) elPrintAvg.textContent = `${kpis.avgPrice.toFixed(3)} QAR`;
  if (elPrintProjects) elPrintProjects.textContent = isEn ? `${kpis.projectsCount} Sites` : `${kpis.projectsCount}`;

  if (lblTafqeet) lblTafqeet.textContent = isEn ? 'Total Amount in Words:' : 'إجمالي الفواتير كتابة بالحروف:';
  if (elPrintTafqeet) {
    elPrintTafqeet.textContent = isEn
      ? (typeof moneyToEnglishWords === 'function' ? moneyToEnglishWords(kpis.totalAmount) : `${formatNumber(kpis.totalAmount, true)} QAR Only`)
      : (typeof moneyToArabicWords === 'function' ? (moneyToArabicWords(kpis.totalAmount) + ' لا غير') : `فقط ${formatNumber(kpis.totalAmount, true)} ريال قطري لا غير`);
  }

  const sTitle1 = document.getElementById('tankerSignTitle1');
  const sSub1 = document.getElementById('tankerSignSub1');
  const sTitle2 = document.getElementById('tankerSignTitle2');
  const sSub2 = document.getElementById('tankerSignSub2');
  const sTitle3 = document.getElementById('tankerSignTitle3');
  const sSub3 = document.getElementById('tankerSignSub3');

  if (sTitle1) sTitle1.textContent = isEn ? 'Site Receiving Officer' : 'مسؤول استلام الموقع';
  if (sSub1) sSub1.textContent = isEn ? 'Name, Signature & Date' : 'الاسم، التوقيع والتاريخ';
  if (sTitle2) sTitle2.textContent = isEn ? 'Internal Audit / Accountant' : 'تدقيق الحسابات / المحاسب';
  if (sSub2) sSub2.textContent = isEn ? 'Name, Signature & Date' : 'الاسم، التوقيع والتاريخ';
  if (sTitle3) sTitle3.textContent = isEn ? 'Financial Management Approval' : 'اعتماد الإدارة / المدير المالي';
  if (sSub3) sSub3.textContent = isEn ? 'Name, Signature & Date' : 'الاسم، التوقيع والتاريخ';

  // 8. Update Autocomplete Datalists
  updateTankerDatalists();
}

function exportTankerCsv() {
  const isEn = state.tankerLang === 'en';
  const deliveries = getTankerDeliveries({
    periodFilter: state.tankerPeriodFilter,
    projectFilter: state.tankerProjectFilter,
    search: state.tankerSearch
  });

  const kpis = calculateTankerKpis(deliveries);
  const periodLabel = state.tankerPeriodFilter === 'year'
    ? (isEn ? `Year_${state.year}` : `سنة_${state.year}`)
    : (state.tankerPeriodFilter === 'all'
      ? (isEn ? 'All_Periods' : 'كافة_الفترات')
      : (isEn ? `Month_${ENGLISH_MONTHS[state.month]}_${state.year}` : `شهر_${ARABIC_MONTHS[state.month]}_${state.year}`));
  const prjLabel = state.tankerProjectFilter !== 'all' ? `_${state.tankerProjectFilter}` : '';
  const filename = isEn
    ? `Tanker_Diesel_Disbursement_${periodLabel}${prjLabel}.csv`
    : `كشف_سولار_التانكر_والمشاريع_${periodLabel}${prjLabel}.csv`;

  const csvRows = [];
  csvRows.push([isEn ? '=== HELIOPOLIS ELECTRIC COMPANY ===' : '=== شركة هليوبوليس للكهرباء (HELIOPOLIS ELECTRIC COMPANY) ===']);
  csvRows.push([isEn ? '=== DIESEL DISBURSEMENT & PROJECT ALLOCATION STATEMENT ===' : '=== كشف تفريغ وتوزيع السولار على المشاريع (DIESEL DISBURSEMENT STATEMENT) ===']);
  csvRows.push([isEn ? 'Report Generated Date' : 'تاريخ استخراج التقرير', new Date().toISOString().split('T')[0]]);
  csvRows.push([isEn ? 'Statement Period' : 'فترة الكشف', periodLabel]);
  if (state.tankerProjectFilter !== 'all') {
    csvRows.push([isEn ? 'Allocated Project' : 'المشروع المخصص', state.tankerProjectFilter]);
  }
  csvRows.push([isEn ? 'Total Diesel Volume (Liters)' : 'إجمالي كمية الديزل (لتر)', kpis.totalLiters]);
  csvRows.push([isEn ? 'Total Expenditures (QAR)' : 'إجمالي المبلغ المدفوع (ر.ق)', kpis.totalAmount]);
  csvRows.push([isEn ? 'Weighted Average Price / Liter (QAR)' : 'متوسط سعر اللتر المرجح (ر.ق)', kpis.avgPrice]);
  csvRows.push([isEn ? 'Supplied Projects Count' : 'عدد المواقع المستفيدة', kpis.projectsCount]);
  csvRows.push([]);

  // Table header
  csvRows.push(isEn ? [
    '#',
    'Date',
    'Project / Site',
    'Quantity (Liters)',
    'Price / Liter (QAR)',
    'Invoice Total (QAR)',
    'Invoice / Voucher Ref',
    'Site Receiver',
    'Supplier / Tanker',
    'Notes'
  ] : [
    'م',
    'التاريخ',
    'المشروع / الموقع',
    'الكمية (لتر)',
    'سعر اللتر (ر.ق)',
    'إجمالي الفاتورة (ر.ق)',
    'رقم الفاتورة / البون',
    'المستلم بالموقع',
    'المورد / التانكر',
    'ملاحظات'
  ]);

  deliveries.forEach((d, idx) => {
    csvRows.push([
      idx + 1,
      d.date,
      d.project,
      d.liters,
      d.pricePerLiter,
      d.amount,
      d.invoiceNo || '-',
      d.receiver || '-',
      d.supplier || '-',
      d.notes || '-'
    ]);
  });

  csvRows.push([]);
  csvRows.push(isEn ? [
    'Grand Total',
    '',
    `${kpis.projectsCount} Sites`,
    kpis.totalLiters,
    kpis.avgPrice,
    kpis.totalAmount,
    `${deliveries.length} Deliveries`,
    '',
    '',
    ''
  ] : [
    'الإجمالي العام',
    '',
    `${kpis.projectsCount} موقع`,
    kpis.totalLiters,
    kpis.avgPrice,
    kpis.totalAmount,
    `${deliveries.length} بون`,
    '',
    '',
    ''
  ]);

  if (kpis.projectsBreakdown.length > 0) {
    csvRows.push([]);
    csvRows.push([isEn ? '=== Fuel & Cost Allocation Breakdown ===' : '=== توزيع التكلفة والكميات حسب المشاريع ===']);
    csvRows.push(isEn
      ? ['Project / Site', 'Consumed Volume (L)', 'Volume %', 'Total Cost (QAR)', 'Cost %']
      : ['المشروع / الموقع', 'الكمية المستهلكة (لتر)', 'نسبة الاستهلاك %', 'إجمالي التكلفة (ر.ق)', 'نسبة التكلفة %']);
    kpis.projectsBreakdown.forEach(p => {
      csvRows.push([p.project, p.liters, `${p.percentLiters}%`, p.amount, `${p.percentAmount}%`]);
    });
  }

  const csvString = '\uFEFF' + csvRows.map(r => r.map(formatCsvCell).join(',')).join('\n');
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  showToast(isEn ? 'Tanker statement exported to Excel successfully 📊' : 'تم تصدير كشف سولار التانكر إلى Excel بنجاح 📊');
}

function openTankerPrintModal() {
  if (typeof document === 'undefined') return;
  const modal = document.getElementById('tankerPrintCustomModal');
  if (!modal) return;

  // 1. Populate project select in print modal
  const prjSelect = document.getElementById('tankerPrintScopeProject');
  if (prjSelect) {
    const allProjects = Array.from(new Set([
      ...(state.data?.projectsList || []),
      ...(state.data?.tankerDeliveries || []).map(d => d.project)
    ])).filter(Boolean).sort();

    const isEn = state.tankerLang === 'en';
    let optionsHtml = `<option value="all">${isEn ? 'All Projects & Sites (Comprehensive Statement)' : 'كافة المشاريع والمواقع (تقرير شامل)'}</option>`;
    allProjects.forEach(p => {
      const selected = (p === state.tankerProjectFilter && p !== 'all') ? 'selected' : '';
      optionsHtml += `<option value="${escapeHtml(p)}" ${selected}>🏗️ ${escapeHtml(p)}</option>`;
    });
    prjSelect.innerHTML = optionsHtml;
  }

  // 2. Set period select to active state filter
  const perSelect = document.getElementById('tankerPrintScopePeriod');
  if (perSelect) {
    perSelect.value = state.tankerPeriodFilter || 'all';
  }

  // 3. Set print language radios
  const radAr = document.querySelector('input[name="tankerPrintLang"][value="ar"]');
  const radEn = document.querySelector('input[name="tankerPrintLang"][value="en"]');
  if (radAr && radEn) {
    radAr.checked = state.tankerLang !== 'en';
    radEn.checked = state.tankerLang === 'en';
  }

  // 4. Set custom Voucher Ref & Copy destination default
  const vRef = document.getElementById('tankerPrintVoucherRefInput');
  if (vRef) {
    vRef.value = `DSL-${state.year}${String(state.month).padStart(2, '0')}-001`;
  }
  const copyInp = document.getElementById('tankerPrintCopyDestInput');
  if (copyInp) {
    copyInp.value = state.tankerLang === 'en'
      ? 'Original - Accounts & Projects Dept.'
      : 'الأصل - قسم الحسابات والمشاريع';
  }

  modal.classList.remove('hidden');
  modal.classList.add('active');
}

function closeTankerPrintModal() {
  if (typeof document === 'undefined') return;
  const modal = document.getElementById('tankerPrintCustomModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('active');
  }
}

function executeCustomTankerPrint() {
  if (typeof document === 'undefined') return;

  // Read options from modal
  const orientation = document.querySelector('input[name="tankerPrintOrientation"]:checked')?.value || 'landscape';
  const printLang = document.querySelector('input[name="tankerPrintLang"]:checked')?.value || 'ar';
  const scale = document.querySelector('input[name="tankerPrintScale"]:checked')?.value || 'normal';
  const selectedProject = document.getElementById('tankerPrintScopeProject')?.value || 'all';
  const selectedPeriod = document.getElementById('tankerPrintScopePeriod')?.value || 'all';

  const showDate = document.getElementById('chkPrintColDate')?.checked ?? true;
  const showProject = document.getElementById('chkPrintColProject')?.checked ?? true;
  const showLiters = document.getElementById('chkPrintColLiters')?.checked ?? true;
  const showPrice = document.getElementById('chkPrintColPrice')?.checked ?? true;
  const showAmount = document.getElementById('chkPrintColAmount')?.checked ?? true;
  const showInvoiceNo = document.getElementById('chkPrintColInvoiceNo')?.checked ?? true;
  const showReceiver = document.getElementById('chkPrintColReceiver')?.checked ?? true;
  const showSupplier = document.getElementById('chkPrintColSupplier')?.checked ?? true;

  const showKpiStrip = document.getElementById('chkPrintKpiStrip')?.checked ?? true;
  const showTafqeet = document.getElementById('chkPrintTafqeet')?.checked ?? true;
  const showSignatures = document.getElementById('chkPrintSignatures')?.checked ?? true;

  const customVoucherRef = document.getElementById('tankerPrintVoucherRefInput')?.value?.trim() || `DSL-${state.year}${String(state.month).padStart(2, '0')}-001`;
  const customCopy = document.getElementById('tankerPrintCopyDestInput')?.value?.trim() || (printLang === 'en' ? 'Original - Accounts & Projects Dept.' : 'الأصل - قسم الحسابات والمشاريع');

  // Backup active state to restore after print
  const origLang = state.tankerLang;
  const origPrj = state.tankerProjectFilter;
  const origPer = state.tankerPeriodFilter;
  const origSearch = state.tankerSearch;

  // Temporarily apply print scope filters
  state.tankerLang = printLang;
  state.tankerProjectFilter = selectedProject;
  state.tankerPeriodFilter = selectedPeriod;
  state.tankerSearch = '';

  renderTankerTab();

  // Override Voucher ref and copy in print header
  const elPrintVoucher = document.getElementById('printTankerVoucherNo');
  if (elPrintVoucher) elPrintVoucher.textContent = customVoucherRef;
  const elPrintCopy = document.getElementById('printTankerCopyVal');
  if (elPrintCopy) elPrintCopy.textContent = customCopy;

  // Apply print classes to document.body
  const printClasses = ['printing-tanker'];
  if (orientation === 'landscape') {
    printClasses.push('printing-landscape');
  } else {
    printClasses.push('printing-portrait');
  }

  if (printLang === 'en') {
    printClasses.push('printing-lang-en');
  } else {
    printClasses.push('printing-lang-ar');
  }

  if (scale === 'compact') printClasses.push('print-scale-compact');
  if (scale === 'large') printClasses.push('print-scale-large');

  if (!showDate) printClasses.push('hide-print-date');
  if (!showProject) printClasses.push('hide-print-project');
  if (!showLiters) printClasses.push('hide-print-liters');
  if (!showPrice) printClasses.push('hide-print-price');
  if (!showAmount) printClasses.push('hide-print-amount');
  if (!showInvoiceNo) printClasses.push('hide-print-invoiceno');
  if (!showReceiver) printClasses.push('hide-print-receiver');
  if (!showSupplier) printClasses.push('hide-print-supplier');

  if (!showKpiStrip) printClasses.push('hide-print-kpis');
  if (!showTafqeet) printClasses.push('hide-print-tafqeet');
  if (!showSignatures) printClasses.push('hide-print-signatures');

  document.body.classList.add(...printClasses);

  closeTankerPrintModal();

  let cleanedUp = false;
  const cleanupAfterPrint = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    document.body.classList.remove(
      'printing-tanker', 'printing-landscape', 'printing-portrait',
      'printing-lang-en', 'printing-lang-ar', 'print-scale-compact', 'print-scale-large',
      'hide-print-date', 'hide-print-project', 'hide-print-liters', 'hide-print-price',
      'hide-print-amount', 'hide-print-invoiceno', 'hide-print-receiver', 'hide-print-supplier',
      'hide-print-kpis', 'hide-print-tafqeet', 'hide-print-signatures'
    );
    state.tankerLang = origLang;
    state.tankerProjectFilter = origPrj;
    state.tankerPeriodFilter = origPer;
    state.tankerSearch = origSearch;
    renderTankerTab();
    window.removeEventListener('afterprint', cleanupAfterPrint);
  };

  window.addEventListener('afterprint', cleanupAfterPrint);

  window.print();

  setTimeout(cleanupAfterPrint, 1500);
}

function printTankerReport() {
  openTankerPrintModal();
}

function switchTab(tabId) {
  state.activeTab = tabId;
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
  });
  document.querySelectorAll('.tab-section').forEach(sec => {
    sec.classList.toggle('active', sec.id === `tab-${tabId}`);
  });
  renderAll();
}

function renderAll() {
  if (typeof document === 'undefined') return;
  updateMonthLabels();
  if (state.activeTab === 'daily') renderDailyTab();
  if (state.activeTab === 'monthly') renderMonthlyMatrixTab();
  if (state.activeTab === 'dispatch') renderDispatchTab();
  if (state.activeTab === 'person') renderPersonTab();
  if (state.activeTab === 'annual') renderAnnualTab();
  if (state.activeTab === 'people') renderPeopleManagementTab();
  if (state.activeTab === 'custody') renderCustodyTab();
  if (state.activeTab === 'safe') renderSafeTab();
  if (state.activeTab === 'tanker') renderTankerTab();
}

function stepWorkday(direction) {
  const { y, m, d } = parseDateParts(state.selectedDate);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + direction);
  if (dt.getDay() === 5) {
    dt.setDate(dt.getDate() + direction);
  }
  state.year = dt.getFullYear();
  state.month = dt.getMonth() + 1;
  state.selectedDate = formatDateKey(state.year, state.month, dt.getDate());
  document.getElementById('globalYear').value = String(state.year);
  document.getElementById('globalMonth').value = String(state.month);
  renderAll();
}

function addSinglePerson(name, role, meta) {
  const cleanName = name.trim();
  if (!cleanName) {
    alert('يرجى كتابة الاسم أولاً');
    return false;
  }
  const nextNum = state.data.people.length + 1;
  const newPerson = {
    id: 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    num: nextNum,
    name: cleanName,
    role: role || 'driver',
    meta: (meta || '').trim(),
    archived: false,
    archivedAt: null
  };
  state.data.people.push(newPerson);
  if (!state.selectedPersonId) {
    state.selectedPersonId = newPerson.id;
  }
  saveState();
  renderAll();
  showToast(`تمت إضافة "${cleanName}" برقم #${nextNum}`);
  return true;
}

function exportCurrentViewToExcel() {
  let csvRows = [];
  let filename = `كشف_حساب_${ARABIC_MONTHS[state.month]}_${state.year}.csv`;

  if (state.activeTab === 'person') {
    const person = state.data.people.find(p => p.id === state.selectedPersonId) || state.data.people[0];
    if (!person) {
      alert('لا يوجد شخص لتصدير صفحته');
      return;
    }
    const dispName = getPersonDisplayName(person);
    filename = `صفحة_${dispName}_${state.year}.csv`;
    csvRows.push(['رقم الشخص', person.num, 'الاسم', dispName, 'الفئة', person.role === 'driver' ? 'سائق' : 'ستاف', 'السيارة/القسم', person.meta || '']);
    csvRows.push([]);
    csvRows.push(['التاريخ', 'اليوم', 'الفلوس اللي استلمها (ر.ق)', 'الفواتير المقدمة - بيتي كاش (ر.ق)', 'الكاش المرتجع في اليد (ر.ق)', 'البيان / الملاحظات']);

    let totalCCents = 0;
    let totalICents = 0;
    let totalRetCents = 0;
    for (let m = 1; m <= 12; m++) {
      const days = getDaysInMonth(state.year, m);
      for (let d = 1; d <= days; d++) {
        const dk = formatDateKey(state.year, m, d);
        const e = getPersonEntry(dk, person.id);
        if (e.cash > 0 || e.invoice > 0 || e.returnedCash > 0 || e.note) {
          totalCCents += toCents(e.cash);
          totalICents += toCents(e.invoice);
          totalRetCents += toCents(e.returnedCash || 0);
          csvRows.push([dk, getArabicDayName(state.year, m, d), e.cash, e.invoice, e.returnedCash || 0, e.note || '']);
        }
      }
    }
    const totalC = fromCents(totalCCents);
    const totalI = fromCents(totalICents);
    const totalRet = fromCents(totalRetCents);
    const netBalance = fromCents(totalCCents - (totalICents + totalRetCents));
    csvRows.push(['الإجمالي الكلي (ر.ق)', '', totalC, totalI, totalRet, `الصافي: ${netBalance} ر.ق`]);
  } else if (state.activeTab === 'annual') {
    let mFrom = Number(state.annualFromMonth) || 1;
    let mTo = Number(state.annualToMonth) || 12;
    if (mFrom > mTo) { const tmp = mFrom; mFrom = mTo; mTo = tmp; }
    filename = `التقرير_السنوي_${state.year}.csv`;
    const monthsRange = [];
    for (let m = mFrom; m <= mTo; m++) monthsRange.push(m);

    const header = ['الرقم', 'الاسم', 'الفئة'];
    monthsRange.forEach(m => header.push(ARABIC_MONTHS[m]));
    header.push('توتال الفلوس بالفترة (ر.ق)', 'توتال الفواتير بالفترة (ر.ق)');
    csvRows.push(header);

    const isInv = state.annualDataType === 'invoices';

    const monthSummary = {};
    let grandReceivedCents = 0;
    let grandDistributedCents = 0;
    let grandInvoicesCents = 0;

    monthsRange.forEach(m => {
      const daysCount = getDaysInMonth(state.year, m);
      let recCents = 0;
      let distCents = 0;
      let invCents = 0;
      for (let d = 1; d <= daysCount; d++) {
        const dt = getDayTotals(formatDateKey(state.year, m, d));
        recCents += toCents(dt.received);
        distCents += toCents(dt.distributed);
        invCents += toCents(dt.invoices);
      }
      monthSummary[m] = { rec: fromCents(recCents), dist: fromCents(distCents), inv: fromCents(invCents) };
      grandReceivedCents += recCents;
      grandDistributedCents += distCents;
      grandInvoicesCents += invCents;
    });

    // Summary Row 1: Received per month
    const recRow = ['', 'توتال المستلم بالشهر', 'الوارد'];
    monthsRange.forEach(m => recRow.push(monthSummary[m].rec));
    recRow.push(fromCents(grandReceivedCents), '-');
    csvRows.push(recRow);

    // Summary Row 2: Distributed per month
    const distRow = ['', 'توتال الموزع بالشهر', 'المنصرف'];
    monthsRange.forEach(m => distRow.push(monthSummary[m].dist));
    distRow.push(fromCents(grandDistributedCents), fromCents(grandInvoicesCents));
    csvRows.push(distRow);

    const annualPeople = getReportablePeople(state.year);
    annualPeople.forEach(p => {
      const row = [p.num, getPersonDisplayName(p), p.role === 'driver' ? 'سائق' : 'ستاف'];
      let pCashCents = 0;
      let pInvCents = 0;
      monthsRange.forEach(m => {
        const mt = getPersonMonthTotals(p.id, state.year, m);
        pCashCents += toCents(mt.cash);
        pInvCents += toCents(mt.invoice);
        row.push(isInv ? mt.invoice : mt.cash);
      });
      row.push(fromCents(pCashCents), fromCents(pInvCents));
      csvRows.push(row);
    });

    // Grand Totals Footer Row
    const footRow = ['', 'التوتال العام للشهور', 'الكل'];
    monthsRange.forEach(m => {
      footRow.push(isInv ? monthSummary[m].inv : monthSummary[m].dist);
    });
    footRow.push(fromCents(grandDistributedCents), fromCents(grandInvoicesCents));
    csvRows.push(footRow);
  } else if (state.activeTab === 'custody') {
    filename = `سجل_عهدة_الشركة_${state.year}.csv`;
    csvRows.push(['=== دفعات العهدة المستلمة من الشركة ===']);
    csvRows.push(['م', 'التاريخ', 'المبلغ (ر.ق)', 'رقم السند/الشيك', 'البيان']);
    let totalCustRecCents = 0;
    (state.data.custodyReceipts || []).forEach((r, idx) => {
      totalCustRecCents += toCents(r.amount);
      csvRows.push([idx + 1, r.date, r.amount, r.ref || '', r.note || '']);
    });
    csvRows.push(['إجمالي دفعات العهدة', '', fromCents(totalCustRecCents), '', '']);
    csvRows.push([]);
    csvRows.push(['=== كشوف الفواتير والتسويات المسلمة للشركة ===']);
    csvRows.push(['م', 'التاريخ', 'الفترة', 'المبلغ (ر.ق)', 'رقم الكشف', 'البيان']);
    let totalCustSetCents = 0;
    (state.data.custodySettlements || []).forEach((s, idx) => {
      if (s.status !== 'reversed') {
        totalCustSetCents += toCents(s.amount);
      }
      csvRows.push([idx + 1, s.date, s.period || '', s.amount, s.ref || '', s.note || '']);
    });
    csvRows.push(['إجمالي التسويات المسلمة', '', '', fromCents(totalCustSetCents), '', '']);
    csvRows.push([]);
    csvRows.push(['صافي رصيد العهدة (دفعات - تسويات)', '', '', fromCents(totalCustRecCents - totalCustSetCents), '', '']);
  } else if (state.activeTab === 'dispatch') {
    const isEn = state.dispatchLang === 'en';
    filename = isEn ? `Daily_Cash_Distribution_${state.selectedDate}.csv` : `كشف_الصرف_اليومي_${state.selectedDate}.csv`;
    const list = getDailyDispatchList(state.selectedDate, state.dispatchRoleFilter);
    const kpis = getDailyDispatchKpis(state.selectedDate, state.dispatchRoleFilter);

    if (isEn) {
      csvRows.push(['=== DAILY CASH DISTRIBUTION STATEMENT ===']);
      csvRows.push(['Date', state.selectedDate]);
      csvRows.push(['Total Disbursed (QAR)', fromCents(toCents(kpis.totalDisbursed))]);
      csvRows.push(['Recipients Count', kpis.count]);
      csvRows.push(['Drawer Balance Remaining', fromCents(toCents(kpis.drawerRemaining))]);
      csvRows.push([]);
      csvRows.push(['#', 'Recipient Name', 'Role', 'Vehicle/Dept', 'Amount Issued (QAR)', 'Purpose/Description', 'Signature']);
      let totalCents = 0;
      list.forEach((item, idx) => {
        totalCents += item.cashCents;
        const name = getPersonEnglishName(item.person);
        const role = item.person.role === 'staff' ? 'Staff' : 'Driver';
        const meta = translateDispatchMetaToEnglish(item.person.meta);
        const note = translateDispatchNoteToEnglish(item.note);
        csvRows.push([
          idx + 1,
          formatCsvCell(name),
          formatCsvCell(role),
          formatCsvCell(meta),
          fromCents(item.cashCents),
          formatCsvCell(note),
          ''
        ]);
      });
      csvRows.push([]);
      csvRows.push(['TOTAL DISBURSED (QAR)', '', '', '', fromCents(totalCents), '', '']);
    } else {
      csvRows.push(['=== كشف وسند توزيع النقدية اليومي ===']);
      csvRows.push(['التاريخ', state.selectedDate]);
      csvRows.push(['إجمالي المنصرف (ر.ق)', fromCents(toCents(kpis.totalDisbursed))]);
      csvRows.push(['عدد المستلمين', kpis.count]);
      csvRows.push(['المتبقي بالدرج/الخزنة', fromCents(toCents(kpis.drawerRemaining))]);
      csvRows.push([]);
      csvRows.push(['م', 'اسم المستلم', 'الصفة', 'السيارة أو القسم', 'المبلغ المستلم (ر.ق)', 'البيان والغرض', 'توقيع الاستلام']);
      let totalCents = 0;
      list.forEach((item, idx) => {
        totalCents += item.cashCents;
        const role = item.person.role === 'staff' ? 'موظف' : 'سائق';
        csvRows.push([
          idx + 1,
          formatCsvCell(item.person.name),
          formatCsvCell(role),
          formatCsvCell(item.person.meta || ''),
          fromCents(item.cashCents),
          formatCsvCell(item.note || ''),
          ''
        ]);
      });
      csvRows.push([]);
      csvRows.push(['إجمالي المبالغ المنصرفة (ر.ق)', '', '', '', fromCents(totalCents), '', '']);
    }
  } else if (state.activeTab === 'safe') {
    const isYear = !!state.safeShowYear;
    const targetM = state.safeMonth || state.month;
    filename = isYear 
      ? `معاملاتي_مع_الخزنة_${state.year}.csv`
      : `معاملاتي_مع_الخزنة_${ARABIC_MONTHS[targetM]}_${state.year}.csv`;
    
    csvRows.push(['=== كشف حساب معاملاتي مع الخزنة ===']);
    csvRows.push(['الفترة', isYear ? `سنة ${state.year}` : `شهر ${ARABIC_MONTHS[targetM]} ${state.year}`]);
    csvRows.push([]);
    csvRows.push(['=== 1. السحوبات النقدية اليومية من الخزنة ===']);
    csvRows.push(['م', 'التاريخ', 'المبلغ المسحوب (ر.ق)', 'الموزع سُلف', 'المتبقي']);

    const startM = isYear ? 1 : targetM;
    const endM = isYear ? 12 : targetM;
    let idxW = 1;
    let totalWCents = 0;
    for (let m = startM; m <= endM; m++) {
      const days = getDaysInMonth(state.year, m);
      for (let d = 1; d <= days; d++) {
        const dk = formatDateKey(state.year, m, d);
        const rec = getDayReceived(dk);
        if (rec > 0) {
          totalWCents += toCents(rec);
          const totals = getDayTotals(dk);
          csvRows.push([idxW++, dk, rec, totals.distributed, totals.remaining]);
        }
      }
    }
    const totalW = fromCents(totalWCents);
    csvRows.push(['إجمالي سحوبات الفترة', '', totalW]);
    csvRows.push([]);

    csvRows.push(['=== 2. الفواتير المسلّمة للخزنة ===']);
    csvRows.push(['م', 'التاريخ', 'المبلغ (ر.ق)', 'رقم الفاتورة/المرجع', 'البيان', 'الحالة']);
    const safeInvs = isYear ? getSafeInvoicesForYear(state.year) : getSafeInvoicesForMonth(state.year, targetM);
    let totalICents = 0;
    safeInvs.forEach((inv, idx) => {
      const isRev = inv.status === 'reversed';
      if (!isRev) {
        totalICents += toCents(inv.amount);
      }
      const statusText = isRev ? `معكوسة (${inv.reversalReason || ''})` : 'نشطة';
      csvRows.push([idx + 1, inv.date, inv.amount, inv.ref || '', inv.note || '', statusText]);
    });
    const totalI = fromCents(totalICents);
    csvRows.push(['إجمالي فواتير الفترة النشطة', '', totalI]);
    csvRows.push([]);
    csvRows.push(['صافي الفترة المحددة (سحوبات - فواتير)', '', fromCents(totalWCents - totalICents)]);

    const fin = getSafeTabFinancials(state.year, targetM, isYear);
    csvRows.push(['الرصيد الافتتاحي المرحل من قبل هذه الفترة', '', fin.priorOpeningBalance]);
    csvRows.push(['الصافي التراكمي الشامل المعلق مع الخزنة', '', fin.cumulativeNet]);
  } else {
    const daysCount = getDaysInMonth(state.year, state.month);
    const header = ['الرقم', 'الاسم', 'الفئة', 'السيارة/القسم'];
    const workDays = [];
    for (let d = 1; d <= daysCount; d++) {
      if (state.hideFridaysInMonthly && getDayOfWeekIndex(state.year, state.month, d) === 5) continue;
      workDays.push(d);
      header.push(`يوم ${d}`);
    }
    header.push('إجمالي المبالغ بالشهر (ر.ق)', 'إجمالي الفواتير بالشهر (ر.ق)', 'إجمالي الكاش المرتجع بالشهر (ر.ق)');
    csvRows.push(header);

    const recRow = ['', 'إجمالي المستلم اليومي', 'الوارد', ''];
    let mRecCents = 0;
    workDays.forEach(d => {
      const r = getDayReceived(formatDateKey(state.year, state.month, d));
      mRecCents += toCents(r);
      recRow.push(r);
    });
    recRow.push(fromCents(mRecCents), '', '');
    csvRows.push(recRow);

    const exportPeople = getReportablePeople(state.year);
    exportPeople.forEach(p => {
      const row = [p.num, getPersonDisplayName(p), p.role === 'driver' ? 'سائق' : 'ستاف', p.meta || ''];
      workDays.forEach(d => {
        const e = getPersonEntry(formatDateKey(state.year, state.month, d), p.id);
        row.push(e.cash || 0);
      });
      const mt = getPersonMonthTotals(p.id, state.year, state.month);
      row.push(mt.cash, mt.invoice, mt.returnedCash);
      csvRows.push(row);
    });
  }

  const csvString = '\uFEFF' + csvRows.map(r => r.map(formatCsvCell).join(',')).join('\n');
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  showToast('تم تصدير ملف Excel بنجاح 📊');
}

function printReportWithHeader() {
  document.body.classList.remove('printing-voucher');
  const subEl = document.getElementById('printHeaderSubtitle');
  const dateEl = document.getElementById('printHeaderDate');

  if (state.activeTab === 'dispatch') {
    document.body.classList.add('printing-dispatch');
    if (state.dispatchLang === 'en') {
      document.body.classList.add('printing-lang-en');
      document.body.classList.remove('printing-lang-ar');
    } else {
      document.body.classList.add('printing-lang-ar');
      document.body.classList.remove('printing-lang-en');
    }
  } else {
    document.body.classList.remove('printing-dispatch', 'printing-lang-en', 'printing-lang-ar');
    if (state.activeTab === 'monthly') {
      document.body.classList.add('printing-landscape');
    } else {
      document.body.classList.remove('printing-landscape');
    }
  }

  if (subEl) {
    if (state.activeTab === 'daily') {
      const { y, m, d } = parseDateParts(state.selectedDate);
      subEl.textContent = `كشف التسجيل والتوزيع اليومي — ${getArabicDayName(y, m, d)} ${d} ${ARABIC_MONTHS[m]} ${y}`;
    } else if (state.activeTab === 'dispatch') {
      const isEn = state.dispatchLang === 'en';
      const { y, m, d } = parseDateParts(state.selectedDate);
      if (isEn) {
        subEl.textContent = `Daily Cash Distribution Sheet — ${getEnglishDayName(y, m, d)}, ${d} ${ENGLISH_MONTHS[m]} ${y}`;
      } else {
        subEl.textContent = `كشف وسند الصرف اليومي - عهدة النقدية (QAR) — ${getArabicDayName(y, m, d)} ${d} ${ARABIC_MONTHS[m]} ${y}`;
      }
    } else if (state.activeTab === 'monthly') {
      subEl.textContent = `كشف الشهر الشامل — ${ARABIC_MONTHS[state.month]} ${state.year}`;
    } else if (state.activeTab === 'person') {
      const person = state.data.people.find(p => p.id === state.selectedPersonId) || state.data.people[0];
      subEl.textContent = person
        ? `كشف حساب وعهدة: ${getPersonDisplayName(person)} (#${person.num})`
        : `كشف حساب فردي`;
    } else if (state.activeTab === 'annual') {
      subEl.textContent = `التقرير السنوي وتجميع الشهور — سنة ${state.year}`;
    } else if (state.activeTab === 'custody') {
      subEl.textContent = `سجل عهدة الشركة ومطابقة الخزنة — سنة ${state.year}`;
    } else if (state.activeTab === 'safe') {
      const isYear = !!state.safeShowYear;
      const targetM = state.safeMonth || state.month;
      subEl.textContent = `كشف حساب معاملاتي مع الخزنة — ${isYear ? `سنة ${state.year}` : `شهر ${ARABIC_MONTHS[targetM]} ${state.year}`}`;
    } else {
      subEl.textContent = `قائمة السائقين والستاف المسجلين`;
    }
  }
  if (dateEl) {
    const todayStr = new Date().toISOString().slice(0, 10);
    dateEl.textContent = `تاريخ الطباعة: ${todayStr}`;
  }
  window.print();
  setTimeout(() => {
    document.body.classList.remove('printing-dispatch', 'printing-lang-en', 'printing-lang-ar', 'printing-landscape');
  }, 1000);
}

function printVoucherOnly() {
  document.body.classList.add('printing-voucher');
  window.print();
  setTimeout(() => {
    document.body.classList.remove('printing-voucher');
  }, 500);
}

if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('afterprint', () => {
    document.body?.classList.remove('printing-voucher');
  });
}

const MAX_BACKUP_SIZE = 15 * 1024 * 1024; // 15MB limit

function validateBackupPayload(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('صيغة ملف النسخة الاحتياطية غير صالحة (يجب أن يكون كائن JSON صحيح).');
  }
  // Prevent prototype pollution
  if (Object.prototype.hasOwnProperty.call(parsed, '__proto__') ||
      Object.prototype.hasOwnProperty.call(parsed, 'prototype') ||
      Object.prototype.hasOwnProperty.call(parsed, 'constructor')) {
    throw new Error('تم رفض الملف لأسباب أمنية (Prototype Pollution Detected).');
  }

  if (!Array.isArray(parsed.people)) {
    throw new Error('ملف النسخة الاحتياطية غير صالح: لا يحتوي على سجل الأشخاص (people array).');
  }

  // Validate people and detect duplicate IDs
  const seenPersonIds = new Set();
  const sanitizedPeople = [];
  parsed.people.forEach((p, idx) => {
    if (!p || typeof p !== 'object') return;
    const pid = String(p.id || ('p_' + Date.now() + '_' + idx)).trim();
    if (seenPersonIds.has(pid)) {
      throw new Error(`تم اكتشاف تكرار في معرفات الأشخاص (Duplicate Person ID: ${pid}). الملف قد يكون تالفاً.`);
    }
    seenPersonIds.add(pid);
    sanitizedPeople.push({
      id: pid,
      num: Number.isFinite(Number(p.num)) && Number(p.num) > 0 ? Number(p.num) : (idx + 1),
      name: typeof p.name === 'string' ? p.name.trim() : '',
      role: p.role === 'staff' ? 'staff' : 'driver',
      nameEn: typeof p.nameEn === 'string' ? p.nameEn.trim() : '',
      meta: typeof p.meta === 'string' ? p.meta.trim() : '',
      archived: !!p.archived,
      archivedAt: p.archivedAt || null
    });
  });

  // Validate dailyReceipts
  const sanitizedDailyReceipts = {};
  if (parsed.dailyReceipts && typeof parsed.dailyReceipts === 'object') {
    for (const [dateKey, amount] of Object.entries(parsed.dailyReceipts)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
        const numAmt = Number(amount);
        if (Number.isFinite(numAmt) && numAmt >= 0) {
          sanitizedDailyReceipts[dateKey] = fromCents(toCents(numAmt));
        }
      }
    }
  }

  // Validate dailyExtras
  const sanitizedDailyExtras = {};
  if (parsed.dailyExtras && typeof parsed.dailyExtras === 'object') {
    for (const [dateKey, extra] of Object.entries(parsed.dailyExtras)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey) && extra && typeof extra === 'object') {
        const numAmt = Number(extra.amount);
        if (Number.isFinite(numAmt) && numAmt >= 0) {
          sanitizedDailyExtras[dateKey] = {
            amount: fromCents(toCents(numAmt)),
            description: typeof extra.description === 'string' ? extra.description.trim() : '',
            excludeFromCompany: !!extra.excludeFromCompany
          };
        }
      }
    }
  }

  // Validate entries and check referential integrity
  const sanitizedEntries = {};
  if (parsed.entries && typeof parsed.entries === 'object') {
    for (const [dateKey, dayEntries] of Object.entries(parsed.entries)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !dayEntries || typeof dayEntries !== 'object') continue;
      sanitizedEntries[dateKey] = {};
      for (const [personId, entry] of Object.entries(dayEntries)) {
        if (!entry || typeof entry !== 'object') continue;
        // Referential integrity check: If person does not exist in people array, preserve financial history by archiving
        if (!seenPersonIds.has(personId)) {
          seenPersonIds.add(personId);
          sanitizedPeople.push({
            id: personId,
            num: sanitizedPeople.length + 1,
            name: `شخص سابق (${personId})`,
            role: 'driver',
            meta: 'تم استرجاعه تلقائياً لحفظ العمليات المالية القديمة',
            archived: true,
            archivedAt: new Date().toISOString()
          });
        }
        const cash = Number.isFinite(Number(entry.cash)) && Number(entry.cash) >= 0 ? fromCents(toCents(entry.cash)) : 0;
        const invoice = Number.isFinite(Number(entry.invoice)) && Number(entry.invoice) >= 0 ? fromCents(toCents(entry.invoice)) : 0;
        const returnedCash = Number.isFinite(Number(entry.returnedCash)) && Number(entry.returnedCash) >= 0 ? fromCents(toCents(entry.returnedCash)) : 0;
        const note = typeof entry.note === 'string' ? entry.note.trim() : '';

        if (cash > 0 || invoice > 0 || returnedCash > 0 || note) {
          sanitizedEntries[dateKey][personId] = { cash, invoice, returnedCash, note };
        }
      }
    }
  }

  // Helper to validate monetary transaction arrays
  const sanitizeTxArray = (arr, prefix) => {
    if (!Array.isArray(arr)) return [];
    const seenTxIds = new Set();
    const sanitized = [];
    arr.forEach((item, idx) => {
      if (!item || typeof item !== 'object') return;
      const txId = String(item.id || (`${prefix}_${Date.now()}_${idx}`));
      if (seenTxIds.has(txId)) return; // skip duplicate tx IDs
      seenTxIds.add(txId);
      const amount = Number.isFinite(Number(item.amount)) && Number(item.amount) >= 0 ? fromCents(toCents(item.amount)) : 0;
      const date = typeof item.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.date) ? item.date : (state ? formatDateKey(state.year, state.month, 1) : '2026-01-01');
      sanitized.push({
        ...item,
        id: txId,
        date,
        amount,
        ref: typeof item.ref === 'string' ? item.ref.trim() : '',
        note: typeof item.note === 'string' ? item.note.trim() : ''
      });
    });
    return sanitized;
  };

  const sanitizedCustodyReceipts = sanitizeTxArray(parsed.custodyReceipts, 'cr');
  const sanitizedCustodySettlements = sanitizeTxArray(parsed.custodySettlements, 'cs');
  const sanitizedSafeInvoices = sanitizeTxArray(parsed.safeInvoices, 'si');

  const sanitizeAuditArray = (arr) => {
    if (!Array.isArray(arr)) return [];
    return arr.filter(item => item && typeof item === 'object').map(item => ({
      action: typeof item.action === 'string' ? item.action : 'unknown',
      invoiceId: item.invoiceId || (item.invoice && item.invoice.id) || '',
      amount: Number.isFinite(Number(item.amount)) ? fromCents(toCents(item.amount)) : (item.invoice && Number.isFinite(Number(item.invoice.amount)) ? fromCents(toCents(item.invoice.amount)) : 0),
      periodKey: typeof item.periodKey === 'string' ? item.periodKey : (item.invoice && item.invoice.periodKey ? item.invoice.periodKey : ''),
      ref: typeof item.ref === 'string' ? item.ref.trim() : (item.invoice && typeof item.invoice.ref === 'string' ? item.invoice.ref.trim() : ''),
      invoice: item.invoice && typeof item.invoice === 'object' ? item.invoice : null,
      previous: item.previous && typeof item.previous === 'object' ? item.previous : null,
      updated: item.updated && typeof item.updated === 'object' ? item.updated : null,
      timestamp: item.timestamp || new Date().toISOString(),
      reason: typeof item.reason === 'string' ? item.reason.trim() : ''
    }));
  };

  const sanitizedSafeInvoicesAudit = sanitizeAuditArray(parsed.safeInvoicesAudit);

    // Validate tanker deliveries
  const sanitizedTankerDeliveries = [];
  const seenTankerIds = new Set();
  if (Array.isArray(parsed.tankerDeliveries)) {
    parsed.tankerDeliveries.forEach((item, idx) => {
      if (!item || typeof item !== 'object') return;
      const tid = String(item.id || (`tank_${Date.now()}_${idx}`));
      if (seenTankerIds.has(tid)) return; // duplicate ID skipped
      seenTankerIds.add(tid);
      const liters = Number.isFinite(Number(item.liters)) && Number(item.liters) > 0 ? Number(item.liters) : 0;
      const amount = Number.isFinite(Number(item.amount)) && Number(item.amount) >= 0 ? fromCents(toCents(item.amount)) : 0;
      const pricePerLiter = liters > 0 ? Number((amount / liters).toFixed(3)) : (Number.isFinite(Number(item.pricePerLiter)) ? Number(item.pricePerLiter) : 0);
      const date = typeof item.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.date) ? item.date : (state ? formatDateKey(state.year, state.month, 1) : '2026-01-01');
      sanitizedTankerDeliveries.push({
        id: tid,
        date,
        project: typeof item.project === 'string' ? item.project.trim() : '',
        liters,
        pricePerLiter,
        amount,
        invoiceNo: typeof item.invoiceNo === 'string' ? item.invoiceNo.trim() : '',
        receiver: typeof item.receiver === 'string' ? item.receiver.trim() : '',
        supplier: typeof item.supplier === 'string' ? item.supplier.trim() : '',
        notes: typeof item.notes === 'string' ? item.notes.trim() : '',
        createdAt: item.createdAt || new Date().toISOString()
      });
    });
  }

  // Sanitize projectsList
  const defaultProjects = ['مشروع لوسيل', 'موقع الدوحة الجديدة', 'مشروع الخور', 'مشروع الوكرة', 'مشروع الريان'];
  let sanitizedProjectsList = defaultProjects.slice();
  if (Array.isArray(parsed.projectsList) && parsed.projectsList.length > 0) {
    sanitizedProjectsList = Array.from(new Set([
      ...defaultProjects,
      ...parsed.projectsList.filter(p => typeof p === 'string' && p.trim().length > 0).map(p => p.trim())
    ]));
  }
  sanitizedTankerDeliveries.forEach(d => {
    if (d.project && !sanitizedProjectsList.includes(d.project)) {
      sanitizedProjectsList.push(d.project);
    }
  });

  return {
    schemaVersion: 5,
    people: sanitizedPeople,
    dailyReceipts: sanitizedDailyReceipts,
    dailyExtras: sanitizedDailyExtras,
    entries: sanitizedEntries,
    custodyReceipts: sanitizedCustodyReceipts,
    custodySettlements: sanitizedCustodySettlements,
    safeInvoices: sanitizedSafeInvoices,
    safeInvoicesAudit: sanitizedSafeInvoicesAudit,
    tankerDeliveries: sanitizedTankerDeliveries,
    projectsList: sanitizedProjectsList
  };
}

function migrateLegacyData(raw) {
  return validateBackupPayload(raw);
}

function bindEvents() {
  // Accessibility: Close modals with Escape key (WCAG 2.2 AA)
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => {
        m.classList.add('hidden');
      });
      const calc = document.getElementById('calculatorWidget');
      if (calc && !calc.classList.contains('hidden')) {
        calc.classList.add('hidden');
      }
    }
  });

  // Prevent accidental mouse-wheel value changes on focused number inputs
  document.addEventListener('wheel', (e) => {
    if (document.activeElement && document.activeElement.type === 'number' && document.activeElement === e.target) {
      document.activeElement.blur();
    }
  }, { passive: true });

  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      switchTab(btn.getAttribute('data-tab'));
    });
  });

  // Font Size Toggle for 64yo User
  document.getElementById('btnToggleFontSize')?.addEventListener('click', () => {
    state.fontXL = !state.fontXL;
    document.body.classList.toggle('font-xl', state.fontXL);
    document.getElementById('fontSizeLabel').textContent = state.fontXL ? 'كبير جداً' : 'كبير';
    showToast(state.fontXL ? 'تم تكبير الخط إلى (كبير جداً) 🔍' : 'حجم الخط (كبير ومريح)');
  });

  // Helper functions to update theme and eye comfort UI
  function updateThemeUI() {
    const isDark = (state.theme === 'dark');
    document.body.classList.toggle('dark-mode', isDark);
    const themeText = document.getElementById('themeToggleText');
    if (themeText) {
      themeText.textContent = isDark ? 'الوضع النهاري ☀️' : 'الوضع الليلي 🌙';
    }
  }

  function updateEyeComfortUI() {
    const isComfort = !!state.eyeComfort;
    document.body.classList.toggle('eye-comfort', isComfort);
    const btn = document.getElementById('btnToggleEyeComfort');
    const txt = document.getElementById('eyeComfortText');
    if (btn) {
      btn.classList.toggle('active-comfort', isComfort);
    }
    if (txt) {
      txt.textContent = isComfort ? 'راحة العين (مفعلة ✓)' : 'راحة العين';
    }
  }

  // Initial UI state synchronization
  updateThemeUI();
  updateEyeComfortUI();

  // Senior-Friendly Dark / Light Mode Button
  document.getElementById('btnThemeToggle')?.addEventListener('click', () => {
    state.theme = (state.theme === 'dark') ? 'light' : 'dark';

    // If switching to dark mode, remove eye-comfort so warm tones don't clash with dark
    if (state.theme === 'dark' && state.eyeComfort) {
      state.eyeComfort = false;
      try {
        localStorage.setItem('petty_cash_eye_comfort', 'false');
      } catch (err) {}
      updateEyeComfortUI();
    }

    try {
      localStorage.setItem('petty_cash_theme', state.theme);
    } catch (err) {}

    updateThemeUI();
    showToast(state.theme === 'dark' ? 'تم تفعيل الوضع الليلي المريح لكبار السن 🌙' : 'تم تفعيل الوضع النهاري ☀️');
  });

  // Eye Comfort Toggle for 64yo User
  document.getElementById('btnToggleEyeComfort')?.addEventListener('click', () => {
    state.eyeComfort = !state.eyeComfort;

    // If eye comfort turned on, turn off dark mode
    if (state.eyeComfort && state.theme === 'dark') {
      state.theme = 'light';
      try {
        localStorage.setItem('petty_cash_theme', 'light');
      } catch (err) {}
      updateThemeUI();
    }

    try {
      localStorage.setItem('petty_cash_eye_comfort', String(state.eyeComfort));
    } catch (e) {}

    updateEyeComfortUI();
    showToast(state.eyeComfort ? 'تم تفعيل وضع راحة العين' : 'تم العودة للألوان الافتراضية');
  });

  // Quick Calculator Widget
  document.getElementById('btnToggleCalculator')?.addEventListener('click', () => {
    document.getElementById('calculatorWidget').classList.toggle('hidden');
  });
  document.getElementById('btnCloseCalc')?.addEventListener('click', () => {
    document.getElementById('calculatorWidget').classList.add('hidden');
  });
  initQuickCalculator();

  // Cloud Sync & PIN Modal
  const cloudModal = document.getElementById('cloudSyncModal');
  document.getElementById('btnCloudSyncModal')?.addEventListener('click', () => {
    cloudModal.classList.remove('hidden');
  });
  document.getElementById('btnCloseCloudSyncModal')?.addEventListener('click', () => {
    cloudModal.classList.add('hidden');
  });
  document.getElementById('btnConnectCloudAccount')?.addEventListener('click', async () => {
    const acct = document.getElementById('cloudAccountNameInput').value.trim();
    const pin = document.getElementById('cloudPinInput').value.trim();
    if (!acct || !pin) {
      alert('يرجى كتابة اسم الحساب ورمز PIN');
      return;
    }
    if (pin.length < 4) {
      alert('رمز PIN يجب ألا يقل عن 4 أرقام');
      return;
    }
    try {
      // Local Lock Security Note: Hash PIN with SHA-256 and salt for local browser verification only.
      // This is a local-first client verification and does NOT provide cloud backend authentication.
      const salt = 'petty_cash_salt_' + acct;
      let pinHash = '';
      if (window.crypto && window.crypto.subtle) {
        const enc = new TextEncoder();
        const hashBuffer = await window.crypto.subtle.digest('SHA-256', enc.encode(salt + ':' + pin));
        pinHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
      } else {
        let h = 0;
        const str = salt + ':' + pin;
        for (let i = 0; i < str.length; i++) {
          h = ((h << 5) - h) + str.charCodeAt(i);
          h |= 0;
        }
        pinHash = 'h_' + Math.abs(h).toString(16);
      }
      localStorage.setItem('petty_cash_cloud_account', JSON.stringify({
        acct,
        pinHash,
        salt,
        lastSaved: new Date().toISOString()
      }));
    } catch (e) {}
    const badge = document.getElementById('cloudSyncStatusBadge');
    if (badge) {
      badge.textContent = `✓ تم حفظ وتفعيل القفل المحلي (${acct}) على هذا الجهاز بنجاح`;
      badge.style.color = '#15803d';
      badge.style.fontWeight = 'bold';
    }
    showToast('تم حفظ وتفعيل القفل المحلي بنجاح ✓');
    setTimeout(() => {
      cloudModal.classList.add('hidden');
    }, 1200);
  });

  // Move or Copy Day's Distribution
  document.getElementById('btnOpenMoveDayDistModal')?.addEventListener('click', openMoveDistModal);
  document.getElementById('btnCloseMoveDistModal')?.addEventListener('click', () => {
    document.getElementById('moveDistModal').classList.add('hidden');
  });
  document.getElementById('btnCancelMoveDist')?.addEventListener('click', () => {
    document.getElementById('moveDistModal').classList.add('hidden');
  });
  document.getElementById('btnConfirmMoveDist')?.addEventListener('click', confirmMoveOrCopyDistribution);

  // Toggle Extra Outside Expense Row
  document.getElementById('btnToggleExtraRow')?.addEventListener('click', () => {
    const row = document.getElementById('extraExpenseRow');
    row.classList.toggle('hidden');
    if (!row.classList.contains('hidden')) {
      document.getElementById('dailyExtraInput').focus();
    }
  });

  // Toggle Detailed Columns in Daily Table
  document.getElementById('btnToggleDetailedCols')?.addEventListener('click', () => {
    state.showDetailedCols = !state.showDetailedCols;
    renderDailyTable();
  });

  document.getElementById('dailyDatePicker').addEventListener('change', (e) => {
    if (!e.target.value) return;
    state.selectedDate = e.target.value;
    const { y, m } = parseDateParts(state.selectedDate);
    state.year = y;
    state.month = m;
    document.getElementById('globalYear').value = String(y);
    document.getElementById('globalMonth').value = String(m);
    renderAll();
  });

  document.getElementById('btnPrevWorkday').addEventListener('click', () => stepWorkday(-1));
  document.getElementById('btnNextWorkday').addEventListener('click', () => stepWorkday(1));
  document.getElementById('btnSkipFriday').addEventListener('click', () => stepWorkday(1));

  document.getElementById('dailyReceivedInput').addEventListener('input', (e) => {
    setDayReceived(state.selectedDate, e.target.value);
    renderDailySummaryCards();
    updateActiveDayPillHasData();
  });

  document.getElementById('dailyExtraInput').addEventListener('input', (e) => {
    setDayExtra(state.selectedDate, { amount: e.target.value });
    renderDailySummaryCards();
    updateActiveDayPillHasData();
  });

  document.getElementById('dailyExtraNoteInput').addEventListener('input', (e) => {
    setDayExtra(state.selectedDate, { note: e.target.value });
  });

  document.getElementById('btnCopyPrevDay').addEventListener('click', copyPreviousDayDistribution);
  document.getElementById('btnCarryOverNextDay').addEventListener('click', carryOverRemainingToNextWorkday);

  // Quick Add Person on Daily Page
  const quickNameInput = document.getElementById('quickAddPersonName');
  const quickRoleSelect = document.getElementById('quickAddPersonRole');
  const quickMetaInput = document.getElementById('quickAddPersonMeta');

  document.getElementById('btnQuickAddPerson').addEventListener('click', () => {
    if (addSinglePerson(quickNameInput.value, quickRoleSelect.value, quickMetaInput.value)) {
      quickNameInput.value = '';
      quickMetaInput.value = '';
      quickNameInput.focus();
    }
  });
  quickNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (addSinglePerson(quickNameInput.value, quickRoleSelect.value, quickMetaInput.value)) {
        quickNameInput.value = '';
        quickMetaInput.value = '';
      }
    }
  });

  document.getElementById('btnOpenBulkAdd').addEventListener('click', () => {
    switchTab('people');
    document.getElementById('bulkNamesTextarea').focus();
  });

  document.querySelectorAll('#dailyCategoryFilter .pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#dailyCategoryFilter .pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.dailyCategoryFilter = pill.getAttribute('data-filter');
      renderDailyTable();
    });
  });

  document.getElementById('dailySearchInput').addEventListener('input', (e) => {
    state.dailySearch = e.target.value;
    renderDailyTable();
  });

  document.getElementById('btnClearDayDist').addEventListener('click', () => {
    if (confirm('هل أنت متأكد من مسح توزيعات هذا اليوم فقط؟')) {
      delete state.data.entries[state.selectedDate];
      saveState();
      renderDailyTab();
      showToast('تم تصفير توزيعات اليوم');
    }
  });

  // Monthly Matrix Controls
  document.getElementById('chkHideFridays').addEventListener('change', (e) => {
    state.hideFridaysInMonthly = e.target.checked;
    renderMonthlyMatrixTab();
  });

  document.getElementById('chkShowOnlyActiveMonth').addEventListener('change', (e) => {
    state.showOnlyActiveInMonthly = e.target.checked;
    renderMonthlyMatrixTab();
  });

  document.getElementById('monthlyViewMode').addEventListener('change', (e) => {
    state.monthlyViewMode = e.target.value;
    renderMonthlyMatrixTab();
  });

  document.getElementById('monthlySearchInput').addEventListener('input', (e) => {
    state.monthlySearch = e.target.value;
    renderMonthlyMatrixTab();
  });

  // Person Page Controls
  document.getElementById('personSidebarSearch').addEventListener('input', (e) => {
    state.personSidebarSearch = e.target.value;
    renderPersonSidebar();
  });

  document.querySelectorAll('[data-pfilter]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-pfilter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.personSidebarFilter = btn.getAttribute('data-pfilter');
      renderPersonSidebar();
    });
  });

  document.querySelectorAll('#personMonthPills .p-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      state.personSelectedMonth = btn.getAttribute('data-pmonth');
      renderPersonSheet();
    });
  });

  document.getElementById('ledgerScopeSelect').addEventListener('change', (e) => {
    state.ledgerScope = e.target.value;
    renderPersonSheet();
  });

  document.querySelectorAll('[data-ptag]').forEach(chip => {
    chip.addEventListener('click', () => {
      const tag = chip.getAttribute('data-ptag');
      const noteEl = document.getElementById('pEntryNote');
      const cur = noteEl.value.trim();
      noteEl.value = cur ? `${cur} - ${tag}` : tag;
      noteEl.focus();
    });
  });

  document.getElementById('btnSavePersonEntry').addEventListener('click', () => {
    if (!state.selectedPersonId) {
      alert('يرجى إضافة أو اختيار شخص أولاً');
      return;
    }
    const dateVal = document.getElementById('pEntryDate').value || state.selectedDate;
    const cashVal = Number(document.getElementById('pEntryCash').value) || 0;
    const invVal = Number(document.getElementById('pEntryInvoice').value) || 0;
    const retVal = Number(document.getElementById('pEntryReturnedCash')?.value) || 0;
    const noteVal = document.getElementById('pEntryNote').value || '';

    setPersonEntry(dateVal, state.selectedPersonId, {
      cash: cashVal,
      invoice: invVal,
      returnedCash: retVal,
      note: noteVal
    });

    document.getElementById('pEntryCash').value = '';
    document.getElementById('pEntryInvoice').value = '';
    if (document.getElementById('pEntryReturnedCash')) document.getElementById('pEntryReturnedCash').value = '';
    document.getElementById('pEntryNote').value = '';

    renderPersonTab();
    showToast('تم حفظ الحركة في صفحة الشخص بنجاح ✓');
  });

  document.getElementById('btnOpenVoucherModal').addEventListener('click', () => {
    openVoucherModal(state.selectedPersonId);
  });

  document.getElementById('btnCloseVoucherModal').addEventListener('click', () => {
    document.getElementById('voucherModal').classList.add('hidden');
  });

  document.getElementById('btnPrintVoucherNow').addEventListener('click', printVoucherOnly);

  document.getElementById('btnShareWhatsApp').addEventListener('click', sharePersonStatementWhatsApp);
  document.getElementById('btnPrintPerson').addEventListener('click', printReportWithHeader);

  // Annual Controls
  document.getElementById('annualFromMonth').addEventListener('change', (e) => {
    state.annualFromMonth = Number(e.target.value);
    renderAnnualTab();
  });

  document.getElementById('annualToMonth').addEventListener('change', (e) => {
    state.annualToMonth = Number(e.target.value);
    renderAnnualTab();
  });

  document.getElementById('annualDataType').addEventListener('change', (e) => {
    state.annualDataType = e.target.value;
    renderAnnualTab();
  });

  // People Management Controls
  document.getElementById('btnAddNewPerson').addEventListener('click', () => {
    const nameInput = document.getElementById('newPersonNameInput');
    const roleSelect = document.getElementById('newPersonRoleSelect');
    const metaInput = document.getElementById('newPersonMetaInput');
    if (addSinglePerson(nameInput.value, roleSelect.value, metaInput.value)) {
      nameInput.value = '';
      metaInput.value = '';
      nameInput.focus();
    }
  });

  document.getElementById('btnAddBulkNames').addEventListener('click', () => {
    const rawText = document.getElementById('bulkNamesTextarea').value;
    const role = document.getElementById('bulkRoleSelect').value;
    const names = rawText
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean);

    if (names.length === 0) {
      alert('يرجى كتابة أو لصق اسم واحد على الأقل');
      return;
    }

    names.forEach((name, idx) => {
      state.data.people.push({
        id: 'p_' + Date.now() + '_' + idx + '_' + Math.random().toString(36).slice(2, 5),
        num: state.data.people.length + 1,
        name,
        role,
        meta: '',
        archived: false,
        archivedAt: null
      });
    });

    renumberPeople();
    document.getElementById('bulkNamesTextarea').value = '';
    saveState();
    renderAll();
    showToast(`تمت إضافة ${names.length} اسم بنجاح ✓`);
  });

  document.getElementById('btnCreate60Slots').addEventListener('click', () => {
    if (state.data.people.length > 0) {
      if (!confirm('سيتم إكمال القائمة لتصل إلى 60 خانة مرقمة. هل أنت موافق؟')) return;
      while (state.data.people.length < 60) {
        const nextNum = state.data.people.length + 1;
        state.data.people.push({
          id: 'p_' + Date.now() + '_' + nextNum,
          num: nextNum,
          name: '',
          role: nextNum <= 25 ? 'driver' : 'staff',
          meta: '',
          archived: false,
          archivedAt: null
        });
      }
    } else {
      state.data.people = create60BlankSlots();
    }
    saveState();
    renderAll();
    showToast('تم تجهيز 60 خانة مرقمة جاهزة لكتابة الأسماء ✓');
  });

  document.getElementById('btnClearAllPeople').addEventListener('click', () => {
    if (confirm('هل أنت متأكد من مسح جميع الأسماء المسجلة والبدء بقائمة فارغة تماماً؟')) {
      state.data.people = [];
      state.selectedPersonId = null;
      saveState();
      renderAll();
      showToast('تم مسح جميع الأسماء والبدء على نظافة');
    }
  });

  // People Management Table Search & Filter Pills
  document.getElementById('peopleManageSearchInput')?.addEventListener('input', (e) => {
    state.peopleManageSearch = e.target.value;
    renderPeopleManagementTab();
  });

  document.querySelectorAll('#peopleManageFilterPills .pill').forEach(pill => {
    pill.addEventListener('click', () => {
      state.peopleManageFilter = pill.getAttribute('data-pmfilter');
      renderPeopleManagementTab();
    });
  });

  // Tab 6: Company Custody Fund Controls
  document.getElementById('btnAddCustodyReceipt')?.addEventListener('click', () => {
    const dateVal = document.getElementById('custodyReceiptDate').value || state.selectedDate;
    const amountVal = Number(document.getElementById('custodyReceiptAmount').value) || 0;
    const refVal = document.getElementById('custodyReceiptRef').value.trim();
    const noteVal = document.getElementById('custodyReceiptNote').value.trim();

    if (amountVal <= 0) {
      alert('يرجى كتابة مبلغ الدفعة المستلمة من الشركة بشكل صحيح');
      return;
    }

    state.data.custodyReceipts = state.data.custodyReceipts || [];

    if (state.editingCustodyReceiptId) {
      const idx = state.data.custodyReceipts.findIndex(r => r.id === state.editingCustodyReceiptId);
      if (idx !== -1) {
        state.data.custodyReceipts[idx] = {
          ...state.data.custodyReceipts[idx],
          date: dateVal,
          amount: amountVal,
          ref: refVal,
          note: noteVal
        };
      }
      state.editingCustodyReceiptId = null;
      const btnAdd = document.getElementById('btnAddCustodyReceipt');
      if (btnAdd) {
        btnAdd.textContent = '➕ إضافة دفعة العهدة';
        btnAdd.className = 'btn btn-success';
      }
      const btnCancel = document.getElementById('btnCancelEditCustodyReceipt');
      if (btnCancel) btnCancel.classList.add('hidden');
      showToast(`تم حفظ تعديل الدفعة بمبلغ ${formatNumber(amountVal)} ر.ق بنجاح ✓`);
    } else {
      state.data.custodyReceipts.push({
        id: 'cr_' + Date.now(),
        date: dateVal,
        amount: amountVal,
        ref: refVal,
        note: noteVal
      });
      showToast(`تم تسجيل دفعة استلام عهدة بمبلغ ${formatNumber(amountVal)} ر.ق بنجاح ✓`);
    }

    document.getElementById('custodyReceiptAmount').value = '';
    document.getElementById('custodyReceiptRef').value = '';
    document.getElementById('custodyReceiptNote').value = '';

    saveState();
    renderCustodyTab();
  });

  document.getElementById('btnCancelEditCustodyReceipt')?.addEventListener('click', () => {
    state.editingCustodyReceiptId = null;
    document.getElementById('custodyReceiptAmount').value = '';
    document.getElementById('custodyReceiptRef').value = '';
    document.getElementById('custodyReceiptNote').value = '';
    const btnAdd = document.getElementById('btnAddCustodyReceipt');
    if (btnAdd) {
      btnAdd.textContent = '➕ إضافة دفعة العهدة';
      btnAdd.className = 'btn btn-success';
    }
    const btnCancel = document.getElementById('btnCancelEditCustodyReceipt');
    if (btnCancel) btnCancel.classList.add('hidden');
    showToast('تم إلغاء تعديل الدفعة');
  });

  document.getElementById('btnAddCustodySettlement')?.addEventListener('click', () => {
    const dateVal = document.getElementById('custodySettlementDate').value || state.selectedDate;
    const rawAmt = document.getElementById('custodySettlementAmount').value;
    const vAmt = validateMonetaryInput(rawAmt, false);
    if (!vAmt.valid || vAmt.value <= 0) {
      alert('يرجى كتابة مبلغ كشف الفواتير المسلم للشركة بشكل صحيح (رقم موجب بدقة قرشين)');
      return;
    }
    const amountVal = vAmt.value;
    const periodVal = document.getElementById('custodySettlementPeriod').value.trim() || `فواتير شهر ${ARABIC_MONTHS[state.month]} ${state.year}`;
    const refVal = document.getElementById('custodySettlementRef').value.trim();
    const noteVal = document.getElementById('custodySettlementNote').value.trim();

    state.data.custodySettlements = state.data.custodySettlements || [];
    const { y, m } = parseDateParts(dateVal);
    const periodKey = `${y}-${String(m).padStart(2, '0')}`;

    if (state.editingCustodySettlementId) {
      const idx = state.data.custodySettlements.findIndex(s => s.id === state.editingCustodySettlementId);
      if (idx !== -1) {
        state.data.custodySettlements[idx] = {
          ...state.data.custodySettlements[idx],
          date: dateVal,
          amount: amountVal,
          period: periodVal,
          periodKey: periodKey,
          ref: refVal,
          note: noteVal,
          status: 'active'
        };
      }
      state.editingCustodySettlementId = null;
      const btnAdd = document.getElementById('btnAddCustodySettlement');
      if (btnAdd) {
        btnAdd.textContent = '📑 حفظ كشف التصفية للشركة';
        btnAdd.className = 'btn btn-primary';
      }
      const btnCancel = document.getElementById('btnCancelEditCustodySettlement');
      if (btnCancel) btnCancel.classList.add('hidden');
      showToast(`تم حفظ تعديل كشف التصفية بمبلغ ${formatNumber(amountVal)} ر.ق بنجاح ✓`);
    } else {
      state.data.custodySettlements.push({
        id: 'cs_' + Date.now(),
        date: dateVal,
        amount: amountVal,
        period: periodVal,
        periodKey: periodKey,
        ref: refVal,
        note: noteVal,
        status: 'active'
      });
      showToast(`تم تسجيل كشف التصفية المسلم للشركة بمبلغ ${formatNumber(amountVal)} ر.ق بنجاح ✓`);
    }

    document.getElementById('custodySettlementAmount').value = '';
    document.getElementById('custodySettlementRef').value = '';
    document.getElementById('custodySettlementNote').value = '';

    saveState();
    renderCustodyTab();
  });

  document.getElementById('btnCancelEditCustodySettlement')?.addEventListener('click', () => {
    state.editingCustodySettlementId = null;
    document.getElementById('custodySettlementAmount').value = '';
    document.getElementById('custodySettlementRef').value = '';
    document.getElementById('custodySettlementNote').value = '';
    const btnAdd = document.getElementById('btnAddCustodySettlement');
    if (btnAdd) {
      btnAdd.textContent = '📑 حفظ كشف التصفية للشركة';
      btnAdd.className = 'btn btn-primary';
    }
    const btnCancel = document.getElementById('btnCancelEditCustodySettlement');
    if (btnCancel) btnCancel.classList.add('hidden');
    showToast('تم إلغاء تعديل كشف التصفية');
  });

  // Tab 3: Daily Cash Distribution Sheet Controls (كشف الصرف اليومي)
  document.getElementById('btnDispatchLangAr')?.addEventListener('click', () => {
    state.dispatchLang = 'ar';
    renderDispatchTab();
  });
  document.getElementById('btnDispatchLangEn')?.addEventListener('click', () => {
    state.dispatchLang = 'en';
    renderDispatchTab();
  });

  document.getElementById('dispatchDateInput')?.addEventListener('change', (e) => {
    const v = e.target.value;
    if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
      state.selectedDate = v;
      const { y, m } = parseDateParts(v);
      state.year = y;
      state.month = m;
      renderAll();
    }
  });

  document.getElementById('btnDispatchQuickToday')?.addEventListener('click', () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const d = now.getDate();
    state.selectedDate = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    state.year = y;
    state.month = m;
    renderAll();
  });

  document.getElementById('btnDispatchQuickYesterday')?.addEventListener('click', () => {
    const { y, m, d } = parseDateParts(state.selectedDate);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() - 1);
    const prevY = dt.getFullYear();
    const prevM = dt.getMonth() + 1;
    const prevD = dt.getDate();
    state.selectedDate = `${prevY}-${String(prevM).padStart(2, '0')}-${String(prevD).padStart(2, '0')}`;
    state.year = prevY;
    state.month = prevM;
    renderAll();
  });

  document.querySelectorAll('#dispatchRoleFilter .pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#dispatchRoleFilter .pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.dispatchRoleFilter = pill.getAttribute('data-role') || 'all';
      renderDispatchTab();
    });
  });

    // Tanker Diesel Module Event Listeners
  document.getElementById('tankerDeliveryForm')?.addEventListener('submit', (e) => { e.preventDefault(); handleSaveTankerDelivery(); });
  document.getElementById('btnOpenTankerModal')?.addEventListener('click', () => openTankerModal());
  document.getElementById('btnCloseTankerModal')?.addEventListener('click', closeTankerModal);
  document.getElementById('btnCancelTankerModal')?.addEventListener('click', closeTankerModal);
  document.getElementById('tankerDeliveryModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'tankerDeliveryModal') closeTankerModal();
  });

  // Tanker Projects Directory Listeners
  document.getElementById('btnManageTankerProjects')?.addEventListener('click', openTankerProjectsModal);
  document.getElementById('btnCloseTankerProjectsModal')?.addEventListener('click', closeTankerProjectsModal);
  document.getElementById('btnDoneTankerProjectsModal')?.addEventListener('click', closeTankerProjectsModal);
  document.getElementById('tankerProjectsModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'tankerProjectsModal') closeTankerProjectsModal();
  });

  const handleAddProjectFromDirectory = () => {
    const inp = document.getElementById('newTankerProjectInput');
    const val = inp?.value?.trim();
    if (!val) {
      alert('يرجى كتابة اسم المشروع أو الموقع أولاً');
      return;
    }
    try {
      addProjectToMasterList(val);
      showToast(state.tankerLang === 'en' ? `Project "${val}" added to directory 🏗️` : `تمت إضافة مشروع "${val}" إلى الدليل بنجاح 🏗️`);
      if (inp) {
        inp.value = '';
        inp.focus();
      }
    } catch (err) {
      alert(err.message);
    }
  };
  document.getElementById('btnAddTankerProjectSubmit')?.addEventListener('click', handleAddProjectFromDirectory);
  document.getElementById('newTankerProjectInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddProjectFromDirectory();
    }
  });

  document.getElementById('tankerProjectsListContainer')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-delete-project');
    if (!btn) return;
    const prj = btn.getAttribute('data-project');
    if (!prj) return;
    if (confirm(state.tankerLang === 'en' ? `Are you sure you want to delete project "${prj}"?` : `هل أنت متأكد من حذف مشروع "${prj}" من الدليل؟`)) {
      try {
        removeProjectFromMasterList(prj);
        showToast(state.tankerLang === 'en' ? `Project "${prj}" removed from directory` : `تم حذف مشروع "${prj}" من الدليل`);
      } catch (err) {
        alert(err.message);
      }
    }
  });
  document.getElementById('btnSaveTankerDelivery')?.addEventListener('click', handleSaveTankerDelivery);
  document.getElementById('btnPrintTankerStatement')?.addEventListener('click', openTankerPrintModal);
  document.getElementById('btnCloseTankerPrintModal')?.addEventListener('click', closeTankerPrintModal);
  document.getElementById('btnCancelTankerPrintModal')?.addEventListener('click', closeTankerPrintModal);
  document.getElementById('tankerPrintCustomModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'tankerPrintCustomModal') closeTankerPrintModal();
  });
  document.getElementById('btnExecuteCustomPrint')?.addEventListener('click', executeCustomTankerPrint);
  document.getElementById('btnExportTankerExcel')?.addEventListener('click', exportTankerCsv);
  document.getElementById('btnTankerLangAr')?.addEventListener('click', () => {
    state.tankerLang = 'ar';
    renderTankerTab();
  });
  document.getElementById('btnTankerLangEn')?.addEventListener('click', () => {
    state.tankerLang = 'en';
    renderTankerTab();
  });

  document.getElementById('tankerProjectFilter')?.addEventListener('change', (e) => {
    state.tankerProjectFilter = e.target.value;
    renderTankerTab();
  });
  document.getElementById('tankerPeriodFilter')?.addEventListener('change', (e) => {
    state.tankerPeriodFilter = e.target.value;
    renderTankerTab();
  });
  document.getElementById('tankerSearchInput')?.addEventListener('input', (e) => {
    state.tankerSearch = e.target.value.trim().toLowerCase();
    renderTankerTab();
  });
  document.getElementById('btnClearTankerSearch')?.addEventListener('click', () => {
    state.tankerSearch = '';
    const inp = document.getElementById('tankerSearchInput');
    if (inp) inp.value = '';
    renderTankerTab();
  });
  document.getElementById('btnResetTankerFilters')?.addEventListener('click', () => {
    state.tankerProjectFilter = 'all';
    state.tankerPeriodFilter = 'all';
    state.tankerSearch = '';
    const prj = document.getElementById('tankerProjectFilter');
    if (prj) prj.value = 'all';
    const per = document.getElementById('tankerPeriodFilter');
    if (per) per.value = 'all';
    const inp = document.getElementById('tankerSearchInput');
    if (inp) inp.value = '';
    renderTankerTab();
  });

  // Dynamic calculation in Tanker Modal
  const litersInp = document.getElementById('tankerLitersInput');
  const priceInp = document.getElementById('tankerPricePerLiterInput');
  const amountInp = document.getElementById('tankerAmountInput');

  const calcAmount = () => {
    const l = parseFloat(litersInp?.value);
    const p = parseFloat(priceInp?.value);
    if (l > 0 && p > 0 && amountInp && document.activeElement !== amountInp) {
      amountInp.value = (l * p).toFixed(2);
    }
  };
  const calcPrice = () => {
    const l = parseFloat(litersInp?.value);
    const a = parseFloat(amountInp?.value);
    if (l > 0 && a > 0 && priceInp && document.activeElement !== priceInp) {
      priceInp.value = (a / l).toFixed(3);
    }
  };

  litersInp?.addEventListener('input', calcAmount);
  priceInp?.addEventListener('input', calcAmount);
  amountInp?.addEventListener('input', calcPrice);

  // Table row action delegation (Edit & Delete)
  document.getElementById('tankerTableBody')?.addEventListener('click', (e) => {
    const editBtn = e.target.closest('.btn-edit-tanker');
    if (editBtn) {
      const id = editBtn.getAttribute('data-id');
      openTankerModal(id);
      return;
    }
    const delBtn = e.target.closest('.btn-delete-tanker');
    if (delBtn) {
      const id = delBtn.getAttribute('data-id');
      if (confirm('هل أنت متأكد من حذف هذا السجل نهائياً؟')) {
        deleteTankerDelivery(id);
        renderTankerTab();
        showToast('تم حذف السجل بنجاح');
      }
    }
  });

  document.getElementById('btnPrintDispatchStatement')?.addEventListener('click', printReportWithHeader);
  document.getElementById('btnExportDispatchExcel')?.addEventListener('click', exportCurrentViewToExcel);
  document.getElementById('btnCopyDispatchWhatsApp')?.addEventListener('click', async () => {
    const isEn = state.dispatchLang === 'en';
    const text = generateDispatchWhatsAppSummary(state.selectedDate, isEn);
    const success = await copyTextToClipboard(text);
    if (success) {
      showToast(isEn ? 'Copied WhatsApp summary to clipboard! 📋' : 'تم نسخ ملخص الواتساب بنجاح! 📋');
    } else {
      prompt(isEn ? 'Copy WhatsApp summary:' : 'انسخ ملخص الواتساب:', text);
    }
  });

  // Tab 7: Safe Transactions Controls (معاملاتي مع الخزنة)
  document.getElementById('safeMonthSelect')?.addEventListener('change', (e) => {
    state.safeMonth = Number(e.target.value);
    renderSafeTab();
  });

  document.getElementById('chkSafeShowYear')?.addEventListener('change', (e) => {
    state.safeShowYear = e.target.checked;
    renderSafeTab();
  });

  document.getElementById('btnAddSafeInvoice')?.addEventListener('click', () => {
    const dateVal = document.getElementById('safeInvoiceDate').value || state.selectedDate;
    const rawAmt = document.getElementById('safeInvoiceAmount').value;
    const vAmt = validateMonetaryInput(rawAmt, false);
    if (!vAmt.valid || vAmt.value <= 0) {
      alert('يرجى كتابة مبلغ الفاتورة المسلّمة للخزنة بشكل صحيح (رقم موجب بدقة قرشين)');
      return;
    }
    const amountVal = vAmt.value;
    const refVal = document.getElementById('safeInvoiceRef').value.trim();
    const noteVal = document.getElementById('safeInvoiceNote').value.trim();

    state.data.safeInvoices = state.data.safeInvoices || [];
    const { y, m } = parseDateParts(dateVal);
    const periodKey = `${y}-${String(m).padStart(2, '0')}`;

    if (state.editingSafeInvoiceId) {
      const idx = state.data.safeInvoices.findIndex(inv => inv.id === state.editingSafeInvoiceId);
      if (idx !== -1) {
        const oldInv = { ...state.data.safeInvoices[idx] };
        state.data.safeInvoices[idx] = {
          ...state.data.safeInvoices[idx],
          date: dateVal,
          amount: amountVal,
          periodKey: periodKey,
          ref: refVal,
          note: noteVal,
          status: 'active'
        };
        state.data.safeInvoicesAudit = state.data.safeInvoicesAudit || [];
        state.data.safeInvoicesAudit.push({
          action: 'edited',
          invoiceId: oldInv.id,
          amount: amountVal,
          periodKey: periodKey,
          ref: refVal,
          previous: oldInv,
          updated: { ...state.data.safeInvoices[idx] },
          timestamp: new Date().toISOString(),
          reason: 'تعديل بيانات وتاريخ الفاتورة من واجهة المستخدم'
        });
      }
      state.editingSafeInvoiceId = null;
      const btnAdd = document.getElementById('btnAddSafeInvoice');
      if (btnAdd) {
        btnAdd.textContent = '📑 حفظ الفاتورة المسلّمة للخزنة';
        btnAdd.className = 'btn btn-primary';
      }
      const btnCancel = document.getElementById('btnCancelEditSafeInvoice');
      if (btnCancel) btnCancel.classList.add('hidden');
      showToast(`تم حفظ تعديل الفاتورة بمبلغ ${formatNumber(amountVal)} ر.ق بنجاح ✓`);
    } else {
      state.data.safeInvoices.push({
        id: 'si_' + Date.now(),
        date: dateVal,
        amount: amountVal,
        periodKey: periodKey,
        ref: refVal,
        note: noteVal,
        status: 'active'
      });
      showToast(`تم تسجيل الفاتورة المسلّمة للخزنة بمبلغ ${formatNumber(amountVal)} ر.ق بنجاح ✓`);
    }

    document.getElementById('safeInvoiceAmount').value = '';
    document.getElementById('safeInvoiceRef').value = '';
    document.getElementById('safeInvoiceNote').value = '';

    saveState();
    renderSafeTab();
  });

  document.getElementById('btnCancelEditSafeInvoice')?.addEventListener('click', () => {
    state.editingSafeInvoiceId = null;
    document.getElementById('safeInvoiceAmount').value = '';
    document.getElementById('safeInvoiceRef').value = '';
    document.getElementById('safeInvoiceNote').value = '';
    const btnAdd = document.getElementById('btnAddSafeInvoice');
    if (btnAdd) {
      btnAdd.textContent = '📑 حفظ الفاتورة المسلّمة للخزنة';
      btnAdd.className = 'btn btn-primary';
    }
    const btnCancel = document.getElementById('btnCancelEditSafeInvoice');
    if (btnCancel) btnCancel.classList.add('hidden');
    showToast('تم إلغاء تعديل الفاتورة');
  });

  document.getElementById('btnAutoFillSafeMonthInvoices')?.addEventListener('click', () => {
    const targetMonth = state.safeMonth || state.month;
    const summary = getPeriodSettlementSummary(state.year, targetMonth, 'safe');
    const amtInput = document.getElementById('safeInvoiceAmount');
    const refInput = document.getElementById('safeInvoiceRef');
    const noteInput = document.getElementById('safeInvoiceNote');

    if (summary.isFullySettled) {
      const prevDate = summary.settlements[0]?.date || 'سابقاً';
      const prevRef = summary.settlements[0]?.ref || '-';
      alert(
        `⚠️ تنبيه منع الازدواجية والتكرار:\n\n` +
        `فواتير شهر ${summary.periodName} تم تسليمها للخزنة مسبقاً بمبلغ (${formatNumber(summary.totalSettled)} ر.ق) بتاريخ ${prevDate} (مرجع: ${prevRef}).\n` +
        `إجمالي فواتير الشهر الحالي: ${formatNumber(summary.currentDriverInvoices)} ر.ق.\n` +
        `لا توجد فواتير متبقية غير مسواة لهذا الشهر.\n\n` +
        `إذا كان لديك كشف فواتير إضافي/تكميلي، يمكنك إدخال المبلغ يدوياً.`
      );
      return;
    }

    if (summary.hasPartialSettlement) {
      if (confirm(
        `💡 تنبيه - فواتير جديدة بعد التسوية السابقة للخزنة:\n\n` +
        `تم تسليم فواتير للخزنة سابقاً بمبلغ (${formatNumber(summary.totalSettled)} ر.ق) لهذا الشهر.\n` +
        `إجمالي الفواتير الآن (${formatNumber(summary.currentDriverInvoices)} ر.ق).\n` +
        `الفرق المتبقي غير المسوى: (${formatNumber(summary.unSettledDiff)} ر.ق).\n\n` +
        `هل تريد تعبئة فارق الفواتير المتبقي (${formatNumber(summary.unSettledDiff)} ر.ق) كفاتورة تكميلية؟`
      )) {
        if (amtInput) amtInput.value = summary.unSettledDiff;
        if (refInput) refInput.value = `كشف تكميلي - فواتير شهر ${ARABIC_MONTHS[targetMonth]} ${state.year}`;
        if (noteInput && !noteInput.value) noteInput.value = `تسوية تكميلية لفارق فواتير شهر ${ARABIC_MONTHS[targetMonth]} ${state.year} (متبقي من أصل ${formatNumber(summary.currentDriverInvoices)})`;
        showToast(`تم سحب فارق الفواتير المتبقي (${formatNumber(summary.unSettledDiff)} ر.ق) بنجاح ⚡`);
        return;
      }
      return;
    }

    if (amtInput) amtInput.value = summary.currentDriverInvoices;
    if (refInput && !refInput.value) refInput.value = `فواتير شهر ${ARABIC_MONTHS[targetMonth]} ${state.year}`;
    if (noteInput && !noteInput.value) noteInput.value = `تسوية فواتير سيارات وسائقي شهر ${ARABIC_MONTHS[targetMonth]} ${state.year}`;
    showToast(`تم سحب إجمالي فواتير شهر ${ARABIC_MONTHS[targetMonth]} (${formatNumber(summary.currentDriverInvoices)} ر.ق) بنجاح ⚡`);
  });

  document.getElementById('btnPrintSafeStatement')?.addEventListener('click', printReportWithHeader);

  document.getElementById('dailyExtraExcludeCompany')?.addEventListener('change', (e) => {
    const isExcluded = e.target.checked;
    setDayExtra(state.selectedDate, { excludeFromCompany: isExcluded });
    renderDailySummaryCards();
    showToast(isExcluded ? 'تم استبعاد هذا المصروف من حسابات الشركة (مصروف جانبي/شخصي) 🚫' : 'تم شمول المصروف في حسابات الشركة');
  });

  document.getElementById('btnPrintReplenishment')?.addEventListener('click', openReplenishmentModal);
  document.getElementById('btnCloseReplenishmentModal')?.addEventListener('click', () => {
    document.getElementById('replenishmentModal').classList.add('hidden');
  });
  document.getElementById('btnPrintReplenishmentNow')?.addEventListener('click', printReplenishmentSheet);

  // Undo Action
  document.getElementById('btnUndo')?.addEventListener('click', performUndo);

  // Header Actions (Excel, Print, Backup Modal)
  document.getElementById('btnExportExcel').addEventListener('click', exportCurrentViewToExcel);
  document.getElementById('btnPrint').addEventListener('click', printReportWithHeader);

  const modal = document.getElementById('backupModal');
  document.getElementById('btnBackupModal').addEventListener('click', () => {
    modal.classList.remove('hidden');
    // Check if a pre-restore snapshot exists for rollback
    const snapRaw = localStorage.getItem('petty_cash_pre_restore_snapshot');
    const btnRollback = document.getElementById('btnRollbackRestore');
    const statusMsg = document.getElementById('restoreStatusMsg');
    if (snapRaw && btnRollback && statusMsg) {
      try {
        const snap = JSON.parse(snapRaw);
        btnRollback.classList.remove('hidden');
        btnRollback.textContent = `↩️ تراجع عن آخر استعادة (نقطة حفظ: ${snap.dateFormatted || 'السابقة'})`;
        statusMsg.textContent = `ℹ️ توجد نقطة تراجع محفوظة مسجلة في ${snap.dateFormatted || 'وقت سابق'}. يمكنك التراجع في أي وقت.`;
        statusMsg.style.color = '#b45309';
      } catch (e) {
        btnRollback.classList.add('hidden');
      }
    } else if (btnRollback) {
      btnRollback.classList.add('hidden');
    }
  });
  document.getElementById('btnCloseBackupModal').addEventListener('click', () => {
    modal.classList.add('hidden');
  });

  // Rollback Action
  document.getElementById('btnRollbackRestore')?.addEventListener('click', () => {
    const snapRaw = localStorage.getItem('petty_cash_pre_restore_snapshot');
    if (!snapRaw) {
      alert('لا توجد نقطة تراجع محفوظة');
      return;
    }
    try {
      const snap = JSON.parse(snapRaw);
      if (!confirm(`هل أنت متأكد من التراجع عن الاستعادة والعودة إلى البيانات السابقة كما كانت (${snap.dateFormatted || ''})؟`)) {
        return;
      }
      rollbackPreRestore();
      showToast('تم التراجع بنجاح واسترجاع البيانات السابقة بالكامل ✓');
      const statusMsg = document.getElementById('restoreStatusMsg');
      if (statusMsg) {
        statusMsg.textContent = '✓ تمت العودة بنجاح إلى النسخة السابقة قبل الاسترجاع.';
        statusMsg.style.color = '#15803d';
      }
      document.getElementById('btnRollbackRestore')?.classList.add('hidden');
    } catch (err) {
      alert('تعذر استرجاع نقطة التراجع: ' + err.message);
    }
  });

  // Backup Reminder Banner actions
  document.getElementById('btnQuickBackupFromBanner')?.addEventListener('click', () => {
    document.getElementById('btnDownloadBackup')?.click();
  });
  document.getElementById('btnDismissBackupReminder')?.addEventListener('click', () => {
    document.getElementById('backupReminderBanner')?.classList.add('hidden');
  });

  document.getElementById('btnDownloadBackup').addEventListener('click', () => {
    const json = JSON.stringify(state.data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `petty_cash_backup_${state.year}.json`;
    a.click();
    URL.revokeObjectURL(url);
    localStorage.setItem('petty_cash_last_backup_download', Date.now().toString());
    checkBackupReminder();
    showToast('تم تحميل ملف النسخة الاحتياطية بنجاح 💾');
  });

  document.getElementById('fileRestoreBackup').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > MAX_BACKUP_SIZE) {
      alert(`⚠️ حجم الملف كبير جداً (${(file.size / (1024 * 1024)).toFixed(2)} ميجابايت). الحد الأقصى المسموح به هو 15 ميجابايت.`);
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        const validatedData = validateBackupPayload(parsed);

        // Before replacing data: Create automatic pre-restore snapshot in localStorage
        const snapshot = {
          timestamp: Date.now(),
          dateFormatted: new Date().toLocaleString('ar-QA'),
          data: JSON.parse(JSON.stringify(state.data))
        };
        localStorage.setItem('petty_cash_pre_restore_snapshot', JSON.stringify(snapshot));

        // Apply new validated data
        state.data = validatedData;
        saveState();
        renderAll();

        const statusMsg = document.getElementById('restoreStatusMsg');
        if (statusMsg) {
          statusMsg.textContent = `✓ تم التحقق من سلامة البيانات واستعادتها بنجاح (${validatedData.people.length} اسم). تم حفظ نقطة تراجع للبيانات السابقة.`;
          statusMsg.style.color = '#15803d';
        }
        const btnRollback = document.getElementById('btnRollbackRestore');
        if (btnRollback) {
          btnRollback.classList.remove('hidden');
          btnRollback.textContent = `↩️ تراجع عن آخر استعادة (نقطة حفظ: ${snapshot.dateFormatted})`;
        }
        showToast('تم استعادة كافة البيانات والتحقق من سلامتها بنجاح ✓');
      } catch (err) {
        alert('فشل استعادة النسخة الاحتياطية: ' + (err.message || 'الملف تالف أو غير صالح'));
        const statusMsg = document.getElementById('restoreStatusMsg');
        if (statusMsg) {
          statusMsg.textContent = `❌ فشلت الاستعادة: ${err.message}`;
          statusMsg.style.color = '#dc2626';
        }
      } finally {
        e.target.value = '';
      }
    };
    reader.readAsText(file);
  });

  // PWA Support & Install Prompt
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const btnInstall = document.getElementById('btnInstallPWA');
    if (btnInstall) {
      btnInstall.classList.remove('hidden');
      btnInstall.addEventListener('click', () => {
        if (deferredPrompt) {
          deferredPrompt.prompt();
          deferredPrompt.userChoice.then(() => {
            deferredPrompt = null;
            btnInstall.classList.add('hidden');
          });
        }
      });
    }
  });

  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').then((reg) => {
        reg.update().catch(() => {});
      }).catch(() => {});
    });
  }
}

// ============================================================================
// Bootstrap Application
// ============================================================================

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    loadState();
    updateMonthLabels();

    // Always open on today's real date on page load (الفتح دائماً على تاريخ اليوم الحالي الحقيقي)
    const todayNow = new Date();
    state.year = todayNow.getFullYear();
    state.month = todayNow.getMonth() + 1;
    state.selectedDate = formatDateKey(state.year, state.month, todayNow.getDate());

    initYearMonthSelectors();
    try {
      bindEvents();
    } catch (err) {
      console.error('Error binding events:', err);
    }
    renderAll();
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    state,
    toCents,
    fromCents,
    addMoney,
    subMoney,
    mulMoney,
    sumMoney,
    validateMonetaryInput,
    formatNumber,
    calculateMonthDriverInvoices,
    getPeriodSettlementSummary,
    getSafeTabFinancials,
    validateBackupPayload,
    migrateLegacyData,
    hasPersonAnyEntryInHistory,
    archivePerson,
    unarchivePerson,
    deleteSafeInvoice,
    reverseSafeInvoice,
    rollbackPreRestore,
    getReportablePeople,
    getPersonBalanceBeforeDate,
    getDayTotals,
    getPersonMonthTotals,
    getPersonYearTotals,
    loadState,
    saveState,
    createCleanData,
        formatCsvCell,
    getDailyDispatchList,
    getDailyDispatchKpis,
    transliterateArabicNameToEnglish,
    getPersonEnglishName,
    translateDispatchNoteToEnglish,
    translateDispatchMetaToEnglish,
    generateDispatchWhatsAppSummary,
    getTankerDeliveries,
    calculateTankerKpis,
    addTankerDelivery,
    updateTankerDelivery,
    deleteTankerDelivery,
    addProjectToMasterList,
    removeProjectFromMasterList,
    openTankerPrintModal,
    closeTankerPrintModal,
    executeCustomTankerPrint,
    printTankerReport
  };
}
