/**
 * TAB 9: TANKER DIESEL & PROJECT FUEL ALLOCATION TEST SUITE
 * Verifies 100% of Tanker Delivery CRUD, minor-unit financial precision,
 * project allocation math, filtering, CSV security, and backup resilience.
 */

const assert = require('assert');
const app = require('../app.js');

const storage = {};
if (typeof global.localStorage === 'undefined') {
  global.localStorage = {
    getItem: (k) => storage[k] || null,
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; },
    clear: () => { Object.keys(storage).forEach(k => delete storage[k]); }
  };
}

const {
  state,
  toCents,
  fromCents,
  createCleanData,
  validateBackupPayload,
  formatCsvCell,
  getTankerDeliveries,
  calculateTankerKpis,
  addTankerDelivery,
  updateTankerDelivery,
  deleteTankerDelivery,
  saveState,
  loadState,
  addProjectToMasterList,
  removeProjectFromMasterList
} = app;

console.log('================================================================');
console.log('⛽ TAB 9: TANKER DIESEL & PROJECT ALLOCATION AUTOMATED TEST SUITE');
console.log('================================================================\n');

let passed = 0;
let total = 0;

function test(description, fn) {
  total++;
  try {
    fn();
    console.log(`  ✓ PASSED: [Test ${total}] ${description}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAILED: [Test ${total}] ${description}`);
    console.error('    Error:', err.message);
    throw err;
  }
}

// Reset state before tests
state.year = 2026;
state.month = 11;
state.selectedDate = '2026-11-08';
state.data = createCleanData();
state.tankerSearch = '';
state.tankerProjectFilter = 'all';
state.tankerPeriodFilter = 'current';

console.log('📌 CATEGORY 1: Tanker Delivery CRUD & State Management');

test('addTankerDelivery creates a valid delivery record with exact minor-unit precision', () => {
  const delivery = addTankerDelivery({
    date: '2026-11-08',
    project: 'مشروع لوسيل',
    liters: 500,
    pricePerLiter: 2.10,
    amount: 1050.00,
    invoiceNo: 'INV-4402',
    receiver: 'م/ أحمد حسن',
    supplier: 'شركة وقود (WOQOD)',
    notes: 'تفريغ مولدات الموقع الرئيسي'
  });

  assert.ok(delivery.id && delivery.id.startsWith('tank_'), 'Delivery should have valid ID');
  assert.strictEqual(delivery.project, 'مشروع لوسيل');
  assert.strictEqual(delivery.liters, 500);
  assert.strictEqual(delivery.amount, 1050.00);
  assert.strictEqual(state.data.tankerDeliveries.length, 1);
});

test('addTankerDelivery rejects invalid inputs gracefully with clear error messages', () => {
  assert.throws(() => {
    addTankerDelivery({ date: '2026-11-08', project: '', liters: 100, amount: 200 });
  }, /يرجى تحديد اسم المشروع/);

  assert.throws(() => {
    addTankerDelivery({ date: '2026-11-08', project: 'مشروع 1', liters: 0, amount: 200 });
  }, /يرجى إدخال كمية لترات/);

  assert.throws(() => {
    addTankerDelivery({ date: '2026-11-08', project: 'مشروع 1', liters: 100, amount: -50 });
  }, /يرجى إدخال إجمالي مبلغ/);
});

test('updateTankerDelivery updates fields and recalculates price per liter', () => {
  const currentId = state.data.tankerDeliveries[0].id;
  const updated = updateTankerDelivery(currentId, {
    liters: 600,
    amount: 1260.00,
    receiver: 'م/ إبراهيم'
  });

  assert.ok(updated, 'Update should return updated item');
  assert.strictEqual(updated.liters, 600);
  assert.strictEqual(updated.amount, 1260.00);
  assert.strictEqual(updated.receiver, 'م/ إبراهيم');
  assert.strictEqual(updated.pricePerLiter, 2.100);
});

test('deleteTankerDelivery removes delivery safely from state', () => {
  const currentId = state.data.tankerDeliveries[0].id;
  const success = deleteTankerDelivery(currentId);
  assert.strictEqual(success, true);
  assert.strictEqual(state.data.tankerDeliveries.length, 0);
});

test('New project names automatically get registered to master projectsList', () => {
  addTankerDelivery({
    date: '2026-11-08',
    project: 'مشروع برج المروة المخصص',
    liters: 200,
    amount: 420,
    receiver: 'م/ طارق'
  });

  assert.ok(state.data.projectsList.includes('مشروع برج المروة المخصص'), 'Project should be added to master list');
});

console.log('\n📌 CATEGORY 2: Mathematical Precision & Financial Invariants');

test('calculateTankerKpis maintains exact integer minor-unit arithmetic (zero floating-point error)', () => {
  state.data.tankerDeliveries = [];

  // Add 100 micro deliveries of 10.25 QAR
  for (let i = 0; i < 100; i++) {
    addTankerDelivery({
      date: '2026-11-08',
      project: 'مشروع لوسيل',
      liters: 5,
      amount: 10.25,
      receiver: 'سائق ' + i
    });
  }

  const kpis = calculateTankerKpis(state.data.tankerDeliveries);
  assert.strictEqual(kpis.totalLiters, 500); // 100 * 5
  assert.strictEqual(kpis.totalAmount, 1025.00); // exactly 1025.00 (100 * 10.25)
  assert.strictEqual(kpis.count, 100);
});

test('Weighted average price per liter is mathematically exact', () => {
  state.data.tankerDeliveries = [];
  // 100 liters @ 2.00 = 200
  // 200 liters @ 3.00 = 600
  // Total: 300 liters, 800 QAR => 800 / 300 = 2.666... => 2.67 QAR/L
  addTankerDelivery({ date: '2026-11-08', project: 'مشروع 1', liters: 100, amount: 200 });
  addTankerDelivery({ date: '2026-11-08', project: 'مشروع 2', liters: 200, amount: 600 });

  const kpis = calculateTankerKpis(state.data.tankerDeliveries);
  assert.strictEqual(kpis.totalLiters, 300);
  assert.strictEqual(kpis.totalAmount, 800.00);
  assert.strictEqual(kpis.avgPrice, 2.67);
});

test('Large enterprise volumes preserve strict minor-unit precision without overflow', () => {
  state.data.tankerDeliveries = [];
  addTankerDelivery({ date: '2026-11-08', project: 'مشروع البنية التحتية', liters: 50000, amount: 105000.75 });
  addTankerDelivery({ date: '2026-11-08', project: 'مشروع محطة الكهرباء', liters: 35000, amount: 73500.25 });

  const kpis = calculateTankerKpis(state.data.tankerDeliveries);
  assert.strictEqual(kpis.totalLiters, 85000);
  assert.strictEqual(kpis.totalAmount, 178501.00); // 105000.75 + 73500.25 = 178501.00 exactly
});

console.log('\n📌 CATEGORY 3: Project Cost Allocation & Percentage Distribution');

test('Project cost allocation correctly calculates liters, amounts, and percentages', () => {
  state.data.tankerDeliveries = [];
  // Project A: 600L (60%), 1200 QAR
  // Project B: 400L (40%), 800 QAR
  addTankerDelivery({ date: '2026-11-08', project: 'الموقع الشمالي', liters: 600, amount: 1200 });
  addTankerDelivery({ date: '2026-11-08', project: 'الموقع الجنوبي', liters: 400, amount: 800 });

  const kpis = calculateTankerKpis(state.data.tankerDeliveries);
  assert.strictEqual(kpis.projectsCount, 2);
  assert.strictEqual(kpis.projectsBreakdown.length, 2);

  const prjA = kpis.projectsBreakdown.find(p => p.project === 'الموقع الشمالي');
  const prjB = kpis.projectsBreakdown.find(p => p.project === 'الموقع الجنوبي');

  assert.strictEqual(prjA.liters, 600);
  assert.strictEqual(prjA.amount, 1200.00);
  assert.strictEqual(prjA.percentLiters, 60.0);
  assert.strictEqual(prjA.percentAmount, 60.0);

  assert.strictEqual(prjB.liters, 400);
  assert.strictEqual(prjB.amount, 800.00);
  assert.strictEqual(prjB.percentLiters, 40.0);
  assert.strictEqual(prjB.percentAmount, 40.0);
});

test('Projects breakdown list is strictly sorted by expenditure amount descending', () => {
  state.data.tankerDeliveries = [];
  addTankerDelivery({ date: '2026-11-08', project: 'مشروع صغير', liters: 100, amount: 200 });
  addTankerDelivery({ date: '2026-11-08', project: 'مشروع ضخم', liters: 1000, amount: 2200 });
  addTankerDelivery({ date: '2026-11-08', project: 'مشروع متوسط', liters: 500, amount: 1050 });

  const kpis = calculateTankerKpis(state.data.tankerDeliveries);
  assert.strictEqual(kpis.projectsBreakdown[0].project, 'مشروع ضخم');
  assert.strictEqual(kpis.projectsBreakdown[1].project, 'مشروع متوسط');
  assert.strictEqual(kpis.projectsBreakdown[2].project, 'مشروع صغير');
});

console.log('\n📌 CATEGORY 4: Period, Project & Search Filtering');

test('Period filter "current" strictly isolates deliveries belonging to active year and month', () => {
  state.data.tankerDeliveries = [];
  // Active period: 2026-11
  addTankerDelivery({ date: '2026-11-01', project: 'مشروع نوفمبر 1', liters: 100, amount: 200 });
  addTankerDelivery({ date: '2026-11-15', project: 'مشروع نوفمبر 2', liters: 200, amount: 400 });
  addTankerDelivery({ date: '2026-10-25', project: 'مشروع أكتوبر', liters: 300, amount: 600 });
  addTankerDelivery({ date: '2025-11-05', project: 'مشروع العام السابق', liters: 400, amount: 800 });

  const currentMonthDeliveries = getTankerDeliveries({ periodFilter: 'current' });
  assert.strictEqual(currentMonthDeliveries.length, 2);
  assert.ok(currentMonthDeliveries.every(d => d.date.startsWith('2026-11-')));
});

test('Period filter "year" isolates all deliveries in current calendar year regardless of month', () => {
  const yearDeliveries = getTankerDeliveries({ periodFilter: 'year' });
  assert.strictEqual(yearDeliveries.length, 3); // 2 from Nov + 1 from Oct 2026
  assert.ok(yearDeliveries.every(d => d.date.startsWith('2026-')));
});

test('Project filter isolates deliveries for specific project accurately', () => {
  const filtered = getTankerDeliveries({ periodFilter: 'year', projectFilter: 'مشروع أكتوبر' });
  assert.strictEqual(filtered.length, 1);
  assert.strictEqual(filtered[0].project, 'مشروع أكتوبر');
});

test('Search filter matches project, invoiceNo, receiver, and supplier case-insensitively', () => {
  state.data.tankerDeliveries = [];
  addTankerDelivery({
    date: '2026-11-08',
    project: 'موقع الوكرة السكني',
    liters: 100,
    amount: 210,
    invoiceNo: 'WOQ-9988',
    receiver: 'المهندس كريم',
    supplier: 'شركة الفنطاس الذهبي',
    notes: 'تفريغ طارئ'
  });

  assert.strictEqual(getTankerDeliveries({ search: 'وكرة' }).length, 1);
  assert.strictEqual(getTankerDeliveries({ search: '9988' }).length, 1);
  assert.strictEqual(getTankerDeliveries({ search: 'كريم' }).length, 1);
  assert.strictEqual(getTankerDeliveries({ search: 'الفنطاس' }).length, 1);
  assert.strictEqual(getTankerDeliveries({ search: 'طارئ' }).length, 1);
  assert.strictEqual(getTankerDeliveries({ search: 'غير_موجود' }).length, 0);
});

console.log('\n📌 CATEGORY 5: Corporate CSV Export & Security');

test('formatCsvCell sanitizes dangerous formula injection characters in project names and invoices', () => {
  assert.strictEqual(formatCsvCell('=1+1'), '"\'=1+1"');
  assert.strictEqual(formatCsvCell('+cmd|...'), '"\'+cmd|..."');
  assert.strictEqual(formatCsvCell('@SUM(A1:A10)'), '"\'@SUM(A1:A10)"');
  assert.strictEqual(formatCsvCell('-2+5'), '"\'-2+5"');
  assert.strictEqual(formatCsvCell('مشروع عادي'), '"مشروع عادي"');
});

console.log('\n📌 CATEGORY 6: Backup / Restore Resilience & Schema Versioning');

test('validateBackupPayload preserves tankerDeliveries array with complete sanitization', () => {
  const payload = {
    schemaVersion: 5,
    people: [{ id: 'p_1', num: 1, name: 'أحمد', role: 'driver' }],
    tankerDeliveries: [
      {
        id: 'tank_1',
        date: '2026-11-08',
        project: 'مشروع لوسيل',
        liters: 450,
        pricePerLiter: 2.1,
        amount: 945.00,
        invoiceNo: 'INV-101',
        receiver: 'م/ سعيد',
        supplier: 'وقود',
        notes: 'ملاحظة تجريبية'
      }
    ]
  };

  const validated = validateBackupPayload(payload);
  assert.strictEqual(validated.schemaVersion, 5);
  assert.ok(Array.isArray(validated.tankerDeliveries), 'Should have tankerDeliveries array');
  assert.strictEqual(validated.tankerDeliveries.length, 1);
  assert.strictEqual(validated.tankerDeliveries[0].project, 'مشروع لوسيل');
  assert.strictEqual(validated.tankerDeliveries[0].amount, 945.00);
});

test('validateBackupPayload handles legacy backups without tankerDeliveries gracefully (zero crash)', () => {
  const legacyPayload = {
    schemaVersion: 4,
    people: [{ id: 'p_1', num: 1, name: 'سائق قديم', role: 'driver' }]
  };

  const validated = validateBackupPayload(legacyPayload);
  assert.ok(Array.isArray(validated.tankerDeliveries), 'Should initialize empty tankerDeliveries');
  assert.strictEqual(validated.tankerDeliveries.length, 0);
  assert.ok(Array.isArray(validated.projectsList), 'Should initialize default projects list');
});

test('Duplicate tanker delivery IDs in backup are deduplicated automatically', () => {
  const payloadWithDuplicates = {
    schemaVersion: 5,
    people: [{ id: 'p_1', num: 1, name: 'سائق', role: 'driver' }],
    tankerDeliveries: [
      { id: 'tank_dup', date: '2026-11-08', project: 'مشروع 1', liters: 100, amount: 200 },
      { id: 'tank_dup', date: '2026-11-08', project: 'مشروع 2', liters: 150, amount: 300 }
    ]
  };

  const validated = validateBackupPayload(payloadWithDuplicates);
  assert.strictEqual(validated.tankerDeliveries.length, 1, 'Duplicate ID must be skipped');
  assert.strictEqual(validated.tankerDeliveries[0].project, 'مشروع 1');
});

console.log('\n📌 CATEGORY 7: Real-World Resilience & 3rd Voucher Visibility (Father Scenario)');

test('Entering 3 vouchers across different months all appear when periodFilter is "all"', () => {
  state.data = createCleanData();
  state.tankerPeriodFilter = 'all';
  state.tankerProjectFilter = 'all';
  state.tankerSearch = '';

  // Voucher 1: November
  addTankerDelivery({
    date: '2026-11-01',
    project: 'مشروع لوسيل',
    liters: 500,
    pricePerLiter: 2.10,
    amount: 1050,
    invoiceNo: 'INV-101'
  });

  // Voucher 2: November
  addTankerDelivery({
    date: '2026-11-05',
    project: 'موقع الدوحة الجديدة',
    liters: 300,
    pricePerLiter: 2.10,
    amount: 630,
    invoiceNo: 'INV-102'
  });

  // Voucher 3: October (Different month or late voucher)
  addTankerDelivery({
    date: '2026-10-28',
    project: 'مشروع الخور',
    liters: 400,
    pricePerLiter: 2.10,
    amount: 840,
    invoiceNo: 'INV-103'
  });

  const allVouchers = getTankerDeliveries({ periodFilter: 'all' });
  assert.strictEqual(allVouchers.length, 3, 'All 3 vouchers must be returned under "all" filter');

  const kpis = calculateTankerKpis(allVouchers);
  assert.strictEqual(kpis.count, 3, 'KPI count must be 3 vouchers');
  assert.strictEqual(kpis.totalLiters, 1200);
  assert.strictEqual(kpis.totalAmount, 2520.00);
});

test('Tanker deliveries persist 100% across saveState and loadState (browser reload)', () => {
  saveState();

  // Simulate complete page reload: clear in-memory state
  state.data = createCleanData();
  assert.strictEqual(state.data.tankerDeliveries.length, 0);

  // Reload state from storage
  loadState();

  assert.ok(Array.isArray(state.data.tankerDeliveries), 'tankerDeliveries must be an array');
  assert.strictEqual(state.data.tankerDeliveries.length, 3, 'All 3 vouchers must survive browser reload');
  assert.strictEqual(state.data.tankerDeliveries[0].invoiceNo, 'INV-101');
  assert.strictEqual(state.data.tankerDeliveries[1].invoiceNo, 'INV-102');
  assert.strictEqual(state.data.tankerDeliveries[2].invoiceNo, 'INV-103');
  assert.ok(state.data.projectsList.includes('مشروع الخور'), 'Projects list must be preserved');
});

test('addTankerDelivery auto-calculates amount when amount is omitted but liters is provided', () => {
  const delivery = addTankerDelivery({
    date: '2026-11-09',
    project: 'مشروع الريان',
    liters: 250,
    pricePerLiter: 2.100
  });

  assert.ok(delivery.id, 'Delivery should be created');
  assert.strictEqual(delivery.amount, 525.00, 'Amount must be auto-calculated (250 * 2.100)');
  assert.strictEqual(delivery.pricePerLiter, 2.100);
});

console.log('\n📌 CATEGORY 8: Projects Directory Management & Dual-Layer Emergency Persistence');

test('addProjectToMasterList successfully registers new project site and persists across reload', () => {
  const prj = addProjectToMasterList('مشروع جزيرة اللؤلؤة الجديد');
  assert.strictEqual(prj, 'مشروع جزيرة اللؤلؤة الجديد');
  assert.ok(state.data.projectsList.includes('مشروع جزيرة اللؤلؤة الجديد'));

  // Test reload
  state.data.projectsList = [];
  loadState();
  assert.ok(state.data.projectsList.includes('مشروع جزيرة اللؤلؤة الجديد'), 'Project must be restored on reload');
});

test('removeProjectFromMasterList safely removes unused project from directory', () => {
  const success = removeProjectFromMasterList('مشروع جزيرة اللؤلؤة الجديد');
  assert.strictEqual(success, true);
  assert.ok(!state.data.projectsList.includes('مشروع جزيرة اللؤلؤة الجديد'));
});

test('removeProjectFromMasterList blocks deleting project that has recorded deliveries', () => {
  assert.throws(() => {
    removeProjectFromMasterList('مشروع لوسيل'); // Has active delivery
  }, /لا يمكن حذف هذا المشروع لوجود بونات/);
  assert.ok(state.data.projectsList.includes('مشروع لوسيل'), 'Project must not be deleted');
});

test('Emergency fallback backup restores deliveries even if primary localStorage key is cleared', () => {
  // Ensure emergency key has data
  saveState();
  const emergencyKey = global.localStorage.getItem('petty_cash_tanker_deliveries_backup');
  assert.ok(emergencyKey && JSON.parse(emergencyKey).length > 0, 'Emergency backup key must be populated');

  // Corrupt / clear primary key to test recovery
  const primaryRaw = JSON.parse(global.localStorage.getItem('petty_cash_clean_v2'));
  primaryRaw.tankerDeliveries = []; // wiped out
  global.localStorage.setItem('petty_cash_clean_v2', JSON.stringify(primaryRaw));

  // Load state - should recover from emergency backup
  state.data.tankerDeliveries = [];
  loadState();

  assert.ok(state.data.tankerDeliveries.length > 0, 'Must recover tanker deliveries from emergency backup');
});

console.log('\n================================================================');
console.log(`🏁 TAB 9 TEST RESULTS: ${passed} / ${total} TESTS PASSED (100%)`);
console.log('✅ ALL TANKER DIESEL & PROJECT FUEL ALLOCATION TESTS SUCCEEDED!');
console.log('================================================================\n');
