const assert = require('assert');
const fs = require('fs');
const path = require('path');
const app = require('../app.js');

console.log('================================================================');
console.log('🧪 NOV 12 RECONCILIATION & SMART WORKFLOW FEATURES TEST SUITE');
console.log('================================================================\n');

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✓ PASSED: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAILED: ${name}`);
    console.error(`     Error: ${err.message}`);
    failed++;
  }
}

// 1. Reproduce Dad's exact Nov 12, 2026 & Nov 1, 2026 scenarios
console.log('📌 CATEGORY 1: Daily Received vs Distributed Reconciliation (Nov 12 & Nov 1 Fix)');

runTest('[Test 1] Nov 12 Scenario: Received 42,000, Distributed 47,000, ReturnedCash 5,000 (#94 ملاحظات) -> remaining is -5,000 (NOT 0)', () => {
  const clean = app.createCleanData();
  clean.people = [
    { id: 'p_youssef', num: 82, name: 'يوسوف ديزل', role: 'driver', meta: '' },
    { id: 'p_notes', num: 94, name: 'ملاحظات', role: 'driver', meta: '' }
  ];
  clean.dailyReceipts['2026-11-12'] = 42000;
  clean.entries['2026-11-12'] = {
    p_youssef: { cash: 47000, invoice: 29299.5, returnedCash: 0, note: 'باقى حساب الفواتير' },
    p_notes: { cash: 0, invoice: 0, returnedCash: 5000, note: 'تم اخذ خمسة الاف من أ فهمى لتكملة الديزل سوف يتم اذضافتها عليا يوم السبت 14/11/2026' }
  };
  app.state.data = clean;

  const totals = app.getDayTotals('2026-11-12');
  assert.strictEqual(totals.received, 42000);
  assert.strictEqual(totals.distributed, 47000);
  assert.strictEqual(totals.totalOut, 47000);
  assert.strictEqual(totals.remaining, -5000, 'Expected remaining to be -5000 (Received 42,000 - Distributed 47,000)');
  assert.strictEqual(totals.returnedCashTotal, 5000);
  assert.strictEqual(totals.netRemainingWithReturned, 0);
  assert.strictEqual(totals.returnedCashItems.length, 1);
  assert.strictEqual(totals.returnedCashItems[0].name, 'ملاحظات');
  assert.strictEqual(totals.returnedCashItems[0].amount, 5000);
});

runTest('[Test 2] Nov 1 Scenario: Received 40,000, Distributed 40,000, ReturnedCash 41,419 -> remaining is 0 (matched)', () => {
  const clean = app.createCleanData();
  clean.people = [
    { id: 'p_youssef', num: 82, name: 'يوسوف ديزل', role: 'driver', meta: '' },
    { id: 'p_other', num: 1, name: 'سائق 1', role: 'driver', meta: '' }
  ];
  clean.dailyReceipts['2026-11-01'] = 40000;
  clean.entries['2026-11-01'] = {
    p_youssef: { cash: 16000, invoice: 0, returnedCash: 41419, note: 'عليه سابقا 15000 اذن له 10419' },
    p_other: { cash: 24000, invoice: 0, returnedCash: 0, note: '' }
  };
  app.state.data = clean;

  const totals = app.getDayTotals('2026-11-01');
  assert.strictEqual(totals.received, 40000);
  assert.strictEqual(totals.distributed, 40000);
  assert.strictEqual(totals.remaining, 0, 'Expected remaining to be 0 when Received == Distributed');
  assert.strictEqual(totals.returnedCashTotal, 41419);
  assert.strictEqual(totals.netRemainingWithReturned, 41419);
});

// 2. Smart Multi-Invoice Note Calculator (extractNoteMathSum)
console.log('\n📌 CATEGORY 2: Smart Multi-Invoice Note Calculator (extractNoteMathSum)');

runTest('[Test 3] Parses "عدد 2 فاتورة 7461 + 13230" -> 20,691 (ignores "عدد 2")', () => {
  const res = app.extractNoteMathSum('عدد 2 فاتورة 7461 + 13230');
  assert.ok(res, 'Should return a math result');
  assert.strictEqual(res.sum, 20691);
  assert.deepStrictEqual(res.terms, [7461, 13230]);
});

runTest('[Test 4] Parses "عدد 2 فاتورة م عادل 383 + علاء 221" -> 604', () => {
  const res = app.extractNoteMathSum('عدد 2 فاتورة م عادل 383 + علاء 221');
  assert.ok(res);
  assert.strictEqual(res.sum, 604);
  assert.deepStrictEqual(res.terms, [383, 221]);
});

runTest('[Test 5] Parses 6-invoice sum "326+721+777+860+674+900" -> 4,258', () => {
  const res = app.extractNoteMathSum('326+721+777+860+674+900');
  assert.ok(res);
  assert.strictEqual(res.sum, 4258);
  assert.strictEqual(res.terms.length, 6);
});

runTest('[Test 6] Ignores dates like 14/11/2026 when summing numbers in notes', () => {
  const res = app.extractNoteMathSum('فاتورة 500 + 150 بتاريخ 14/11/2026');
  assert.ok(res);
  assert.strictEqual(res.sum, 650);
  assert.deepStrictEqual(res.terms, [500, 150]);
});

runTest('[Test 7] Returns null for notes without "+" or with only a single number', () => {
  assert.strictEqual(app.extractNoteMathSum('بون واحد 500 ريال'), null);
  assert.strictEqual(app.extractNoteMathSum('تم اخذ خمسة الاف من أ فهمى'), null);
});

// 3. Tab 9 Enhanced Search (Date, Liters, Amount, Arabic Normalization)
console.log('\n📌 CATEGORY 3: Tab 9 Enhanced Search (Date, Liters, Amount & Arabic Normalization)');

runTest('[Test 8] getTankerDeliveries searches by date, liters, amount, and Arabic-normalized receiver', () => {
  app.state.data = app.createCleanData();
  app.addTankerDelivery({
    date: '2026-11-04',
    project: 'DUKHAN',
    liters: 4400,
    pricePerLiter: 2.25,
    amount: 9900,
    invoiceNo: '37435',
    receiver: 'أحمد خليل',
    supplier: 'جلف انيرجى تريدنغ'
  });
  app.addTankerDelivery({
    date: '2026-11-07',
    project: 'SIMISMA',
    liters: 3982,
    pricePerLiter: 2.25,
    amount: 8959.5,
    invoiceNo: '37563',
    receiver: 'عبد اللطيف',
    supplier: 'جلف انيرجى تريدنغ'
  });

  assert.strictEqual(app.getTankerDeliveries({ periodFilter: 'all', search: '2026-11-04' }).length, 1);
  assert.strictEqual(app.getTankerDeliveries({ periodFilter: 'all', search: '4400' }).length, 1);
  assert.strictEqual(app.getTankerDeliveries({ periodFilter: 'all', search: '8959.5' }).length, 1);
  assert.strictEqual(app.getTankerDeliveries({ periodFilter: 'all', search: 'احمد خليل' }).length, 1);
});

// 4. Live Verification Against Dad's Uploaded Backup (if present on disk)
const backupPath = 'c:\\Users\\PC\\Desktop\\petty_cash_backup_2026 (5).json';
if (fs.existsSync(backupPath)) {
  console.log('\n📌 CATEGORY 4: Live Verification Against Dad\'s Backup File (petty_cash_backup_2026 (5).json)');
  runTest('[Test 9] Full verification of 2026-11-12 (-5,000), 2026-11-01 (0), and Oct 26/27 (-1,500 / +1,500) on real backup', () => {
    const raw = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    const validated = app.validateBackupPayload(raw);
    app.state.data = validated;

    const nov12 = app.getDayTotals('2026-11-12');
    assert.strictEqual(nov12.received, 42000);
    assert.strictEqual(nov12.distributed, 47000);
    assert.strictEqual(nov12.remaining, -5000);
    assert.strictEqual(nov12.returnedCashTotal, 5000);
    assert.strictEqual(nov12.netRemainingWithReturned, 0);

    const oct26 = app.getDayTotals('2026-10-26');
    const oct27 = app.getDayTotals('2026-10-27');
    assert.strictEqual(oct26.remaining, -1500);
    assert.strictEqual(oct27.remaining, 1500);
    assert.strictEqual(oct26.remaining + oct27.remaining, 0, 'Oct 26 (-1,500) + Oct 27 (+1,500) net out to 0');

    const nov01 = app.getDayTotals('2026-11-01');
    assert.strictEqual(nov01.received, 40000);
    assert.strictEqual(nov01.distributed, 40000);
    assert.strictEqual(nov01.remaining, 0);
  });
}

console.log('\n================================================================');
console.log(`🏁 TEST RESULTS: ${passed} / ${passed + failed} TESTS PASSED`);
console.log('================================================================');
if (failed > 0) process.exit(1);
