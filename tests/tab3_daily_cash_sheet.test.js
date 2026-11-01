/**
 * tests/tab3_daily_cash_sheet.test.js
 * Comprehensive automated test suite for Tab 3: Daily Cash Distribution Sheet (Daily Cash Sheet).
 * Verifies:
 * 1. Strict descending sort by cash amount with deterministic tie-breaker by person number.
 * 2. Smart offline Arabic-to-English name transliteration (dictionary + phonetic).
 * 3. In-place custom English name override and persistence in state.
 * 4. Role filtering (all, driver, staff).
 * 5. Accurate KPI summary calculations (Total Disbursed, Beneficiaries Count, Top Recipient, Drawer Balance).
 * 6. Bilingual WhatsApp report generator (Arabic and English).
 * 7. Excel CSV export structure and formula injection protection.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const appPath = path.join(__dirname, '..', 'app.js');
const appCode = fs.readFileSync(appPath, 'utf8');

const storage = {};
const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  localStorage: {
    getItem: (k) => storage[k] || null,
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; },
    clear: () => { Object.keys(storage).forEach(k => delete storage[k]); }
  },
  document: {
    getElementById: () => null,
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: () => {},
    createElement: () => ({ setAttribute: () => {}, appendChild: () => {}, style: {} }),
    body: { classList: { add: () => {}, remove: () => {}, toggle: () => {} } }
  },
  navigator: {},
  window: {}
};
sandbox.window = sandbox;

vm.createContext(sandbox);
vm.runInContext(appCode, sandbox);

const app = sandbox;
const state = sandbox.state;

console.log('================================================================');
console.log('📑 TAB 3: DAILY CASH DISTRIBUTION SHEET AUTOMATED TEST SUITE');
console.log('================================================================\n');

let passedTests = 0;
function test(desc, fn) {
  try {
    fn();
    console.log(`  ✓ PASSED: ${desc}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAILED: ${desc}`);
    console.error(`     Error: ${err.message}`);
    process.exit(1);
  }
}

// -------------------------------------------------------------
// CATEGORY 1: Offline Transliteration & English Name Logic
// -------------------------------------------------------------
console.log('📌 CATEGORY 1: Offline Arabic-to-English Transliteration & Custom Names');

test('[Test 1] Transliterates compound names correctly (Abdulsalam, Abdul Rashid, etc.)', () => {
  assert.strictEqual(app.transliterateArabicNameToEnglish('عبد السلام'), 'Abdulsalam');
  assert.strictEqual(app.transliterateArabicNameToEnglish('عبد الرشيد'), 'Abdul Rashid');
  assert.strictEqual(app.transliterateArabicNameToEnglish('عبد الرحمن'), 'Abdul Rahman');
  assert.strictEqual(app.transliterateArabicNameToEnglish('عبد الله'), 'Abdullah');
  assert.strictEqual(app.transliterateArabicNameToEnglish('سيف الدين'), 'Saifuddin');
});

test('[Test 2] Transliterates standard single and multi-word driver names', () => {
  assert.strictEqual(app.transliterateArabicNameToEnglish('محمد عمر'), 'Mohamed Omar');
  assert.strictEqual(app.transliterateArabicNameToEnglish('أحمد علي'), 'Ahmed Ali');
  assert.strictEqual(app.transliterateArabicNameToEnglish('طارق بلال'), 'Tariq Bilal');
  assert.strictEqual(app.transliterateArabicNameToEnglish('علي خان'), 'Ali Khan');
});

test('[Test 3] Transliterates unlisted names using phonetic fallback rules', () => {
  const result = app.transliterateArabicNameToEnglish('شمسكار');
  assert(result && result.length > 0, 'Phonetic fallback should generate a non-empty string');
  assert.strictEqual(result.charAt(0), result.charAt(0).toUpperCase(), 'Output must be Title Case');
});

test('[Test 4] getPersonEnglishName prioritizes person.nameEn when set', () => {
  const pCustom = { id: 'p_10', num: 10, name: 'عبد السلام', nameEn: 'Abdel-Salam (VIP)' };
  assert.strictEqual(app.getPersonEnglishName(pCustom), 'Abdel-Salam (VIP)');

  const pAuto = { id: 'p_11', num: 11, name: 'عبد السلام', nameEn: '' };
  assert.strictEqual(app.getPersonEnglishName(pAuto), 'Abdulsalam');
});

test('[Test 5] Translates vehicle metadata and notes accurately', () => {
  assert.strictEqual(app.translateDispatchMetaToEnglish('سيارة 401'), 'Vehicle 401');
  assert.strictEqual(app.translateDispatchMetaToEnglish('المكتب'), 'Office');
  assert.strictEqual(app.translateDispatchNoteToEnglish('وقود وصيانة'), 'Fuel & Maintenance');
  assert.strictEqual(app.translateDispatchNoteToEnglish('سلفة رحلة'), 'Trip Advance');
});

// -------------------------------------------------------------
// CATEGORY 2: Daily Cash Distribution Sorting & Deterministic Tie-Breaker
// -------------------------------------------------------------
console.log('\n📌 CATEGORY 2: Daily Cash Distribution Sorting & Tie-Breaker');

test('[Test 6] Filters only people who took cash (cash > 0) on the selected date', () => {
  state.data.people = [
    { id: 'p_1', num: 1, name: 'عبد السلام', role: 'driver', meta: 'سيارة 401', nameEn: '' },
    { id: 'p_2', num: 2, name: 'عبد الرشيد', role: 'driver', meta: 'سيارة 402', nameEn: '' },
    { id: 'p_3', num: 3, name: 'محمد عمر', role: 'staff', meta: 'المكتب', nameEn: '' },
    { id: 'p_4', num: 4, name: 'خالد سالم', role: 'driver', meta: 'سيارة 403', nameEn: '' }
  ];
  state.data.entries = {
    '2026-01-15': {
      'p_1': { cash: 1500, invoice: 1200, returnedCash: 300, note: 'وقود' },
      'p_2': { cash: 2500, invoice: 0, returnedCash: 0, note: 'سلفة' },
      'p_3': { cash: 800, invoice: 800, returnedCash: 0, note: 'مشتريات' },
      'p_4': { cash: 0, invoice: 500, returnedCash: 0, note: 'فواتير سابقة فقط' } // cash is 0, must be excluded!
    }
  };

  const list = app.getDailyDispatchList('2026-01-15', 'all');
  assert.strictEqual(list.length, 3, 'Should include only the 3 people who received cash');
  assert.strictEqual(list.some(x => x.person.id === 'p_4'), false, 'Person with cash=0 must be excluded');
});

test('[Test 7] Sorts strictly from highest cash amount to lowest cash amount', () => {
  const list = app.getDailyDispatchList('2026-01-15', 'all');
  assert.strictEqual(list[0].person.id, 'p_2', 'First recipient must be p_2 with 2500 QAR');
  assert.strictEqual(list[0].cash, 2500);
  assert.strictEqual(list[1].person.id, 'p_1', 'Second recipient must be p_1 with 1500 QAR');
  assert.strictEqual(list[1].cash, 1500);
  assert.strictEqual(list[2].person.id, 'p_3', 'Third recipient must be p_3 with 800 QAR');
  assert.strictEqual(list[2].cash, 800);
});

test('[Test 8] Deterministic tie-breaker: Equal cash amounts sort by person.num ascending', () => {
  state.data.entries['2026-01-15']['p_1'].cash = 2000;
  state.data.entries['2026-01-15']['p_2'].cash = 2000;
  // p_1 has num=1, p_2 has num=2. Both have 2000 QAR.
  const list = app.getDailyDispatchList('2026-01-15', 'all');
  assert.strictEqual(list[0].person.num, 1, 'num=1 must precede num=2 when amounts are equal');
  assert.strictEqual(list[1].person.num, 2, 'num=2 must follow num=1');
  assert.strictEqual(list[0].cash, 2000);
  assert.strictEqual(list[1].cash, 2000);
});

// -------------------------------------------------------------
// CATEGORY 3: Role Filtering
// -------------------------------------------------------------
console.log('\n📌 CATEGORY 3: Role Filtering (All / Drivers / Staff)');

test('[Test 9] Role filter "driver" returns only drivers who took cash', () => {
  const list = app.getDailyDispatchList('2026-01-15', 'driver');
  assert.strictEqual(list.length, 2, 'Should return only the 2 drivers');
  assert(list.every(x => x.person.role === 'driver'), 'Every item must be a driver');
});

test('[Test 10] Role filter "staff" returns only staff who took cash', () => {
  const list = app.getDailyDispatchList('2026-01-15', 'staff');
  assert.strictEqual(list.length, 1, 'Should return only 1 staff member');
  assert.strictEqual(list[0].person.id, 'p_3');
  assert.strictEqual(list[0].person.role, 'staff');
});

// -------------------------------------------------------------
// CATEGORY 4: Accurate KPI Summary Calculations
// -------------------------------------------------------------
console.log('\n📌 CATEGORY 4: Daily Dispatch KPI Summary Calculations');

test('[Test 11] Calculates total disbursed and beneficiaries count with integer precision', () => {
  state.data.dailyReceipts = { '2026-01-15': 6000 };
  state.data.dailyExtras = { '2026-01-15': { amount: 200, note: '', excludeFromCompany: false } };
  // p_1=2000, p_2=2000, p_3=800 -> total = 4800 QAR
  const kpis = app.getDailyDispatchKpis('2026-01-15', 'all');
  assert.strictEqual(kpis.count, 3);
  assert.strictEqual(kpis.totalDisbursed, 4800);
  assert.strictEqual(kpis.totalVaultReceived, 6000);
});

test('[Test 12] Correctly identifies top recipient and amount', () => {
  state.data.entries['2026-01-15']['p_2'].cash = 3500;
  const kpis = app.getDailyDispatchKpis('2026-01-15', 'all');
  assert.strictEqual(kpis.topRecipient.person.id, 'p_2');
  assert.strictEqual(kpis.topRecipient.amount, 3500);
});

// -------------------------------------------------------------
// CATEGORY 5: Bilingual WhatsApp Report Generator
// -------------------------------------------------------------
console.log('\n📌 CATEGORY 5: Bilingual WhatsApp Report Generator');

test('[Test 13] Generates complete Arabic WhatsApp report with formatted metrics and ranked list', () => {
  state.dispatchRoleFilter = 'all';
  const arReport = app.generateDispatchWhatsAppSummary('2026-01-15', false);
  assert(arReport.includes('تقرير كشف الصرف والتوزيع اليومي'), 'Must include Arabic title');
  assert(arReport.includes('*إجمالي المنصرف:*'), 'Must include total disbursed label');
  assert(arReport.includes('3 مستلم'), 'Must include count');
  assert(arReport.includes('عبد الرشيد'), 'Must include top recipient name');
  assert(arReport.includes('3,500 ر.ق'), 'Must format amount properly');
});

test('[Test 14] Generates complete English WhatsApp report with transliterated names and labels', () => {
  state.dispatchRoleFilter = 'all';
  const enReport = app.generateDispatchWhatsAppSummary('2026-01-15', true);
  assert(enReport.includes('DAILY CASH DISTRIBUTION REPORT'), 'Must include English title');
  assert(enReport.includes('*Total Disbursed:*'), 'Must include total disbursed label');
  assert(enReport.includes('3 recipients'), 'Must include count');
  assert(enReport.includes('Abdul Rashid'), 'Must include transliterated English name');
  assert(enReport.includes('3,500 QAR'), 'Must format currency as QAR');
});

// -------------------------------------------------------------
// CATEGORY 6: Schema Integrity & In-Place Name Persistence
// -------------------------------------------------------------
console.log('\n📌 CATEGORY 6: Schema Integrity & In-Place Name Persistence');

test('[Test 15] Editing person.nameEn persists across saveState and loadState', () => {
  state.data.people[1].nameEn = 'Abdul Rashid Al-Sayed';
  app.saveState();

  // Reset in-memory state and reload from storage
  state.data.people = [];
  app.loadState();

  const loaded = state.data.people.find(p => p.id === 'p_2');
  assert(loaded, 'Person p_2 must exist after reload');
  assert.strictEqual(loaded.nameEn, 'Abdul Rashid Al-Sayed', 'Custom English name must be restored from localStorage');
});

test('[Test 16] validateBackupPayload preserves nameEn without corruption', () => {
  const payload = {
    schemaVersion: 5,
    people: [
      { id: 'p_99', num: 1, name: 'محمد علي', nameEn: 'Mohamed Ali VIP', role: 'driver', meta: '401' }
    ],
    dailyReceipts: {},
    dailyExtras: {},
    entries: {},
    custodyReceipts: [],
    custodySettlements: [],
    safeInvoices: [],
    safeInvoicesAudit: []
  };

  const validated = app.validateBackupPayload(payload);
  assert.strictEqual(validated.people[0].nameEn, 'Mohamed Ali VIP', 'nameEn must be preserved in backup validation');
});

test('[Test 17] formatCsvCell neutralizes formula injection in English & Arabic names', () => {
  assert.strictEqual(app.formatCsvCell('=SUM(A1:A10)'), '"\'=SUM(A1:A10)"');
  assert.strictEqual(app.formatCsvCell('+12345'), '"\'+12345"');
  assert.strictEqual(app.formatCsvCell('-500'), '"\'-500"');
  assert.strictEqual(app.formatCsvCell('@admin'), '"\'@admin"');
  assert.strictEqual(app.formatCsvCell('Mohamed Omar'), '"Mohamed Omar"');
});

console.log('\n================================================================');
console.log(`🏁 TAB 3 TEST RESULTS: ${passedTests} / 17 TESTS PASSED (100%)`);
console.log('✅ ALL DAILY CASH DISTRIBUTION SHEET TESTS PASSED SUCCESSFULLY');
console.log('================================================================\n');
