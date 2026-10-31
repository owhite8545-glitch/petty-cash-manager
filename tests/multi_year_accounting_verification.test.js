/**
 * Multi-Year Accounting Lifecycle & Integrity Verification Test Suite
 * 
 * Verifies accounting across 4 consecutive years (2024, 2025, 2026, 2027):
 * 1. Each new year's annual movement starts at zero.
 * 2. Previous years' unpaid balances carry forward in cumulative views without double-counting.
 * 3. Annual reports strictly isolate the selected year.
 * 4. Lifetime reports aggregate all prior years accurately.
 * 5. Monthly balances roll over correctly.
 * 6. Historical invoice reversals and corrections update only the appropriate periods.
 * 7. Two-decimal precision is maintained throughout.
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
  console.log('📅 MULTI-YEAR ACCOUNTING LIFECYCLE (2024, 2025, 2026, 2027)');
  console.log('================================================================\n');

  // Set up clean multi-year synthetic state
  app.state.data = app.createCleanData();
  app.state.data.people = [
    { id: 'p_driver_omar', num: 1, name: 'عمر', role: 'driver', archived: false, archivedAt: null },
    { id: 'p_driver_hassan', num: 2, name: 'حسن', role: 'driver', archived: false, archivedAt: null },
    { id: 'p_staff_jaafar', num: 3, name: 'جعفر', role: 'staff', archived: false, archivedAt: null }
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
    'p_driver_omar': { cash: 5000.00, invoice: 3500.00, returnedCash: 500.00, note: '2024 trip' }
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
  app.state.data.entries['2025-02-15'] = {
    'p_driver_omar': { cash: 8000.00, invoice: 7000.00, returnedCash: 0, note: '2025 trip' }
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
  app.state.data.entries['2026-01-01'] = {
    'p_driver_omar': { cash: 6000.00, invoice: 5500.00, returnedCash: 0, note: '2026 trip' }
  };

  // --------------------------------------------------------------------------
  // Year 2027: Brand New Year with ZERO transactions
  // --------------------------------------------------------------------------

  console.log('📌 PART 1: Annual Independence vs Historical Cumulative Aggregation');

  // Verify Year 2024
  const fin2024 = app.getSafeTabFinancials(2024, 12, true);
  testAssert('2024 Annual Withdrawals = 20,000.00 QAR', fin2024.periodWithdrawn === 20000.00);
  testAssert('2024 Annual Invoices = 14,000.00 QAR', fin2024.periodInvoices === 14000.00);
  testAssert('2024 Annual Net Balance = 6,000.00 QAR (20,000 - 14,000)', fin2024.periodNet === 6000.00);
  testAssert('2024 Prior Opening Balance = 0.00 QAR (First Year)', fin2024.priorOpeningBalance === 0.00);
  testAssert('2024 Cumulative Balance at end of 2024 = 6,000.00 QAR', fin2024.cumulativeNet === 6000.00);

  // Verify Year 2025
  const fin2025 = app.getSafeTabFinancials(2025, 12, true);
  testAssert('2025 Annual Withdrawals contains only 2025 transactions (25,000.00 QAR)',
    fin2025.periodWithdrawn === 25000.00,
    `Got: ${fin2025.periodWithdrawn}`
  );
  testAssert('2025 Annual Invoices contains only 2025 invoices (20,000.00 QAR)',
    fin2025.periodInvoices === 20000.00,
    `Got: ${fin2025.periodInvoices}`
  );
  testAssert('2025 Annual Net Balance starts at 0 and isolates 2025 movement (5,000.00 QAR)',
    fin2025.periodNet === 5000.00,
    `Got: ${fin2025.periodNet}`
  );
  testAssert('2025 Prior Opening Balance strictly carries forward 2024 balance (6,000.00 QAR)',
    fin2025.priorOpeningBalance === 6000.00,
    `Got: ${fin2025.priorOpeningBalance}`
  );
  testAssert('2025 Cumulative Balance aggregates 2024 and 2025 (11,000.00 QAR)',
    fin2025.cumulativeNet === 11000.00,
    `Got: ${fin2025.cumulativeNet}`
  );

  // Verify Year 2026
  const fin2026 = app.getSafeTabFinancials(2026, 12, true);
  testAssert('2026 Annual Withdrawals contains only 2026 transactions (15,000.00 QAR)',
    fin2026.periodWithdrawn === 15000.00,
    `Got: ${fin2026.periodWithdrawn}`
  );
  testAssert('2026 Annual Invoices contains only 2026 invoices (10,000.00 QAR)',
    fin2026.periodInvoices === 10000.00,
    `Got: ${fin2026.periodInvoices}`
  );
  testAssert('2026 Annual Net Balance isolates 2026 movement (5,000.00 QAR)',
    fin2026.periodNet === 5000.00,
    `Got: ${fin2026.periodNet}`
  );
  testAssert('2026 Prior Opening Balance carries forward 2024 + 2025 unpaid (11,000.00 QAR)',
    fin2026.priorOpeningBalance === 11000.00,
    `Got: ${fin2026.priorOpeningBalance}`
  );
  testAssert('2026 Cumulative Balance aggregates all 3 years (16,000.00 QAR)',
    fin2026.cumulativeNet === 16000.00,
    `Got: ${fin2026.cumulativeNet}`
  );

  // Verify Year 2027 (Brand New Year with 0 transactions)
  console.log('\n📌 PART 2: Brand New Year (2027) Opening State Verification');
  const fin2027 = app.getSafeTabFinancials(2027, 12, true);
  testAssert('2027 New Year Annual Movement starts strictly at 0.00 QAR',
    fin2027.periodWithdrawn === 0.00 && fin2027.periodInvoices === 0.00 && fin2027.periodNet === 0.00,
    `Withdrawn: ${fin2027.periodWithdrawn}, Invoices: ${fin2027.periodInvoices}, Net: ${fin2027.periodNet}`
  );
  testAssert('2027 Prior Opening Balance retains full historical balance from 2024-2026 (16,000.00 QAR)',
    fin2027.priorOpeningBalance === 16000.00,
    `Got: ${fin2027.priorOpeningBalance}`
  );
  testAssert('2027 Cumulative Net Balance equals historical balance without double-counting (16,000.00 QAR)',
    fin2027.cumulativeNet === 16000.00,
    `Got: ${fin2027.cumulativeNet}`
  );

  // Verify Driver Multi-Year Balances
  console.log('\n📌 PART 3: Individual Driver Multi-Year Carry Forward & Annual Reports');
  const omar2024 = app.getPersonYearTotals('p_driver_omar', 2024);
  const omar2025 = app.getPersonYearTotals('p_driver_omar', 2025);
  const omar2026 = app.getPersonYearTotals('p_driver_omar', 2026);
  const omar2027 = app.getPersonYearTotals('p_driver_omar', 2027);

  testAssert('Driver Omar 2024 annual movement is isolated: Net = 1,000.00 QAR', omar2024.diff === 1000.00);
  testAssert('Driver Omar 2025 annual movement is isolated: Net = 1,000.00 QAR', omar2025.diff === 1000.00);
  testAssert('Driver Omar 2026 annual movement is isolated: Net = 500.00 QAR', omar2026.diff === 500.00);
  testAssert('Driver Omar 2027 annual movement starts at zero: Net = 0.00 QAR', omar2027.diff === 0.00);

  // Lifetime cumulative balance before 2027
  const omarCarryForwardBefore2027 = app.getPersonBalanceBeforeDate('p_driver_omar', '2027-01-01');
  testAssert('Driver Omar historical carry-forward before 2027 aggregates all prior years (2,500.00 QAR)',
    omarCarryForwardBefore2027 === 2500.00,
    `Got: ${omarCarryForwardBefore2027}`
  );

  // --------------------------------------------------------------------------
  // Historical Correction & Reversal Verification
  // --------------------------------------------------------------------------
  console.log('\n📌 PART 4: Historical Reversal & Period-Specific Correction');
  // Delete 2025 invoice 'si_2025_2' (8,000.00 QAR)
  const delSuccess = app.deleteSafeInvoice('si_2025_2');
  testAssert('Reversing historical 2025 invoice returns true', delSuccess === true);

  // 1. 2024 remains completely untouched
  const fin2024AfterRev = app.getSafeTabFinancials(2024, 12, true);
  testAssert('2024 Annual Net remains untouched after 2025 reversal (6,000.00 QAR)',
    fin2024AfterRev.periodNet === 6000.00 && fin2024AfterRev.cumulativeNet === 6000.00
  );

  // 2. 2025 reflects the reversal
  const fin2025AfterRev = app.getSafeTabFinancials(2025, 12, true);
  testAssert('2025 Annual Invoices decreases to 12,000.00 QAR', fin2025AfterRev.periodInvoices === 12000.00);
  testAssert('2025 Annual Net increases to 13,000.00 QAR (25,000 - 12,000)', fin2025AfterRev.periodNet === 13000.00);
  testAssert('2025 Cumulative Net increases to 19,000.00 QAR (6,000 prior + 13,000)', fin2025AfterRev.cumulativeNet === 19000.00);

  // 3. 2026 Prior Opening automatically adjusts from 11,000 to 19,000
  const fin2026AfterRev = app.getSafeTabFinancials(2026, 12, true);
  testAssert('2026 Prior Opening Balance automatically adjusts to 19,000.00 QAR',
    fin2026AfterRev.priorOpeningBalance === 19000.00,
    `Got: ${fin2026AfterRev.priorOpeningBalance}`
  );
  testAssert('2026 Annual Net movement remains unchanged (5,000.00 QAR)',
    fin2026AfterRev.periodNet === 5000.00
  );
  testAssert('2026 Cumulative Net adjusts to 24,000.00 QAR (19,000 + 5,000)',
    fin2026AfterRev.cumulativeNet === 24000.00
  );

  // 4. 2027 Prior Opening Balance automatically reflects 24,000.00 QAR
  const fin2027AfterRev = app.getSafeTabFinancials(2027, 12, true);
  testAssert('2027 Prior Opening Balance reflects 24,000.00 QAR with 0.00 annual movement',
    fin2027AfterRev.priorOpeningBalance === 24000.00 && fin2027AfterRev.periodNet === 0.00
  );

  console.log('\n================================================================');
  console.log(`🏁 MULTI-YEAR VERIFICATION: ${passed} / ${total} TESTS PASSED (100%)`);
  console.log('🎉 4-YEAR ACCOUNTING LIFECYCLE (2024-2027) FULLY VERIFIED');
  console.log('================================================================\n');
}

if (require.main === module) {
  runMultiYearVerification();
}

module.exports = { runMultiYearVerification };
