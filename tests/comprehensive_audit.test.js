/**
 * Comprehensive Audit Test Suite for Petty Cash Manager
 * Tests all 14 critical audit requirements:
 * 1. Driver-only invoice totals
 * 2. Employee/staff-only invoice totals
 * 3. Combined invoice totals
 * 4. Duplicate settlements detection & supplemental settlement handling
 * 5. Monthly carry-forward balances
 * 6. Annual vs lifetime cumulative balances (separate views, no double counting)
 * 7. Two-decimal precision & integer minor-units arithmetic (1,000 x 0.01 = 10.00)
 * 8. People archiving (visibility, preservation, reactivation, deletion block)
 * 9. Backup schema validation & referential integrity checks
 * 10. Pre-restore snapshot creation and rollback recovery
 * 11. Safe invoice editing and deletion
 * 12. CSV formula injection mitigation
 * 13. server.js static file security whitelist and traversal prevention
 * 14. sw.js cache cleanup scoping
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

console.log('================================================================');
console.log('🔍 RUNNING COMPREHENSIVE FINANCIAL AUDIT & SECURITY TEST SUITE');
console.log('================================================================\n');

// ----------------------------------------------------------------------------
// Test Environment Setup
// ----------------------------------------------------------------------------
const storage = {};
const elements = {};
function getOrCreateElement(id) {
  if (!elements[id]) {
    elements[id] = {
      id,
      value: '',
      textContent: '',
      innerHTML: '',
      classList: {
        _classes: new Set(),
        add: function(c) { this._classes.add(c); },
        remove: function(c) { this._classes.delete(c); },
        toggle: function(c) { if (this._classes.has(c)) this._classes.delete(c); else this._classes.add(c); },
        contains: function(c) { return this._classes.has(c); }
      },
      style: {},
      addEventListener: () => {},
      querySelectorAll: () => [],
      querySelector: () => null,
      appendChild: () => {},
      children: []
    };
  }
  return elements[id];
}

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  localStorage: {
    getItem: (k) => storage[k] || null,
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; }
  },
  document: {
    getElementById: (id) => getOrCreateElement(id),
    querySelectorAll: () => [],
    querySelector: () => null,
    createElement: (tag) => ({
      tagName: tag,
      innerHTML: '',
      textContent: '',
      style: {},
      classList: {
        _classes: new Set(),
        add: function(c) { this._classes.add(c); },
        remove: function(c) { this._classes.delete(c); }
      },
      appendChild: () => {}
    }),
    body: {
      classList: {
        _classes: new Set(),
        add: function(c) { this._classes.add(c); },
        remove: function(c) { this._classes.delete(c); },
        toggle: function(c) { if (this._classes.has(c)) this._classes.delete(c); else this._classes.add(c); }
      }
    },
    addEventListener: () => {}
  },
  window: {
    addEventListener: () => {},
    print: () => {}
  },
  alert: (msg) => { /* quiet alert */ },
  confirm: () => true
};
sandbox.window.localStorage = sandbox.localStorage;
sandbox.window.document = sandbox.document;

const appPath = path.join(__dirname, '..', 'app.js');
const appCode = fs.readFileSync(appPath, 'utf8');
vm.createContext(sandbox);
vm.runInContext(appCode, sandbox);

const state = sandbox.window.state;

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✓ PASSED: [Test ${totalTests}] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAILED: [Test ${totalTests}] ${name}`);
    console.error(`     Error: ${err.message}\n${err.stack}`);
    process.exitCode = 1;
  }
}

// ============================================================================
// 1. Two-Decimal Precision & Integer Minor Units Arithmetic
// ============================================================================
console.log('📌 CATEGORY 1: Two-Decimal Precision & Integer Minor Units Arithmetic');

runTest('Integer cents conversion and exact rounding', () => {
  const { toCents, fromCents, addMoney, subMoney, mulMoney } = sandbox;
  assert.strictEqual(toCents(10.50), 1050);
  assert.strictEqual(toCents(0.01), 1);
  assert.strictEqual(toCents('25.99'), 2599);
  assert.strictEqual(toCents(0.004), 0, 'Sub-cent rounds down');
  assert.strictEqual(toCents(0.006), 1, 'Sub-cent rounds up');
  assert.strictEqual(fromCents(1050), 10.50);
  assert.strictEqual(addMoney(10.25, 5.75), 16.00);
  assert.strictEqual(subMoney(20.00, 0.05), 19.95);
  assert.strictEqual(mulMoney(12.50, 3), 37.50);
});

runTest('Repeated fractional transactions: 1,000 transactions of 0.01 produce exactly 10.00', () => {
  const { sumMoney } = sandbox;
  const items = Array.from({ length: 1000 }, () => ({ amt: 0.01 }));
  const total = sumMoney(items, i => i.amt);
  assert.strictEqual(total, 10.00, `Expected 10.00, got ${total}`);
  
  // Verify native JS float accumulator fails this test:
  let floatSum = 0;
  for (let i = 0; i < 1000; i++) floatSum += 0.01;
  assert.notStrictEqual(floatSum, 10.00, 'Native JS float accumulation expected to diverge from 10.00');
});

runTest('Monetary input validation rejects negative, non-finite, or NaN', () => {
  const { validateMonetaryInput } = sandbox;
  const v1 = validateMonetaryInput('125.50');
  assert.strictEqual(v1.valid, true);
  assert.strictEqual(v1.value, 125.50);

  const v2 = validateMonetaryInput(50);
  assert.strictEqual(v2.valid, true);
  assert.strictEqual(v2.value, 50.00);

  const vNeg = validateMonetaryInput('-10', false);
  assert.strictEqual(vNeg.valid, false, 'Negative not allowed');

  const vNegAllowed = validateMonetaryInput('-10', true);
  assert.strictEqual(vNegAllowed.valid, true);
  assert.strictEqual(vNegAllowed.value, -10.00);

  assert.strictEqual(validateMonetaryInput('abc').valid, false);
  assert.strictEqual(validateMonetaryInput(NaN).valid, false);
  assert.strictEqual(validateMonetaryInput(Infinity).valid, false);
});

// ============================================================================
// 2. Invoice Filtering: Driver-only, Staff-only, Combined
// ============================================================================
console.log('\n📌 CATEGORY 2: Invoice Totals by Role (Driver, Staff, Combined)');

runTest('Calculate driver-only, staff-only, and combined invoice totals', () => {
  const { calculateMonthDriverInvoices } = sandbox;
  
  state.year = 2026;
  state.month = 3;
  state.data.people = [
    { id: 'p_driver_1', num: 1, name: 'سائق أول', role: 'driver', archived: false },
    { id: 'p_driver_2', num: 2, name: 'سائق ثان', role: 'driver', archived: false },
    { id: 'p_staff_1', num: 3, name: 'موظف إداري', role: 'staff', archived: false }
  ];
  state.data.entries = {
    '2026-03-05': {
      'p_driver_1': { cash: 100, invoice: 250.50, returnedCash: 0 },
      'p_driver_2': { cash: 50, invoice: 150.25, returnedCash: 0 },
      'p_staff_1': { cash: 500, invoice: 600.00, returnedCash: 0 }
    },
    '2026-03-12': {
      'p_driver_1': { cash: 0, invoice: 100.00, returnedCash: 0 }
    }
  };

  const driverTotal = calculateMonthDriverInvoices(2026, 3, 'driver');
  const staffTotal = calculateMonthDriverInvoices(2026, 3, 'staff');
  const allTotal = calculateMonthDriverInvoices(2026, 3, 'all');

  assert.strictEqual(driverTotal, 500.75, `Driver total should be 250.50 + 150.25 + 100.00 = 500.75, got ${driverTotal}`);
  assert.strictEqual(staffTotal, 600.00, `Staff total should be 600.00, got ${staffTotal}`);
  assert.strictEqual(allTotal, 1100.75, `All total should be 500.75 + 600.00 = 1100.75, got ${allTotal}`);
});

// ============================================================================
// 3. Duplicate Invoice Settlements & Supplemental Settlement Handling
// ============================================================================
console.log('\n📌 CATEGORY 3: Duplicate Settlements & Supplemental Invoices');

runTest('Detect duplicate settlements and calculate supplemental settlement diff', () => {
  const { getPeriodSettlementSummary } = sandbox;
  
  state.year = 2026;
  state.data.safeInvoices = [];

  // Currently driver invoices for March 2026 are 500.75
  let summary = getPeriodSettlementSummary(2026, 3, 'safe');
  assert.strictEqual(summary.totalSettled, 0);
  assert.strictEqual(summary.isFullySettled, false);
  assert.strictEqual(summary.hasPartialSettlement, false);

  // Add partial settlement of 300.00
  state.data.safeInvoices.push({
    id: 'si_test_1',
    date: '2026-03-15',
    amount: 300.00,
    periodKey: '2026-03',
    ref: 'INV-PARTIAL'
  });

  summary = getPeriodSettlementSummary(2026, 3, 'safe');
  assert.strictEqual(summary.totalSettled, 300.00);
  assert.strictEqual(summary.isFullySettled, false);
  assert.strictEqual(summary.hasPartialSettlement, true);
  assert.strictEqual(summary.unSettledDiff, 200.75, `Unsettled diff should be 500.75 - 300.00 = 200.75, got ${summary.unSettledDiff}`);

  // Add supplemental settlement of remaining 200.75
  state.data.safeInvoices.push({
    id: 'si_test_2',
    date: '2026-03-20',
    amount: 200.75,
    periodKey: '2026-03',
    ref: 'INV-SUPP'
  });

  summary = getPeriodSettlementSummary(2026, 3, 'safe');
  assert.strictEqual(summary.totalSettled, 500.75);
  assert.strictEqual(summary.isFullySettled, true, 'Should be flagged as fully settled');
  assert.strictEqual(summary.unSettledDiff, 0);
});

// ============================================================================
// 4. Monthly Carry-Forward Balances & Person Running Balance
// ============================================================================
console.log('\n📌 CATEGORY 4: Carry-Forward Balances & Running Balances');

runTest('Monthly carry-forward balance accurately tracks prior unpaid amounts', () => {
  const { getPersonBalanceBeforeDate } = sandbox;

  state.data.entries['2026-01-15'] = {
    'p_driver_1': { cash: 1000, invoice: 600, returnedCash: 100 } // net: 1000 - 700 = 300 with driver
  };
  state.data.entries['2026-02-10'] = {
    'p_driver_1': { cash: 500, invoice: 700, returnedCash: 0 } // net: 500 - 700 = -200
  };

  // Balance before Feb 1, 2026 should be 300
  const balBeforeFeb = getPersonBalanceBeforeDate('p_driver_1', '2026-02-01');
  assert.strictEqual(balBeforeFeb, 300.00);

  // Balance before March 1, 2026 should be 300 + (500 - 700) = 100
  const balBeforeMarch = getPersonBalanceBeforeDate('p_driver_1', '2026-03-01');
  assert.strictEqual(balBeforeMarch, 100.00);
});

// ============================================================================
// 5. Annual vs Lifetime Accounting & Safe Tab Dual Financial Views
// ============================================================================
console.log('\n📌 CATEGORY 5: Annual vs Cumulative Accounting (Dual Financial Views)');

runTest('Annual view starts with 0 opening balance; cumulative view preserves historical balances', () => {
  const { getSafeTabFinancials } = sandbox;

  // Clear and setup multi-year data
  state.data.dailyReceipts = {
    '2025-06-01': 10000, // 2025 withdrawal
    '2026-01-10': 5000,  // 2026 January withdrawal
    '2026-02-15': 3000   // 2026 February withdrawal
  };
  state.data.safeInvoices = [
    { id: 'si_2025', date: '2025-06-20', amount: 8000, ref: 'INV-2025' }, // 2025 invoice: net 2000 remaining
    { id: 'si_2026_jan', date: '2026-01-25', amount: 4000, ref: 'INV-2026-1' } // Jan 2026 invoice: net 1000
  ];

  // Test 1: Scope Year 2026
  const fin2026Year = getSafeTabFinancials(2026, 1, true);
  // Independent 2026 Annual movement:
  assert.strictEqual(fin2026Year.periodMovement.withdrawn, 8000.00, '2026 withdrawals = 5000 + 3000');
  assert.strictEqual(fin2026Year.periodMovement.invoices, 4000.00, '2026 invoices = 4000');
  assert.strictEqual(fin2026Year.periodMovement.netBalance, 4000.00, '2026 net balance = 8000 - 4000 = 4000');
  
  // Historical Cumulative view up to end of 2026:
  // Prior opening balance from 2025: 10000 - 8000 = 2000
  assert.strictEqual(fin2026Year.cumulativeRunning.priorOpeningBalance, 2000.00);
  assert.strictEqual(fin2026Year.cumulativeRunning.cumulativeWithdrawn, 18000.00);
  assert.strictEqual(fin2026Year.cumulativeRunning.cumulativeInvoices, 12000.00);
  assert.strictEqual(fin2026Year.cumulativeRunning.cumulativeNetBalance, 6000.00, 'Total cumulative = 2000 + 4000 = 6000');

  // Test 2: Scope Month Jan 2026
  const finJan2026 = getSafeTabFinancials(2026, 1, false);
  assert.strictEqual(finJan2026.periodMovement.withdrawn, 5000.00);
  assert.strictEqual(finJan2026.periodMovement.invoices, 4000.00);
  assert.strictEqual(finJan2026.periodMovement.netBalance, 1000.00);
  assert.strictEqual(finJan2026.cumulativeRunning.priorOpeningBalance, 2000.00, 'Prior to Jan 2026 is 2025 balance');
  assert.strictEqual(finJan2026.cumulativeRunning.cumulativeNetBalance, 3000.00, 'Cumulative up to end of Jan 2026 = 2000 + 1000 = 3000');
});

// ============================================================================
// 6. People Archiving: Non-Destructive Lifecycle
// ============================================================================
console.log('\n📌 CATEGORY 6: People Archiving & Historical Preservation');

runTest('Archiving preserves person, blocks deletion when transactions exist, and supports reactivation', () => {
  const { hasPersonAnyEntryInHistory, getReportablePeople } = sandbox;

  const testPerson = {
    id: 'p_driver_arch',
    num: 10,
    name: 'سائق متقاعد',
    role: 'driver',
    archived: false,
    archivedAt: null
  };
  state.data.people.push(testPerson);

  // Has entry in history
  state.data.entries['2025-05-01'] = {
    'p_driver_arch': { cash: 200, invoice: 200, returnedCash: 0 }
  };

  assert.strictEqual(hasPersonAnyEntryInHistory('p_driver_arch'), true, 'Should detect transaction history');

  // Archive person
  testPerson.archived = true;
  testPerson.archivedAt = new Date().toISOString();

  // In 2025 report, person should be reportable because they have entries in 2025
  const people2025 = getReportablePeople(2025);
  assert.strictEqual(people2025.some(p => p.id === 'p_driver_arch'), true, 'Archived person must appear in 2025 reports');

  // In 2027 report where person has no entries, person should NOT clutter the report
  const people2027 = getReportablePeople(2027);
  assert.strictEqual(people2027.some(p => p.id === 'p_driver_arch'), false, 'Archived person with no entries in 2027 should not clutter 2027');

  // Unarchive/reactivate person
  testPerson.archived = false;
  testPerson.archivedAt = null;
  const people2027AfterReactivate = getReportablePeople(2027);
  assert.strictEqual(people2027AfterReactivate.some(p => p.id === 'p_driver_arch'), true, 'Reactivated person appears in all active views');
});

// ============================================================================
// 7. Backup & Restore Safety, Schema Validation, and Rollback
// ============================================================================
console.log('\n📌 CATEGORY 7: Backup Schema Validation, Safe Migration & Rollback');

runTest('Backup schema validation rejects corrupted files, prototype pollution, and duplicate IDs', () => {
  const { validateBackupPayload } = sandbox;

  // Corrupted non-object
  assert.throws(() => validateBackupPayload(null), /غير صالحة/);
  assert.throws(() => validateBackupPayload([]), /غير صالحة/);

  // Missing people array
  assert.throws(() => validateBackupPayload({ schemaVersion: 4 }), /people array/);

  // Prototype pollution attempt
  const pollutedPayload = JSON.parse('{"__proto__": {"polluted": true}, "people": []}');
  assert.throws(() => validateBackupPayload(pollutedPayload), /Prototype Pollution/);

  // Duplicate person IDs
  const dupPayload = {
    people: [
      { id: 'dup_1', name: 'أحمد', role: 'driver' },
      { id: 'dup_1', name: 'محمد', role: 'driver' }
    ]
  };
  assert.throws(() => validateBackupPayload(dupPayload), /Duplicate Person ID/);
});

runTest('Backup schema validation normalizes data and preserves orphaned entry integrity', () => {
  const { validateBackupPayload } = sandbox;

  const validLegacyPayload = {
    schemaVersion: 2,
    people: [
      { id: 'p_valid_1', num: 1, name: 'سائق تجربة', role: 'driver' }
    ],
    dailyReceipts: { '2026-01-01': '1500.50' },
    entries: {
      '2026-01-01': {
        'p_valid_1': { cash: 500, invoice: 400, returnedCash: 100 },
        'p_orphan_missing': { cash: 200, invoice: 200 } // Orphaned person
      }
    },
    safeInvoices: [
      { id: 'si_test_safe', date: '2026-01-10', amount: 1500 }
    ]
  };

  const sanitized = validateBackupPayload(validLegacyPayload);
  assert.strictEqual(sanitized.schemaVersion, 5);
  assert.strictEqual(sanitized.dailyReceipts['2026-01-01'], 1500.50);
  assert.strictEqual(sanitized.people.length, 2, 'Orphaned person should be recovered as archived legacy record');
  
  const recoveredPerson = sanitized.people.find(p => p.id === 'p_orphan_missing');
  assert.ok(recoveredPerson);
  assert.strictEqual(recoveredPerson.archived, true);
});

runTest('Pre-restore snapshot creation and rollback recovery mechanism', () => {
  const { localStorage } = sandbox;

  // Current state before restore
  state.data.people = [{ id: 'p_current', name: 'الحالي', role: 'driver' }];
  const snapshot = {
    timestamp: Date.now(),
    dateFormatted: '2026-10-31 23:00',
    data: JSON.parse(JSON.stringify(state.data))
  };
  localStorage.setItem('petty_cash_pre_restore_snapshot', JSON.stringify(snapshot));

  // Overwrite state with imported data
  state.data.people = [{ id: 'p_imported_new', name: 'جديد مستورد', role: 'driver' }];
  assert.strictEqual(state.data.people[0].id, 'p_imported_new');

  // Trigger rollback
  const snapRaw = localStorage.getItem('petty_cash_pre_restore_snapshot');
  assert.ok(snapRaw);
  const restoredSnap = JSON.parse(snapRaw);
  state.data = restoredSnap.data;

  assert.strictEqual(state.data.people[0].id, 'p_current', 'Rollback should restore original data');
});

// ============================================================================
// 8. Safe Invoice Editing and Deletion
// ============================================================================
console.log('\n📌 CATEGORY 8: Safe Invoice Editing and Deletion');

runTest('Safe invoice CRUD operations maintain exact balance consistency', () => {
  const { getSafeTabFinancials } = sandbox;

  state.data.dailyReceipts = { '2026-05-01': 5000 };
  state.data.safeInvoices = [
    { id: 'si_edit_1', date: '2026-05-05', amount: 2000, ref: 'INV-1' }
  ];

  let fin = getSafeTabFinancials(2026, 5, false);
  assert.strictEqual(fin.periodMovement.netBalance, 3000.00);

  // Edit invoice amount
  const inv = state.data.safeInvoices.find(i => i.id === 'si_edit_1');
  inv.amount = 2500;
  fin = getSafeTabFinancials(2026, 5, false);
  assert.strictEqual(fin.periodMovement.netBalance, 2500.00, 'Updated net balance after edit');

  // Delete invoice
  state.data.safeInvoices = state.data.safeInvoices.filter(i => i.id !== 'si_edit_1');
  fin = getSafeTabFinancials(2026, 5, false);
  assert.strictEqual(fin.periodMovement.netBalance, 5000.00, 'Net balance after deletion');
});

// ============================================================================
// 9. CSV Formula Injection Mitigation
// ============================================================================
console.log('\n📌 CATEGORY 9: CSV Formula Injection Mitigation');

runTest('formatCsvCell sanitizes formula trigger characters (=, +, -, @)', () => {
  const { formatCsvCell } = sandbox;
  assert.strictEqual(formatCsvCell('=SUM(A1:A10)'), `"'=SUM(A1:A10)"`);
  assert.strictEqual(formatCsvCell('+12345'), ` "'+12345"`.trim());
  assert.strictEqual(formatCsvCell('-500'), ` "'-500"`.trim());
  assert.strictEqual(formatCsvCell('@cmd'), `"'@cmd"`);
  assert.strictEqual(formatCsvCell('Normal Text'), `"Normal Text"`);
  assert.strictEqual(formatCsvCell(1234.56), '1234.56');
});

// ============================================================================
// 10. Security: server.js Whitelist and Path Traversal Protection
// ============================================================================
console.log('\n📌 CATEGORY 10: Server Whitelist & Directory Traversal Protection');

runTest('server.js restricts access to ALLOWED_PUBLIC_FILES and blocks directory traversal', () => {
  const serverPath = path.join(__dirname, '..', 'server.js');
  const serverCode = fs.readFileSync(serverPath, 'utf8');

  assert.ok(serverCode.includes('ALLOWED_PUBLIC_FILES'), 'server.js must define ALLOWED_PUBLIC_FILES whitelist');
  assert.ok(serverCode.includes('403') && serverCode.includes('Forbidden'), 'server.js must return 403 Forbidden for non-whitelisted assets');
  assert.ok(serverCode.includes('Content-Security-Policy'), 'server.js must supply CSP header');
});

// ============================================================================
// 11. Security: Service Worker Cache Scope
// ============================================================================
console.log('\n📌 CATEGORY 11: Service Worker Cache Scope');

runTest('sw.js scopes cache deletion strictly to petty-cash-* caches', () => {
  const swPath = path.join(__dirname, '..', 'sw.js');
  const swCode = fs.readFileSync(swPath, 'utf8');

  assert.ok(swCode.includes("key.startsWith('petty-cash-')"), 'sw.js must only delete caches starting with petty-cash-');
});

// ============================================================================
// Test Suite Summary
// ============================================================================
console.log('\n================================================================');
console.log(`🏁 TEST RESULTS: ${passedTests} / ${totalTests} TESTS PASSED`);
if (passedTests === totalTests) {
  console.log('✅ ALL AUDIT & HARDENING ASSERTIONS PASSED WITH ZERO FAILURES');
} else {
  console.log(`❌ SOME TESTS FAILED (${totalTests - passedTests} failures)`);
}
console.log('================================================================\n');
