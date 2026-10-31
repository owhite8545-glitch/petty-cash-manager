/**
 * Multi-Year Accounting Lifecycle & Integrity Verification Test Suite
 * 
 * Verifies accounting across 4 consecutive years (2024, 2025, 2026, 2027):
 * 1. Treasury Annual Independence vs Historical Cumulative Balances.
 * 2. Monthly Carry-Forward across all months, including December-to-January transitions.
 * 3. Driver Fleet Multi-Year Independent Annual & Lifetime Accounting.
 * 4. Employee (Staff) Multi-Year Independent Annual & Lifetime Accounting.
 * 5. Reversal Mechanism: Auditable reversal (preserving invoice, date, reason) vs deletion.
 * 6. Two-decimal precision throughout.
 */

const assert = require('assert');
const app = require('../app.js');

let total = 0;
let passed = 0;

function testAssert(name, condition, extraInfo = '') {
  total++;
  if (condition) {
    passed++;
    console.log(`  ✓ PASSED: [Multi-Year Test ${total}] ${name}`);
  } else {
    console.error(`  ❌ FAILED: [Multi-Year Test ${total}] ${name} ${extraInfo ? '(' + extraInfo + ')' : ''}`);
    throw new Error(`Assertion failed: ${name} (${extraInfo})`);
  }
}

function runMultiYearVerification() {
  console.log('================================================================');
  console.log('📅 MULTI-YEAR & MULTI-MONTH ACCOUNTING LIFECYCLE (2024 - 2027)');
  console.log('================================================================\n');

  // Set up clean multi-year synthetic state
  app.state.data = app.createCleanData();
  app.state.data.people = [
    { id: 'p_driver_omar', num: 1, name: 'عمر', role: 'driver', archived: false, archivedAt: null },
    { id: 'p_driver_hassan', num: 2, name: 'حسن', role: 'driver', archived: false, archivedAt: null },
    { id: 'p_staff_jaafar', num: 3, name: 'جعفر', role: 'staff', archived: false, archivedAt: null },
    { id: 'p_staff_mohamed', num: 4, name: 'محمد', role: 'staff', archived: false, archivedAt: null }
  ];

  // --------------------------------------------------------------------------
  // Year 2024 Setup
  // --------------------------------------------------------------------------
  // Company Treasury: 20,000 withdrawn, 14,000 invoices submitted
  app.state.data.dailyReceipts['2024-05-10'] = 12000.00;
  app.state.data.dailyReceipts['2024-11-20'] = 8000.00;

  app.state.data.safeInvoices.push(
    { id: 'si_2024_1', date: '2024-06-01', amount: 10000.00, periodKey: '2024-06', ref: 'INV-2024-06' },
    { id: 'si_2024_2', date: '2024-12-15', amount: 4000.00, periodKey: '2024-12', ref: 'INV-2024-12' }
  );

  // Driver Omar in 2024: Cash 5,000, Invoice 3,500, Returned 500 -> 2024 Net = 1,000.00 QAR
  app.state.data.entries['2024-05-10'] = {
    'p_driver_omar': { cash: 5000.00, invoice: 3500.00, returnedCash: 500.00, note: '2024 trip' },
    'p_staff_jaafar': { cash: 3000.00, invoice: 2000.00, returnedCash: 0, note: '2024 supplies' }
  };

  // --------------------------------------------------------------------------
  // Year 2025 Setup
  // --------------------------------------------------------------------------
  // Company Treasury: 25,000 withdrawn, 20,000 invoices submitted
  app.state.data.dailyReceipts['2025-02-15'] = 15000.00;
  app.state.data.dailyReceipts['2025-08-10'] = 10000.00;

  app.state.data.safeInvoices.push(
    { id: 'si_2025_1', date: '2025-03-01', amount: 12000.00, periodKey: '2025-03', ref: 'INV-2025-03' },
    { id: 'si_2025_2', date: '2025-09-01', amount: 8000.00, periodKey: '2025-09', ref: 'INV-2025-09' }
  );

  // Driver Omar in 2025: Cash 8,000, Invoice 7,000, Returned 0 -> 2025 Net = 1,000.00 QAR
  // Employee Jaafar in 2025: Cash 4,000, Invoice 3,200, Returned 0 -> 2025 Net = 800.00 QAR
  app.state.data.entries['2025-02-15'] = {
    'p_driver_omar': { cash: 8000.00, invoice: 7000.00, returnedCash: 0, note: '2025 trip' },
    'p_staff_jaafar': { cash: 4000.00, invoice: 3200.00, returnedCash: 0, note: '2025 office maintenance' }
  };

  // --------------------------------------------------------------------------
  // Year 2026 Setup
  // --------------------------------------------------------------------------
  // Company Treasury: 15,000 withdrawn, 10,000 invoices submitted
  app.state.data.dailyReceipts['2026-01-01'] = 10000.00;
  app.state.data.dailyReceipts['2026-04-15'] = 5000.00;

  app.state.data.safeInvoices.push(
    { id: 'si_2026_1', date: '2026-01-20', amount: 10000.00, periodKey: '2026-01', ref: 'INV-2026-01' }
  );

  // Driver Omar in 2026: Cash 6,000, Invoice 5,500, Returned 0 -> 2026 Net = 500.00 QAR
  // Employee Jaafar in 2026: Cash 2,500, Invoice 2,100, Returned 0 -> 2026 Net = 400.00 QAR
  app.state.data.entries['2026-01-01'] = {
    'p_driver_omar': { cash: 6000.00, invoice: 5500.00, returnedCash: 0, note: '2026 trip' },
    'p_staff_jaafar': { cash: 2500.00, invoice: 2100.00, returnedCash: 0, note: '2026 hospitality' }
  };

  // --------------------------------------------------------------------------
  // Year 2027: Brand New Year with ZERO transactions
  // --------------------------------------------------------------------------

  // ==========================================================================
  // SECTION 1: Treasury Annual Independence vs Historical Cumulative
  // ==========================================================================
  console.log('📌 PART 1: Treasury Annual Independence vs Cumulative Aggregation');

  // Verify Year 2024
  const fin2024 = app.getSafeTabFinancials(2024, 12, true);
  testAssert('2024 Annual Withdrawals = 20,000.00 QAR', fin2024.periodWithdrawn === 20000.00);
  testAssert('2024 Annual Invoices = 14,000.00 QAR', fin2024.periodInvoices === 14000.00);
  testAssert('2024 Annual Net Balance = 6,000.00 QAR (20,000 - 14,000)', fin2024.periodNet === 6000.00);
  testAssert('2024 Prior Opening Balance = 0.00 QAR (First Year)', fin2024.priorOpeningBalance === 0.00);
  testAssert('2024 Cumulative Balance at end of 2024 = 6,000.00 QAR', fin2024.cumulativeNet === 6000.00);

  // Verify Year 2025
  const fin2025 = app.getSafeTabFinancials(2025, 12, true);
  testAssert('2025 Annual Withdrawals contains only 2025 transactions (25,000.00 QAR)', fin2025.periodWithdrawn === 25000.00);
  testAssert('2025 Annual Invoices contains only 2025 invoices (20,000.00 QAR)', fin2025.periodInvoices === 20000.00);
  testAssert('2025 Annual Net Balance starts at 0 and isolates 2025 movement (5,000.00 QAR)', fin2025.periodNet === 5000.00);
  testAssert('2025 Prior Opening Balance strictly carries forward 2024 balance (6,000.00 QAR)', fin2025.priorOpeningBalance === 6000.00);
  testAssert('2025 Cumulative Balance aggregates 2024 and 2025 (11,000.00 QAR)', fin2025.cumulativeNet === 11000.00);

  // Verify Year 2026
  const fin2026 = app.getSafeTabFinancials(2026, 12, true);
  testAssert('2026 Annual Withdrawals contains only 2026 transactions (15,000.00 QAR)', fin2026.periodWithdrawn === 15000.00);
  testAssert('2026 Annual Invoices contains only 2026 invoices (10,000.00 QAR)', fin2026.periodInvoices === 10000.00);
  testAssert('2026 Annual Net Balance isolates 2026 movement (5,000.00 QAR)', fin2026.periodNet === 5000.00);
  testAssert('2026 Prior Opening Balance carries forward 2024 + 2025 unpaid (11,000.00 QAR)', fin2026.priorOpeningBalance === 11000.00);
  testAssert('2026 Cumulative Balance aggregates all 3 years (16,000.00 QAR)', fin2026.cumulativeNet === 16000.00);

  // Verify Brand New Year 2027 Opening State
  const fin2027 = app.getSafeTabFinancials(2027, 12, true);
  testAssert('2027 New Year Annual Movement starts strictly at 0.00 QAR',
    fin2027.periodWithdrawn === 0.00 && fin2027.periodInvoices === 0.00 && fin2027.periodNet === 0.00
  );
  testAssert('2027 Prior Opening Balance retains full historical balance from 2024-2026 (16,000.00 QAR)',
    fin2027.priorOpeningBalance === 16000.00
  );
  testAssert('2027 Cumulative Net Balance equals historical balance without double-counting (16,000.00 QAR)',
    fin2027.cumulativeNet === 16000.00
  );

  // ==========================================================================
  // SECTION 2: Monthly Carry-Forward Sequences & Year Boundaries
  // ==========================================================================
  console.log('\n📌 PART 2: Monthly Carry-Forward & December-to-January Transitions');

  // Month 2024-11: Receipt 8,000.00
  const m2024_11 = app.getSafeTabFinancials(2024, 11, false);
  testAssert('2024-11 Prior Opening Balance carries forward previous months (2,000.00 QAR)', m2024_11.priorOpeningBalance === 2000.00);
  testAssert('2024-11 Month Net movement = 8,000.00 QAR', m2024_11.periodNet === 8000.00);
  testAssert('2024-11 Cumulative Net = 10,000.00 QAR (2,000 prior + 8,000)', m2024_11.cumulativeNet === 10000.00);

  // Month 2024-12: Invoice 4,000.00
  const m2024_12 = app.getSafeTabFinancials(2024, 12, false);
  testAssert('2024-12 Prior Opening Balance equals 2024-11 Cumulative (10,000.00 QAR)', m2024_12.priorOpeningBalance === 10000.00);
  testAssert('2024-12 Month Net movement = -4,000.00 QAR (0 receipts - 4000 invoice)', m2024_12.periodNet === -4000.00);
  testAssert('2024-12 Cumulative Net = 6,000.00 QAR (10,000 - 4,000)', m2024_12.cumulativeNet === 6000.00);

  // [CRITICAL TRANSITION] 2024-12 -> 2025-01 (December to January Rollover)
  const m2025_01 = app.getSafeTabFinancials(2025, 1, false);
  testAssert('2025-01 Prior Opening Balance carries forward December 2024 Cumulative (6,000.00 QAR)',
    m2025_01.priorOpeningBalance === 6000.00
  );
  testAssert('2025-01 Month Net movement starts at 0.00 QAR in the new year', m2025_01.periodNet === 0.00);
  testAssert('2025-01 Cumulative Net carries forward 6,000.00 QAR without distortion', m2025_01.cumulativeNet === 6000.00);

  // Month 2025-02: Receipt 15,000.00
  const m2025_02 = app.getSafeTabFinancials(2025, 2, false);
  testAssert('2025-02 Prior Opening Balance = 6,000.00 QAR', m2025_02.priorOpeningBalance === 6000.00);
  testAssert('2025-02 Month Net = 15,000.00 QAR', m2025_02.periodNet === 15000.00);
  testAssert('2025-02 Cumulative Net = 21,000.00 QAR', m2025_02.cumulativeNet === 21000.00);

  // Month 2025-03: Invoice 12,000.00
  const m2025_03 = app.getSafeTabFinancials(2025, 3, false);
  testAssert('2025-03 Prior Opening Balance = 21,000.00 QAR', m2025_03.priorOpeningBalance === 21000.00);
  testAssert('2025-03 Month Net = -12,000.00 QAR', m2025_03.periodNet === -12000.00);
  testAssert('2025-03 Cumulative Net = 9,000.00 QAR', m2025_03.cumulativeNet === 9000.00);

  // Month 2025-12: End of 2025
  const m2025_12 = app.getSafeTabFinancials(2025, 12, false);
  testAssert('2025-12 Cumulative Net = 11,000.00 QAR', m2025_12.cumulativeNet === 11000.00);

  // [CRITICAL TRANSITION] 2025-12 -> 2026-01 (Second Year Boundary Rollover)
  const m2026_01 = app.getSafeTabFinancials(2026, 1, false);
  testAssert('2026-01 Prior Opening Balance carries forward 2025-12 Cumulative (11,000.00 QAR)',
    m2026_01.priorOpeningBalance === 11000.00
  );
  testAssert('2026-01 Month Net movement isolates Jan 2026 (10,000 received - 10,000 invoice = 0.00 QAR)',
    m2026_01.periodNet === 0.00
  );
  testAssert('2026-01 Cumulative Net = 11,000.00 QAR', m2026_01.cumulativeNet === 11000.00);

  // [CRITICAL TRANSITION] 2026-12 -> 2027-01 (Third Year Boundary Rollover)
  const m2026_12 = app.getSafeTabFinancials(2026, 12, false);
  const m2027_01 = app.getSafeTabFinancials(2027, 1, false);
  testAssert('2026-12 Cumulative Net equals 16,000.00 QAR', m2026_12.cumulativeNet === 16000.00);
  testAssert('2027-01 Prior Opening Balance carries forward all prior years up to Dec 31, 2026 (16,000.00 QAR)',
    m2027_01.priorOpeningBalance === 16000.00
  );
  testAssert('2027-01 Month Net movement is 0.00 QAR', m2027_01.periodNet === 0.00);
  testAssert('2027-01 Cumulative Net equals 16,000.00 QAR', m2027_01.cumulativeNet === 16000.00);

  // ==========================================================================
  // SECTION 3: Driver Fleet Multi-Year Accounting
  // ==========================================================================
  console.log('\n📌 PART 3: Individual Driver Multi-Year Carry Forward & Annual Reports');
  const omar2024 = app.getPersonYearTotals('p_driver_omar', 2024);
  const omar2025 = app.getPersonYearTotals('p_driver_omar', 2025);
  const omar2026 = app.getPersonYearTotals('p_driver_omar', 2026);
  const omar2027 = app.getPersonYearTotals('p_driver_omar', 2027);

  testAssert('Driver Omar 2024 annual movement is isolated: Net = 1,000.00 QAR', omar2024.diff === 1000.00);
  testAssert('Driver Omar 2025 annual movement is isolated: Net = 1,000.00 QAR', omar2025.diff === 1000.00);
  testAssert('Driver Omar 2026 annual movement is isolated: Net = 500.00 QAR', omar2026.diff === 500.00);
  testAssert('Driver Omar 2027 annual movement starts at zero: Net = 0.00 QAR', omar2027.diff === 0.00);

  const omarCarryForwardBefore2027 = app.getPersonBalanceBeforeDate('p_driver_omar', '2027-01-01');
  testAssert('Driver Omar historical carry-forward before 2027 aggregates all prior years (2,500.00 QAR)',
    omarCarryForwardBefore2027 === 2500.00
  );

  // ==========================================================================
  // SECTION 4: Employee (Staff) Multi-Year Independent & Lifetime Accounting
  // ==========================================================================
  console.log('\n📌 PART 4: Employee (Staff) Multi-Year Independent & Lifetime Accounting');

  const jaafar2024 = app.getPersonYearTotals('p_staff_jaafar', 2024);
  const jaafar2025 = app.getPersonYearTotals('p_staff_jaafar', 2025);
  const jaafar2026 = app.getPersonYearTotals('p_staff_jaafar', 2026);
  const jaafar2027 = app.getPersonYearTotals('p_staff_jaafar', 2027);

  testAssert('Employee Jaafar 2024 annual net is isolated (1,000.00 QAR)', jaafar2024.diff === 1000.00);
  testAssert('Employee Jaafar 2025 annual net is isolated (800.00 QAR)', jaafar2025.diff === 800.00);
  testAssert('Employee Jaafar 2026 annual net is isolated (400.00 QAR)', jaafar2026.diff === 400.00);
  testAssert('Employee Jaafar 2027 brand new year net starts strictly at 0.00 QAR', jaafar2027.diff === 0.00);

  const jaafarCarryForwardBefore2027 = app.getPersonBalanceBeforeDate('p_staff_jaafar', '2027-01-01');
  testAssert('Employee Jaafar lifetime cumulative balance before 2027 aggregates all prior years (2,200.00 QAR)',
    jaafarCarryForwardBefore2027 === 2200.00
  );

  // Test employee with zero transactions (Mohamed)
  const mohamed2026 = app.getPersonYearTotals('p_staff_mohamed', 2026);
  const mohamedLifetime = app.getPersonBalanceBeforeDate('p_staff_mohamed', '2027-01-01');
  testAssert('Employee Mohamed with no entries has 0.00 annual and 0.00 lifetime balance',
    mohamed2026.diff === 0.00 && mohamedLifetime === 0.00
  );

  // ==========================================================================
  // SECTION 5: Historical Reversal Mechanism & Audit Trail
  // ==========================================================================
  console.log('\n📌 PART 5: Proper Invoice Reversal Mechanism & Audit Trail');

  // Test 1: Auditable Reversal via reverseSafeInvoice()
  const revSuccess = app.reverseSafeInvoice('si_2025_2', 'إلغاء فاتورة تسوية شهر 2025-09 بناء على تدقيق مالي');
  testAssert('reverseSafeInvoice() execution returns true', revSuccess === true);

  // Verify the original invoice is preserved in state (not vanished)
  const revInv = (app.state.data.safeInvoices || []).find(x => x.id === 'si_2025_2');
  testAssert('Reversed invoice remains preserved in safeInvoices array', !!revInv);
  testAssert('Reversed invoice status is flagged as reversed', revInv.status === 'reversed');
  testAssert('Reversed invoice has valid ISO reversal timestamp', !!revInv.reversedAt && !isNaN(Date.parse(revInv.reversedAt)));
  testAssert('Reversed invoice preserves original reversal reason', revInv.reversalReason === 'إلغاء فاتورة تسوية شهر 2025-09 بناء على تدقيق مالي');
  testAssert('Reversed invoice preserves original amount (8,000.00 QAR)', revInv.amount === 8000.00);

  // Verify financial totals automatically exclude the reversed invoice
  const fin2025AfterRev = app.getSafeTabFinancials(2025, 12, true);
  testAssert('2025 Annual Invoices decreases to 12,000.00 QAR after reversal', fin2025AfterRev.periodInvoices === 12000.00);
  testAssert('2025 Annual Net increases to 13,000.00 QAR (25,000 - 12,000)', fin2025AfterRev.periodNet === 13000.00);
  testAssert('2025 Cumulative Net increases to 19,000.00 QAR', fin2025AfterRev.cumulativeNet === 19000.00);

  // Verify 2026 Prior Opening automatically adjusts
  const fin2026AfterRev = app.getSafeTabFinancials(2026, 12, true);
  testAssert('2026 Prior Opening Balance automatically adjusts to 19,000.00 QAR', fin2026AfterRev.priorOpeningBalance === 19000.00);
  testAssert('2026 Cumulative Net adjusts to 24,000.00 QAR', fin2026AfterRev.cumulativeNet === 24000.00);

  // Verify Audit Trail in state.data.safeInvoicesAudit
  testAssert('safeInvoicesAudit trail records the reversal action',
    Array.isArray(app.state.data.safeInvoicesAudit) &&
    app.state.data.safeInvoicesAudit.some(a => a.action === 'reversed' && a.invoiceId === 'si_2025_2' && a.amount === 8000.00)
  );

  // Test 2: Deletion with Audit Trail Preservation via deleteSafeInvoice()
  const delSuccess = app.deleteSafeInvoice('si_2024_2', 'حذف فاتورة ملغاة نهائياً مع حفظ السجل');
  testAssert('deleteSafeInvoice() execution returns true', delSuccess === true);
  testAssert('Deleted invoice is removed from active safeInvoices array',
    !(app.state.data.safeInvoices || []).some(x => x.id === 'si_2024_2')
  );
  testAssert('safeInvoicesAudit trail records the deletion action with original payload snapshot',
    Array.isArray(app.state.data.safeInvoicesAudit) &&
    app.state.data.safeInvoicesAudit.some(a => a.action === 'deleted' && a.invoice && a.invoice.id === 'si_2024_2' && a.invoice.amount === 4000.00)
  );

  console.log('\n================================================================');
  console.log(`🏁 MULTI-YEAR & MULTI-MONTH VERIFICATION: ${passed} / ${total} TESTS PASSED (100%)`);
  console.log('🎉 4-YEAR ACCOUNTING, MONTHLY ROLLOVERS & AUDIT TRAIL FULLY VERIFIED');
  console.log('================================================================\n');
}

if (require.main === module) {
  runMultiYearVerification();
}

module.exports = { runMultiYearVerification };
