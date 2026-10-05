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
    people: [],        // { id, num, name, role: 'driver'|'staff', meta: 'رقم السيارة / القسم' }
    dailyReceipts: {}, // { "YYYY-MM-DD": number }
    dailyExtras: {},   // { "YYYY-MM-DD": { amount: number, note: string } }
    entries: {},       // { "YYYY-MM-DD": { [personId]: { cash: number, invoice: number, note: string } } }
    custodyReceipts: [] // [ { id, date, amount, ref, note } ] (Company custody fund receipts)
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
      meta: ''
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
  data: createCleanData()
};

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
        state.data = {
          people: parsed.people.map((p, idx) => ({
            id: p.id || ('p_' + idx),
            num: p.num || (idx + 1),
            name: p.name || '',
            role: p.role || 'driver',
            meta: p.meta || ''
          })),
          dailyReceipts: parsed.dailyReceipts || {},
          dailyExtras: parsed.dailyExtras || {},
          entries: parsed.entries || {},
          custodyReceipts: Array.isArray(parsed.custodyReceipts) ? parsed.custodyReceipts : []
        };
      }
    }
  } catch (err) {
    console.error('Failed to load state:', err);
  }
  if (!state.data || !Array.isArray(state.data.people)) {
    state.data = createCleanData();
    saveState();
  }

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
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
  } catch (err) {
    console.error('Failed to save state:', err);
    if (err && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
      alert('⚠️ تحذير: ذاكرة المتصفح ممتلئة ولا يمكن حفظ التعديل الأخير! يرجى الضغط على زر "نسخة احتياطية" من أعلى الصفحة وتنزيل ملف الحفظ فوراً.');
    }
  }
}

function formatNumber(val) {
  const num = Number(val) || 0;
  return num.toLocaleString('en-US', { maximumFractionDigits: 2 });
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

function parseDateParts(dateStr) {
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
  for (const [dateKey, dayObj] of Object.entries(state.data.entries)) {
    if (dateKey.startsWith(prefix) && dayObj && dayObj[personId]) {
      const e = dayObj[personId];
      if ((Number(e.cash) || 0) > 0 || (Number(e.invoice) || 0) > 0 || (e.note && e.note.trim() !== '')) {
        return true;
      }
    }
  }
  return false;
}

function getReportablePeople(year) {
  const all = state.data.people;
  const namedOrActive = all.filter(p => (p.name && p.name.trim() !== '') || hasPersonAnyEntryInYear(p.id, year));
  return namedOrActive.length > 0 ? namedOrActive : all;
}

// ============================================================================
// Data Access & Calculation Helpers
// ============================================================================

function getDayReceived(dateStr) {
  return Number(state.data.dailyReceipts[dateStr]) || 0;
}

function setDayReceived(dateStr, amount) {
  const num = Number(amount);
  if (!num || num <= 0) {
    delete state.data.dailyReceipts[dateStr];
  } else {
    state.data.dailyReceipts[dateStr] = num;
  }
  saveState();
}

function getDayExtra(dateStr) {
  const ex = state.data.dailyExtras && state.data.dailyExtras[dateStr];
  if (!ex) return { amount: 0, note: '' };
  return {
    amount: Number(ex.amount) || 0,
    note: ex.note || ''
  };
}

function setDayExtra(dateStr, updates) {
  if (!state.data.dailyExtras) state.data.dailyExtras = {};
  const cur = getDayExtra(dateStr);
  const next = {
    amount: updates.amount !== undefined ? (Number(updates.amount) || 0) : cur.amount,
    note: updates.note !== undefined ? String(updates.note) : cur.note
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
    return { cash: 0, invoice: 0, note: '' };
  }
  return {
    cash: Number(dayObj[personId].cash) || 0,
    invoice: Number(dayObj[personId].invoice) || 0,
    note: dayObj[personId].note || ''
  };
}

function setPersonEntry(dateStr, personId, updates) {
  if (!state.data.entries[dateStr]) {
    state.data.entries[dateStr] = {};
  }
  const current = getPersonEntry(dateStr, personId);
  const next = {
    cash: updates.cash !== undefined ? (Number(updates.cash) || 0) : current.cash,
    invoice: updates.invoice !== undefined ? (Number(updates.invoice) || 0) : current.invoice,
    note: updates.note !== undefined ? String(updates.note) : current.note
  };

  if (next.cash === 0 && next.invoice === 0 && !next.note.trim()) {
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
    if (entry && Number(entry.cash) > 0) {
      const { m, d } = parseDateParts(dKey);
      return {
        dateKey: dKey,
        d,
        m,
        cash: Number(entry.cash)
      };
    }
  }
  return null;
}

function getDayTotals(dateStr) {
  const received = getDayReceived(dateStr);
  const extra = getDayExtra(dateStr);
  const dayEntries = state.data.entries[dateStr] || {};
  let distributed = 0;
  let driversDistributed = 0;
  let staffDistributed = 0;
  let invoices = 0;
  let activeCashCount = 0;
  let activeInvoiceCount = 0;

  Object.entries(dayEntries).forEach(([pid, entry]) => {
    const c = Number(entry.cash) || 0;
    const inv = Number(entry.invoice) || 0;
    const person = state.data.people.find(p => p.id === pid);
    if (c > 0) {
      distributed += c;
      activeCashCount++;
      if (person && person.role === 'staff') {
        staffDistributed += c;
      } else {
        driversDistributed += c;
      }
    }
    if (inv > 0) {
      invoices += inv;
      activeInvoiceCount++;
    }
  });

  const totalOut = distributed + extra.amount;

  return {
    received,
    distributed,
    driversDistributed,
    staffDistributed,
    extraAmount: extra.amount,
    extraNote: extra.note,
    totalOut,
    remaining: received - totalOut,
    invoices,
    activeCashCount,
    activeInvoiceCount
  };
}

function getPersonMonthTotals(personId, year, month) {
  const daysCount = getDaysInMonth(year, month);
  let cash = 0;
  let invoice = 0;
  for (let d = 1; d <= daysCount; d++) {
    const dateKey = formatDateKey(year, month, d);
    const entry = getPersonEntry(dateKey, personId);
    cash += entry.cash;
    invoice += entry.invoice;
  }
  return { cash, invoice, diff: cash - invoice };
}

function getPersonYearTotals(personId, year) {
  let cash = 0;
  let invoice = 0;
  for (let m = 1; m <= 12; m++) {
    const mt = getPersonMonthTotals(personId, year, m);
    cash += mt.cash;
    invoice += mt.invoice;
  }
  return { cash, invoice, diff: cash - invoice };
}

function getCustodyReceiptsForMonth(year, month) {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  return (state.data.custodyReceipts || []).filter(r => r && r.date && r.date.startsWith(prefix));
}

function getCustodyReceiptsForYear(year) {
  const prefix = `${year}-`;
  return (state.data.custodyReceipts || []).filter(r => r && r.date && r.date.startsWith(prefix));
}

function getSettlementBadgeHtml(cash, invoice) {
  if (cash === 0 && invoice === 0) {
    return `<span class="settlement-badge idle">لا توجد حركة</span>`;
  }
  const diff = cash - invoice;
  if (Math.abs(diff) < 0.001) {
    return `<span class="settlement-badge settled">خالص بالفواتير ✓</span>`;
  } else if (diff > 0) {
    return `<span class="settlement-badge owes">متبقي بعهدته: ${formatNumber(diff)}</span>`;
  } else {
    return `<span class="settlement-badge credit">له فرق مستحق: ${formatNumber(Math.abs(diff))}</span>`;
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

function renderDaysStrip() {
  const strip = document.getElementById('monthDaysStrip');
  const daysCount = getDaysInMonth(state.year, state.month);
  strip.innerHTML = '';

  for (let d = 1; d <= daysCount; d++) {
    const dateKey = formatDateKey(state.year, state.month, d);
    const dayName = getArabicDayName(state.year, state.month, d);
    const isFri = getDayOfWeekIndex(state.year, state.month, d) === 5;
    const totals = getDayTotals(dateKey);
    const hasData = totals.received > 0 || totals.distributed > 0 || totals.invoices > 0 || totals.extraAmount > 0;

    const pill = document.createElement('div');
    pill.className = 'day-pill';
    if (isFri) pill.classList.add('is-friday');
    if (hasData) pill.classList.add('has-data');
    if (dateKey === state.selectedDate) {
      pill.classList.add('active');
      setTimeout(() => {
        pill.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }, 50);
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
  if (totals.extraAmount > 0 || totals.extraNote) {
    extraRow.classList.remove('hidden');
  }
  if (document.activeElement !== extraInput) {
    extraInput.value = totals.extraAmount > 0 ? totals.extraAmount : '';
  }
  if (document.activeElement !== extraNoteInput) {
    extraNoteInput.value = totals.extraNote || '';
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
    return e.cash > 0 || e.invoice > 0;
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
  document.getElementById('footDailyNote').textContent =
    totals.received > 0
      ? `المستلم: ${formatNumber(totals.received)} ر.ق | الموزع: ${formatNumber(totals.distributed)} ر.ق | المتبقي: ${formatNumber(totals.remaining)} ر.ق`
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
    if (state.dailyCategoryFilter === 'driver' && person.role !== 'driver') return false;
    if (state.dailyCategoryFilter === 'staff' && person.role !== 'staff') return false;
    if (state.dailyCategoryFilter === 'active_today') {
      const e = getPersonEntry(state.selectedDate, person.id);
      if (e.cash <= 0 && e.invoice <= 0) return false;
    }
    if (state.dailyCategoryFilter === 'unsettled_month') {
      const mt = getPersonMonthTotals(person.id, state.year, state.month);
      if (mt.diff <= 0.001) return false;
    }
    if (q) {
      const dispName = getPersonDisplayName(person).toLowerCase();
      const metaStr = (person.meta || '').toLowerCase();
      const matchName = dispName.includes(q) || metaStr.includes(q);
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
    if (entry.cash > 0 || entry.invoice > 0) {
      tr.classList.add('active-row');
    }

    tr.innerHTML = `
      <td><strong>${person.num}</strong></td>
      <td>
        <div style="display:flex; flex-direction:column;">
          <input
            type="text"
            class="inline-name-input"
            placeholder="اكتب اسم رقم ${person.num}..."
            value="${(person.name || '').replace(/"/g, '&quot;')}"
            data-inline-name="${person.id}"
            title="اضغط هنا لكتابة أو تعديل الاسم"
          />
          ${!showExt && subtleSubLine ? subtleSubLine : ''}
          ${person.meta ? `<span class="meta-badge" style="width:max-content; margin-top:2px;">${person.meta}</span>` : ''}
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
        <input
          type="text"
          class="cell-input"
          id="noteInp_${person.id}"
          placeholder="ملاحظة (اختياري)..."
          value="${entry.note.replace(/"/g, '&quot;')}"
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
      <td class="col-extra ${showExt ? '' : 'hidden'} no-print" id="mSettleCell_${person.id}">
        ${getSettlementBadgeHtml(monthTotals.cash, monthTotals.invoice)}
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
      if (updated.cash > 0 || updated.invoice > 0) {
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
      }

      const sCell = document.getElementById(`mSettleCell_${pid}`);
      if (sCell) {
        sCell.innerHTML = getSettlementBadgeHtml(mTotals.cash, mTotals.invoice);
      }

      renderDailySummaryCards();
      renderDaysStrip();
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
  renderDaysStrip();
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
    const metaStr = (person.meta || '').toLowerCase();
    if (q && !dispName.toLowerCase().includes(q) && !metaStr.includes(q) && !String(person.num).includes(q)) {
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
            ${person.num}. ${dispName}
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
    const metaStr = (person.meta || '').toLowerCase();
    if (q && !dispName.toLowerCase().includes(q) && !metaStr.includes(q) && !String(person.num).includes(q)) return;

    const mTotals = getPersonMonthTotals(person.id, state.year, state.month);

    const item = document.createElement('div');
    item.className = 'person-list-item' + (person.id === state.selectedPersonId ? ' active' : '');
    item.innerHTML = `
      <div class="p-item-name">
        <span class="p-item-num">#${person.num}</span>
        <span>${dispName}</span>
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
          يرجى إضافة أسماء الأشخاص أولاً من تبويب "1. التسجيل اليومي" أو "5. الأسماء".
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

  const rows = [];
  for (let m = startMonth; m <= endMonth; m++) {
    const daysCount = getDaysInMonth(state.year, m);
    for (let d = 1; d <= daysCount; d++) {
      const dateKey = formatDateKey(state.year, m, d);
      const entry = getPersonEntry(dateKey, person.id);
      if (entry.cash > 0 || entry.invoice > 0 || (entry.note && entry.note.trim() !== '')) {
        rows.push({
          dateKey,
          d,
          m,
          y: state.year,
          dayName: getArabicDayName(state.year, m, d),
          cash: entry.cash,
          invoice: entry.invoice,
          note: entry.note
        });
      }
    }
  }

  tbody.innerHTML = '';

  let totalCash = 0;
  let totalInvoices = 0;
  let runningBalance = 0;

  if (rows.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align:center; padding: 28px; color: var(--text-muted);">
          لا توجد حركات مسجلة لـ <strong>${dispName}</strong> في هذه الفترة. يمكنك إضافتها من الأعلى أو من شاشة التسجيل اليومي.
        </td>
      </tr>
    `;
  } else {
    rows.forEach((r, idx) => {
      totalCash += r.cash;
      totalInvoices += r.invoice;
      runningBalance += (r.cash - r.invoice);

      let balClass = 'bal-settled';
      let balText = '0.00 ر.ق (مصفى)';
      if (runningBalance > 0.001) {
        balClass = 'bal-owes';
        balText = `+${formatNumber(runningBalance)} ر.ق (متبقي بعهدته)`;
      } else if (runningBalance < -0.001) {
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
        <td>${r.note || '-'}</td>
        <td class="col-balance-cell"><span class="${balClass}">${balText}</span></td>
        <td class="no-print">
          <button type="button" class="btn btn-sm btn-outline" data-edit-pdate="${r.dateKey}" title="تعديل هذا السطر">✏️</button>
          <button type="button" class="btn btn-sm btn-danger-outline" data-del-pdate="${r.dateKey}" title="حذف هذا السطر">🗑️</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  document.getElementById('personTotalCash').textContent = formatNumber(totalCash);
  document.getElementById('personTotalInvoices').textContent = formatNumber(totalInvoices);

  const netDiff = totalCash - totalInvoices;
  document.getElementById('ledgerSettlementBadge').innerHTML = getSettlementBadgeHtml(totalCash, totalInvoices);

  document.getElementById('personNetSummaryCell').innerHTML = `
    <span>الفرق النهائي: <strong>${formatNumber(netDiff)} ر.ق</strong> ${netDiff > 0 ? '(متبقي بعهدته)' : netDiff < 0 ? '(له فرق مستحق)' : '(خالص ومصفى)'}</span>
  `;

  document.getElementById('cardPersonCashTotal').textContent = `${formatNumber(totalCash)} ر.ق`;
  document.getElementById('cardPersonInvTotal').textContent = `${formatNumber(totalInvoices)} ر.ق`;
  document.getElementById('cardPersonNetDiff').textContent = `${formatNumber(netDiff)} ر.ق`;

  const statusSubEl = document.getElementById('cardPersonNetStatus');
  if (totalCash === 0 && totalInvoices === 0) {
    statusSubEl.textContent = 'لا توجد مبالغ مسجلة';
    statusSubEl.className = 'p-total-sub text-muted';
  } else if (Math.abs(netDiff) < 0.001) {
    statusSubEl.textContent = '✓ خالص ومصفى بالكامل بالفواتير';
    statusSubEl.className = 'p-total-sub text-green';
  } else if (netDiff > 0) {
    statusSubEl.textContent = `متبقي بعهدته (لم يأتِ بفواتيرها بعد): ${formatNumber(netDiff)} ر.ق`;
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
      document.getElementById('pEntryNote').value = entry.note || '';
      document.getElementById('pEntryCash').focus();
    });
  });

  tbody.querySelectorAll('[data-del-pdate]').forEach(btn => {
    btn.addEventListener('click', () => {
      const dateKey = btn.getAttribute('data-del-pdate');
      if (confirm('هل تريد حذف هذا السطر من صفحة الشخص؟')) {
        setPersonEntry(dateKey, person.id, { cash: 0, invoice: 0, note: '' });
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
  const isYearScope = state.ledgerScope === 'year' && state.activeTab === 'person';
  const scopeLabel = isYearScope ? `سنة ${state.year}` : `شهر ${ARABIC_MONTHS[state.month]} ${state.year}`;

  let totalCash = 0;
  let totalInv = 0;
  const startM = isYearScope ? 1 : state.month;
  const endM = isYearScope ? 12 : state.month;

  for (let m = startM; m <= endM; m++) {
    const mt = getPersonMonthTotals(person.id, state.year, m);
    totalCash += mt.cash;
    totalInv += mt.invoice;
  }

  const diff = totalCash - totalInv;

  document.getElementById('vPeriodText').textContent = `تاريخ الإصدار: ${state.selectedDate}`;
  document.getElementById('vPersonName').textContent = dispName;
  document.getElementById('vPersonRole').textContent = `#${person.num} - ${person.role === 'driver' ? 'سائق' : 'موظف ستاف'}`;
  document.getElementById('vPersonMeta').textContent = person.meta || 'غير محدد';
  document.getElementById('vScopeLabel').textContent = scopeLabel;
  document.getElementById('vTotalCash').textContent = `${formatNumber(totalCash)} ر.ق`;
  document.getElementById('vTotalInv').textContent = `${formatNumber(totalInv)} ر.ق`;
  document.getElementById('vNetStatus').textContent = diff === 0
    ? '0 ر.ق (خالص بالكامل بالفواتير ✓)'
    : (diff > 0 ? `${formatNumber(diff)} ر.ق (متبقي بعهدته لم يأتِ بفواتيرها بعد)` : `${formatNumber(Math.abs(diff))} ر.ق (له فرق فواتير مستحق الصرف)`);

  document.getElementById('voucherModal').classList.remove('hidden');
}

function sharePersonStatementWhatsApp() {
  const person = state.data.people.find(p => p.id === state.selectedPersonId) || state.data.people[0];
  if (!person) {
    alert('يرجى اختيار شخص أولاً');
    return;
  }
  const dispName = getPersonDisplayName(person);
  const isYearScope = state.ledgerScope === 'year';
  const periodTitle = isYearScope ? `سنة ${state.year}` : `شهر ${ARABIC_MONTHS[state.month]} ${state.year}`;

  const startMonth = isYearScope ? 1 : state.month;
  const endMonth = isYearScope ? 12 : state.month;

  let lines = [];
  let totalCash = 0;
  let totalInv = 0;

  for (let m = startMonth; m <= endMonth; m++) {
    const daysCount = getDaysInMonth(state.year, m);
    for (let d = 1; d <= daysCount; d++) {
      const dk = formatDateKey(state.year, m, d);
      const e = getPersonEntry(dk, person.id);
      if (e.cash > 0 || e.invoice > 0 || e.note) {
        totalCash += e.cash;
        totalInv += e.invoice;
        lines.push(`• ${d}/${m}: استلام ${formatNumber(e.cash)} ر.ق | فواتير ${formatNumber(e.invoice)} ر.ق${e.note ? ` (${e.note})` : ''}`);
      }
    }
  }

  const diff = totalCash - totalInv;
  const statusLine = diff === 0
    ? 'خالص بالكامل بالفواتير ✓'
    : (diff > 0 ? `متبقي بعهدته (لم يأتِ بفواتيرها بعد): ${formatNumber(diff)} ر.ق` : `له فرق فواتير مستحق الصرف: ${formatNumber(Math.abs(diff))} ر.ق`);

  const message = [
    `📋 *كشف حساب عهدة وفواتير (بيتي كاش)*`,
    `👤 الاسم: *${dispName}* (#${person.num})${person.meta ? ` - ${person.meta}` : ''}`,
    `📅 الفترة: *${periodTitle}*`,
    `-------------------------`,
    ...(lines.length > 0 ? lines : ['لا توجد حركات مسجلة']),
    `-------------------------`,
    `💵 *إجمالي المبالغ المستلمة:* ${formatNumber(totalCash)} ر.ق`,
    `🧾 *إجمالي الفواتير المقدمة:* ${formatNumber(totalInv)} ر.ق`,
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

  const monthsRange = [];
  for (let m = mFrom; m <= mTo; m++) {
    monthsRange.push(m);
  }

  const isInv = state.annualDataType === 'invoices';

  const monthSummary = {};
  let grandReceived = 0;
  let grandDistributed = 0;
  let grandInvoices = 0;

  monthsRange.forEach(m => {
    const daysCount = getDaysInMonth(state.year, m);
    let rec = 0;
    let dist = 0;
    let inv = 0;
    for (let d = 1; d <= daysCount; d++) {
      const dt = getDayTotals(formatDateKey(state.year, m, d));
      rec += dt.received;
      dist += dt.distributed;
      inv += dt.invoices;
    }
    monthSummary[m] = { rec, dist, inv };
    grandReceived += rec;
    grandDistributed += dist;
    grandInvoices += inv;
  });

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

  annualPeople.forEach(person => {
    const dispName = getPersonDisplayName(person);
    let pGrandCash = 0;
    let pGrandInv = 0;

    let rowCells = '';
    monthsRange.forEach(m => {
      const mt = getPersonMonthTotals(person.id, state.year, m);
      pGrandCash += mt.cash;
      pGrandInv += mt.invoice;
      const val = isInv ? mt.invoice : mt.cash;
      rowCells += `<td>${val > 0 ? `<strong>${formatNumber(val)}</strong>` : '-'}</td>`;
    });

    bodyHtml += `
      <tr>
        <td class="sticky-col">
          <a href="javascript:void(0)" data-open-person="${person.id}" style="font-weight:700; color:var(--text-main); text-decoration:none;">
            ${person.num}. ${dispName}
          </a>
        </td>
        <td>
          <span class="role-badge ${person.role}">
            ${person.role === 'driver' ? 'سائق' : 'ستاف'}
          </span>
        </td>
        ${rowCells}
        <td style="background:#f0fdf4; font-weight:800; color:var(--green);">${formatNumber(pGrandCash)}</td>
        <td style="background:#faf5ff; font-weight:800; color:var(--purple);">${formatNumber(pGrandInv)}</td>
      </tr>
    `;
  });

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
      state.ledgerScope = 'year';
      document.getElementById('ledgerScopeSelect').value = 'year';
      openPersonLedgerPage(el.getAttribute('data-open-person'));
    });
  });
}

// ============================================================================
// TAB 5: People Management (إدارة الأسماء)
// ============================================================================

function renderPeopleManagementTab() {
  const tbody = document.getElementById('peopleManagementTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const allPeople = state.data.people || [];

  // Update counter badges
  const countAll = allPeople.length;
  const countDrivers = allPeople.filter(p => p.role === 'driver').length;
  const countStaff = allPeople.filter(p => p.role === 'staff').length;
  const countActive = allPeople.filter(p => hasPersonAnyEntryInYear(p.id, state.year)).length;

  const countAllEl = document.getElementById('pmCountAll');
  if (countAllEl) countAllEl.textContent = countAll;
  const countDrvEl = document.getElementById('pmCountDrivers');
  if (countDrvEl) countDrvEl.textContent = countDrivers;
  const countStfEl = document.getElementById('pmCountStaff');
  if (countStfEl) countStfEl.textContent = countStaff;
  const countActEl = document.getElementById('pmCountActive');
  if (countActEl) countActEl.textContent = countActive;

  // Filter pills UI state
  document.querySelectorAll('#peopleManageFilterPills .pill').forEach(pill => {
    pill.classList.toggle('active', pill.getAttribute('data-pmfilter') === state.peopleManageFilter);
  });

  // Filter list
  let list = allPeople;
  if (state.peopleManageFilter === 'driver') {
    list = list.filter(p => p.role === 'driver');
  } else if (state.peopleManageFilter === 'staff') {
    list = list.filter(p => p.role === 'staff');
  } else if (state.peopleManageFilter === 'active') {
    list = list.filter(p => hasPersonAnyEntryInYear(p.id, state.year));
  }

  if (state.peopleManageSearch) {
    const q = state.peopleManageSearch.trim().toLowerCase();
    list = list.filter(p =>
      (p.name && p.name.toLowerCase().includes(q)) ||
      (p.meta && p.meta.toLowerCase().includes(q)) ||
      String(p.num) === q
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
    let finBadge = '';
    if (yTot.cash === 0 && yTot.invoice === 0) {
      finBadge = `<span class="settlement-badge idle">لا توجد حركة</span>`;
    } else if (Math.abs(yTot.diff) < 0.001) {
      finBadge = `<span class="settlement-badge settled">خالص بالفواتير ✓</span>`;
    } else if (yTot.diff > 0) {
      finBadge = `<span class="settlement-badge owes">بعهدته: ${formatNumber(yTot.diff)} ر.ق</span>`;
    } else {
      finBadge = `<span class="settlement-badge credit">له فرق: ${formatNumber(Math.abs(yTot.diff))} ر.ق</span>`;
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>#${p.num}</strong></td>
      <td>
        <input
          type="text"
          class="input-control"
          style="width: 100%; font-weight: 700;"
          placeholder="اسم رقم ${p.num}..."
          value="${(p.name || '').replace(/"/g, '&quot;')}"
          data-edit-pname="${p.id}"
        />
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
          value="${(p.meta || '').replace(/"/g, '&quot;')}"
          data-edit-pmeta="${p.id}"
        />
      </td>
      <td>
        <div style="display: flex; flex-direction: column; gap: 3px;">
          ${finBadge}
          ${(yTot.cash > 0 || yTot.invoice > 0) ? `<small style="color:var(--text-muted); font-size:0.75rem;">(استلم: ${formatNumber(yTot.cash)} | فواتير: ${formatNumber(yTot.invoice)})</small>` : ''}
        </div>
      </td>
      <td class="no-print">
        <div style="display: flex; gap: 6px;">
          <button type="button" class="btn btn-sm btn-outline" data-open-person="${p.id}" title="فتح صفحة هذا الشخص">📄 صفحته</button>
          <button type="button" class="btn btn-sm btn-danger-outline" data-del-person="${p.id}" title="حذف الشخص">🗑️</button>
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

  tbody.querySelectorAll('[data-del-person]').forEach(btn => {
    btn.addEventListener('click', () => {
      const pid = btn.getAttribute('data-del-person');
      const p = state.data.people.find(item => item.id === pid);
      if (!p) return;

      // Check if person has financial records
      let hasMoney = false;
      for (const dayObj of Object.values(state.data.entries)) {
        if (dayObj && dayObj[pid] && (Number(dayObj[pid].cash) > 0 || Number(dayObj[pid].invoice) > 0)) {
          hasMoney = true;
          break;
        }
      }

      const msg = hasMoney
        ? `⚠️ تنبيه هام: "${getPersonDisplayName(p)}" مسجل له مبالغ وفواتير في الحسابات.\nحذفه سيؤدي إلى مسح كافة حركاته المالية للحفاظ على توازن الجداول الحسابية وتطابق الإجماليات.\n\nهل أنت متأكد تماماً من حذفه؟`
        : `هل تريد حذف "${getPersonDisplayName(p)}" من القائمة؟`;

      if (confirm(msg)) {
        state.data.people = state.data.people.filter(item => item.id !== pid);
        // Clean up entries to prevent orphaned calculations
        for (const dateKey of Object.keys(state.data.entries)) {
          if (state.data.entries[dateKey] && state.data.entries[dateKey][pid]) {
            delete state.data.entries[dateKey][pid];
          }
        }
        if (state.selectedPersonId === pid) {
          state.selectedPersonId = state.data.people[0]?.id || null;
        }
        renumberPeople();
        saveState();
        renderAll();
        showToast('تم حذف الاسم وتحديث الحسابات بنجاح');
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

  // Calculate monthly distributed and invoices
  let monthDistributed = 0;
  let monthInvoices = 0;
  const daysInM = getDaysInMonth(state.year, state.month);
  for (let d = 1; d <= daysInM; d++) {
    const dk = formatDateKey(state.year, state.month, d);
    const dayEntries = state.data.entries[dk] || {};
    for (const p of state.data.people) {
      const e = dayEntries[p.id];
      if (e) {
        monthDistributed += (Number(e.cash) || 0);
        monthInvoices += (Number(e.invoice) || 0);
      }
    }
    const extra = state.data.dailyExtras[dk];
    if (extra && extra.amount) {
      monthDistributed += (Number(extra.amount) || 0);
    }
  }

  // Monthly net change (حركة هذا الشهر فقط)
  const monthNet = monthReceived - monthDistributed;

  // Cumulative calculation from month 1 up to current selected month (الرصيد التراكمي الفعلي المتبقي بالخزنة)
  let cumulativeReceived = 0;
  let cumulativeDistributed = 0;
  for (let m = 1; m <= state.month; m++) {
    const mRecs = getCustodyReceiptsForMonth(state.year, m);
    cumulativeReceived += mRecs.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
    const daysInM_ = getDaysInMonth(state.year, m);
    for (let d = 1; d <= daysInM_; d++) {
      const dk = formatDateKey(state.year, m, d);
      const dayEntries = state.data.entries[dk] || {};
      for (const p of state.data.people) {
        const e = dayEntries[p.id];
        if (e) {
          cumulativeDistributed += (Number(e.cash) || 0);
        }
      }
      const extra = state.data.dailyExtras[dk];
      if (extra && extra.amount) {
        cumulativeDistributed += (Number(extra.amount) || 0);
      }
    }
  }

  const cumulativeCashInHand = cumulativeReceived - cumulativeDistributed;

  // Update KPIs
  const mRecEl = document.getElementById('custodyMonthReceived');
  if (mRecEl) mRecEl.textContent = `${formatNumber(monthReceived)} ر.ق`;

  const yRecSubEl = document.getElementById('custodyYearReceivedSub');
  if (yRecSubEl) yRecSubEl.textContent = `إجمالي دفعات السنة: ${formatNumber(yearReceived)} ر.ق`;

  const mDistEl = document.getElementById('custodyMonthDistributed');
  if (mDistEl) mDistEl.textContent = `${formatNumber(monthDistributed)} ر.ق`;

  const mInvEl = document.getElementById('custodyMonthInvoices');
  if (mInvEl) mInvEl.textContent = `${formatNumber(monthInvoices)} ر.ق`;

  // Real Cumulative Cash In Hand Card
  const cashHandEl = document.getElementById('custodyCashInHand');
  const balStatusEl = document.getElementById('custodyBalanceStatus');
  const monthNetValEl = document.getElementById('custodyMonthNetVal');

  if (cashHandEl) {
    cashHandEl.textContent = `${formatNumber(cumulativeCashInHand)} ر.ق`;
    if (cumulativeCashInHand > 0) {
      cashHandEl.className = 'kpi-value text-green';
      if (balStatusEl) {
        balStatusEl.textContent = `فائض نقدي متاح بالخزنة: +${formatNumber(cumulativeCashInHand)} ر.ق`;
        balStatusEl.className = 'kpi-sub-split text-green';
      }
    } else if (cumulativeCashInHand < 0) {
      cashHandEl.className = 'kpi-value text-danger';
      if (balStatusEl) {
        balStatusEl.textContent = `عجز نقدي بالخزنة: -${formatNumber(Math.abs(cumulativeCashInHand))} ر.ق (مطلوب استعاضة)`;
        balStatusEl.className = 'kpi-sub-split text-danger';
      }
    } else {
      cashHandEl.className = 'kpi-value';
      if (balStatusEl) {
        balStatusEl.textContent = 'الرصيد التراكمي متزن تماماً 0.00 ر.ق';
        balStatusEl.className = 'kpi-sub-split';
      }
    }
  }

  if (monthNetValEl) {
    const sign = monthNet > 0 ? '+' : '';
    monthNetValEl.textContent = `${sign}${formatNumber(monthNet)} ر.ق`;
    monthNetValEl.style.color = monthNet > 0 ? 'var(--green)' : monthNet < 0 ? 'var(--danger)' : 'var(--text-muted)';
  }

  // Set default receipt date if empty
  const receiptDateInput = document.getElementById('custodyReceiptDate');
  if (receiptDateInput && !receiptDateInput.value) {
    receiptDateInput.value = state.selectedDate;
  }

  // Render receipts table
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
          <td>${r.ref || '-'}</td>
          <td>${r.note || '-'}</td>
          <td class="no-print">
            <button type="button" class="btn btn-sm btn-danger-outline" data-del-custody="${r.id}" title="حذف الدفعة">🗑️</button>
          </td>
        `;
        tbodyReceipts.appendChild(tr);
      });

      tbodyReceipts.querySelectorAll('[data-del-custody]').forEach(btn => {
        btn.addEventListener('click', () => {
          const cid = btn.getAttribute('data-del-custody');
          if (confirm('هل أنت متأكد من حذف هذه الدفعة من سجل العهدة المستلمة؟')) {
            state.data.custodyReceipts = (state.data.custodyReceipts || []).filter(item => item.id !== cid);
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

  // Render drivers pending balance summary
  const tbodyDrivers = document.getElementById('custodyDriversSummaryBody');
  if (tbodyDrivers) {
    tbodyDrivers.innerHTML = '';
    const driverSummaryList = [];

    state.data.people.forEach(p => {
      const mTot = getPersonMonthTotals(p.id, state.year, state.month);
      if (mTot.cash > 0 || mTot.invoice > 0) {
        driverSummaryList.push({
          person: p,
          cash: mTot.cash,
          invoice: mTot.invoice,
          diff: mTot.diff
        });
      }
    });

    if (driverSummaryList.length === 0) {
      tbodyDrivers.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; padding: 24px; color: var(--text-muted);">
            لا توجد حركات عهدة أو فواتير مسجلة للسائقين في شهر ${ARABIC_MONTHS[state.month]} ${state.year}.
          </td>
        </tr>
      `;
    } else {
      driverSummaryList.sort((a, b) => b.diff - a.diff);

      driverSummaryList.forEach((item, idx) => {
        let badgeHtml = '';
        if (Math.abs(item.diff) < 0.001) {
          badgeHtml = `<span class="settlement-badge settled">خالص بالفواتير ✓</span>`;
        } else if (item.diff > 0) {
          badgeHtml = `<span class="settlement-badge owes">متبقي بذمته: ${formatNumber(item.diff)}</span>`;
        } else {
          badgeHtml = `<span class="settlement-badge credit">له فرق: ${formatNumber(Math.abs(item.diff))}</span>`;
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${idx + 1}</strong></td>
          <td><strong>${getPersonDisplayName(item.person)}</strong> ${item.person.meta ? `<small class="text-muted">(${item.person.meta})</small>` : ''}</td>
          <td><span class="role-badge ${item.person.role}">${item.person.role === 'driver' ? 'سائق' : 'ستاف'}</span></td>
          <td class="col-cash-cell">${formatNumber(item.cash)}</td>
          <td class="col-inv-cell">${formatNumber(item.invoice)}</td>
          <td style="font-weight: 800; font-size: 1.02rem;">
            ${item.diff > 0 ? `<span class="text-amber">+${formatNumber(item.diff)} ر.ق</span>` : (item.diff < 0 ? `<span class="text-blue">-${formatNumber(Math.abs(item.diff))} ر.ق</span>` : '0.00 ر.ق')}
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

// Replenishment Statement Modal Logic
function openReplenishmentModal() {
  const mRecList = getCustodyReceiptsForMonth(state.year, state.month);
  const monthReceived = mRecList.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

  let monthDistributed = 0;
  let monthInvoices = 0;
  const categoryTotals = {
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
        const cash = Number(e.cash) || 0;
        const inv = Number(e.invoice) || 0;
        monthDistributed += cash;
        monthInvoices += inv;

        if (inv > 0) {
          const note = (e.note || '').toLowerCase();
          if (note.includes('بترول') || note.includes('وقود') || note.includes('ديزل') || note.includes('بنزين') || note.includes('petrol')) {
            categoryTotals['⛽ بترول / وقود'] += inv;
          } else if (note.includes('صيانة') || note.includes('تصليح') || note.includes('ميكانيك') || note.includes('غسيل') || note.includes('إطارات')) {
            categoryTotals['🔧 صيانة وإصلاحات'] += inv;
          } else if (note.includes('مشتريات') || note.includes('أغراض') || note.includes('قطع') || note.includes('شراء')) {
            categoryTotals['📦 مشتريات ومواد'] += inv;
          } else if (note.includes('نثريات') || note.includes('شاي') || note.includes('ضيافة') || note.includes('ماء')) {
            categoryTotals['☕ نثريات وضيافة'] += inv;
          } else {
            categoryTotals['📋 مصروفات أخرى'] += inv;
          }
        }
      }
    }
  }

  const cashInHand = monthReceived - monthDistributed;

  document.getElementById('repPeriodSubtitle').textContent = `الفترة المحاسبية: شهر ${ARABIC_MONTHS[state.month]} ${state.year} — تاريخ الإصدار: ${state.selectedDate}`;
  document.getElementById('repTotalReceived').textContent = `${formatNumber(monthReceived)} ر.ق`;
  document.getElementById('repTotalDistributed').textContent = `${formatNumber(monthDistributed)} ر.ق`;
  document.getElementById('repTotalInvoices').textContent = `${formatNumber(monthInvoices)} ر.ق`;
  document.getElementById('repCashRemaining').textContent = `${formatNumber(cashInHand)} ر.ق`;

  const tbody = document.getElementById('repCategoryBreakdownBody');
  tbody.innerHTML = '';
  for (const [catName, catVal] of Object.entries(categoryTotals)) {
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
  trTot.style.background = '#f1f5f9';
  trTot.innerHTML = `
    <td><strong>إجمالي الفواتير المطلوب استعاضتها</strong></td>
    <td style="font-weight: 800; color: var(--purple); font-size: 1.1rem;">${formatNumber(monthInvoices)} ر.ق</td>
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
            calcDisplayVal = String(Number(res.toFixed(4)));
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
    note: curExtra.note ? `${curExtra.note} + مرحل ليوم ${nextDateKey}` : `مرحل ليوم ${nextDateKey}`
  });

  const nextRec = getDayReceived(nextDateKey);
  setDayReceived(nextDateKey, nextRec + remAmount);

  renderDailyTab();
  showToast(`تم ترحيل ${formatNumber(remAmount)} ر.ق إلى يوم ${nextDateKey} بنجاح 🔄`);
}

// ============================================================================
// Navigation & Event Listeners
// ============================================================================

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
  updateMonthLabels();
  if (state.activeTab === 'daily') renderDailyTab();
  if (state.activeTab === 'monthly') renderMonthlyMatrixTab();
  if (state.activeTab === 'person') renderPersonTab();
  if (state.activeTab === 'annual') renderAnnualTab();
  if (state.activeTab === 'people') renderPeopleManagementTab();
  if (state.activeTab === 'custody') renderCustodyTab();
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
    meta: (meta || '').trim()
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
    csvRows.push(['التاريخ', 'اليوم', 'الفلوس اللي استلمها (ر.ق)', 'الفواتير المقدمة - بيتي كاش (ر.ق)', 'البيان / الملاحظات']);

    let totalC = 0;
    let totalI = 0;
    for (let m = 1; m <= 12; m++) {
      const days = getDaysInMonth(state.year, m);
      for (let d = 1; d <= days; d++) {
        const dk = formatDateKey(state.year, m, d);
        const e = getPersonEntry(dk, person.id);
        if (e.cash > 0 || e.invoice > 0 || e.note) {
          totalC += e.cash;
          totalI += e.invoice;
          csvRows.push([dk, getArabicDayName(state.year, m, d), e.cash, e.invoice, `"${(e.note || '').replace(/"/g, '""')}"`]);
        }
      }
    }
    csvRows.push(['الإجمالي الكلي (ر.ق)', '', totalC, totalI, `الصافي: ${totalC - totalI} ر.ق`]);
  } else {
    const daysCount = getDaysInMonth(state.year, state.month);
    const header = ['الرقم', 'الاسم', 'الفئة', 'السيارة/القسم'];
    const workDays = [];
    for (let d = 1; d <= daysCount; d++) {
      if (state.hideFridaysInMonthly && getDayOfWeekIndex(state.year, state.month, d) === 5) continue;
      workDays.push(d);
      header.push(`يوم ${d}`);
    }
    header.push('إجمالي المبالغ بالشهر (ر.ق)', 'إجمالي الفواتير بالشهر (ر.ق)');
    csvRows.push(header);

    const recRow = ['', 'إجمالي المستلم اليومي', 'الوارد', ''];
    let mRec = 0;
    workDays.forEach(d => {
      const r = getDayReceived(formatDateKey(state.year, state.month, d));
      mRec += r;
      recRow.push(r);
    });
    recRow.push(mRec, '');
    csvRows.push(recRow);

    const exportPeople = getReportablePeople(state.year);
    exportPeople.forEach(p => {
      const row = [p.num, `"${getPersonDisplayName(p)}"`, p.role === 'driver' ? 'سائق' : 'ستاف', `"${p.meta || ''}"`];
      workDays.forEach(d => {
        const e = getPersonEntry(formatDateKey(state.year, state.month, d), p.id);
        row.push(e.cash || 0);
      });
      const mt = getPersonMonthTotals(p.id, state.year, state.month);
      row.push(mt.cash, mt.invoice);
      csvRows.push(row);
    });
  }

  const csvString = '\uFEFF' + csvRows.map(r => r.join(',')).join('\n');
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
  if (subEl) {
    if (state.activeTab === 'daily') {
      const { y, m, d } = parseDateParts(state.selectedDate);
      subEl.textContent = `كشف التسجيل والتوزيع اليومي — ${getArabicDayName(y, m, d)} ${d} ${ARABIC_MONTHS[m]} ${y}`;
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
    } else {
      subEl.textContent = `قائمة السائقين والستاف المسجلين`;
    }
  }
  if (dateEl) {
    const todayStr = new Date().toISOString().slice(0, 10);
    dateEl.textContent = `تاريخ الطباعة: ${todayStr}`;
  }
  window.print();
}

function printVoucherOnly() {
  document.body.classList.add('printing-voucher');
  window.print();
  setTimeout(() => {
    document.body.classList.remove('printing-voucher');
  }, 500);
}

window.addEventListener('afterprint', () => {
  document.body.classList.remove('printing-voucher');
});

function bindEvents() {
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
  document.getElementById('btnConnectCloudAccount')?.addEventListener('click', () => {
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
      localStorage.setItem('petty_cash_cloud_account', JSON.stringify({ acct, pin, lastSync: new Date().toISOString() }));
    } catch (e) {}
    const badge = document.getElementById('cloudSyncStatusBadge');
    if (badge) {
      badge.textContent = `✓ تم ربط الحساب محلياً (${acct}) ومستعد للمزامنة فور الرفع أونلاين`;
      badge.style.color = '#15803d';
      badge.style.fontWeight = 'bold';
    }
    showToast('تم حفظ الحساب السحابي بنجاح ✓');
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
    renderDaysStrip();
  });

  document.getElementById('dailyExtraInput').addEventListener('input', (e) => {
    setDayExtra(state.selectedDate, { amount: e.target.value });
    renderDailySummaryCards();
    renderDaysStrip();
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
    const noteVal = document.getElementById('pEntryNote').value || '';

    setPersonEntry(dateVal, state.selectedPersonId, {
      cash: cashVal,
      invoice: invVal,
      note: noteVal
    });

    document.getElementById('pEntryCash').value = '';
    document.getElementById('pEntryInvoice').value = '';
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
        meta: ''
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
          meta: ''
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
    state.data.custodyReceipts.push({
      id: 'cr_' + Date.now(),
      date: dateVal,
      amount: amountVal,
      ref: refVal,
      note: noteVal
    });

    document.getElementById('custodyReceiptAmount').value = '';
    document.getElementById('custodyReceiptRef').value = '';
    document.getElementById('custodyReceiptNote').value = '';

    saveState();
    renderCustodyTab();
    showToast(`تم تسجيل دفعة استلام عهدة بمبلغ ${formatNumber(amountVal)} ر.ق بنجاح ✓`);
  });

  document.getElementById('btnPrintReplenishment')?.addEventListener('click', openReplenishmentModal);
  document.getElementById('btnCloseReplenishmentModal')?.addEventListener('click', () => {
    document.getElementById('replenishmentModal').classList.add('hidden');
  });
  document.getElementById('btnPrintReplenishmentNow')?.addEventListener('click', printReplenishmentSheet);

  // Header Actions (Excel, Print, Backup Modal)
  document.getElementById('btnExportExcel').addEventListener('click', exportCurrentViewToExcel);
  document.getElementById('btnPrint').addEventListener('click', printReportWithHeader);

  const modal = document.getElementById('backupModal');
  document.getElementById('btnBackupModal').addEventListener('click', () => {
    modal.classList.remove('hidden');
  });
  document.getElementById('btnCloseBackupModal').addEventListener('click', () => {
    modal.classList.add('hidden');
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
    showToast('تم تحميل ملف النسخة الاحتياطية');
  });

  document.getElementById('fileRestoreBackup').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        if (parsed && Array.isArray(parsed.people)) {
          state.data = {
            people: parsed.people || [],
            dailyReceipts: parsed.dailyReceipts || {},
            dailyExtras: parsed.dailyExtras || {},
            entries: parsed.entries || {},
            custodyReceipts: Array.isArray(parsed.custodyReceipts) ? parsed.custodyReceipts : []
          };
          saveState();
          renderAll();
          modal.classList.add('hidden');
          showToast('تم استعادة كافة البيانات بنجاح ✓');
        } else {
          alert('ملف غير صالح');
        }
      } catch (err) {
        alert('تعذر قراءة الملف');
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

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }
}

// ============================================================================
// Bootstrap Application
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  // Purge any stale service worker caches immediately
  if ('caches' in window) {
    caches.keys().then(keys => {
      keys.forEach(k => caches.delete(k));
    }).catch(() => {});
  }
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
