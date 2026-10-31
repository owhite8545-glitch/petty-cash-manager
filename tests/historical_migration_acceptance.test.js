/**
 * Real Historical Data Migration Acceptance Test
 * 
 * Verifies that the client's actual production data (petty_cash_backup_2026.json)
 * undergoes schema migration and accounting calculations with 100% financial fidelity.
 * 
 * Compares pre-migration raw numbers against post-migration application calculations down to 0.00 QAR.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const app = require('../app.js');

let total = 0;
let passed = 0;

function testAssert(name, condition, extraInfo = '') {
  total++;
  if (condition) {
    passed++;
    console.log(`  ✓ PASSED: [Migration Acceptance ${total}] ${name}`);
  } else {
    console.error(`  ❌ FAILED: [Migration Acceptance ${total}] ${name} ${extraInfo ? '(' + extraInfo + ')' : ''}`);
    throw new Error(`Assertion failed: ${name} (${extraInfo})`);
  }
}

function runHistoricalMigrationTest() {
  console.log('================================================================');
  console.log('🏛️  REAL HISTORICAL DATA MIGRATION ACCEPTANCE TEST');
  console.log('================================================================');

  const copyPath = path.join(__dirname, 'historical_production_copy.json');
  if (!fs.existsSync(copyPath)) {
    throw new Error(`Historical copy not found at: ${copyPath}`);
  }

  const rawJson = fs.readFileSync(copyPath, 'utf8');
  const rawData = JSON.parse(rawJson);

  console.log('\n[Phase 1] Pre-Migration Raw Data Analysis:');
  console.log(`  • Raw People Count: ${rawData.people.length}`);
  console.log(`  • Raw Daily Receipt Days: ${Object.keys(rawData.dailyReceipts || {}).length}`);
  console.log(`  • Raw Entries Days: ${Object.keys(rawData.entries || {}).length}`);

  // 1. Pre-Migration Baseline Calculation
  let preWithdrawals = 0;
  for (const amt of Object.values(rawData.dailyReceipts || {})) {
    preWithdrawals += Number(amt) || 0;
  }

  let preTotalCash = 0;
  let preTotalInvoices = 0;
  let preTotalReturned = 0;
  let preTxCount = 0;
  const prePersonBalances = {};
  for (const p of rawData.people) {
    prePersonBalances[p.id] = { name: p.name, role: p.role, cash: 0, invoice: 0, returned: 0, net: 0 };
  }

  for (const [dateKey, dayEntries] of Object.entries(rawData.entries || {})) {
    for (const [pid, entry] of Object.entries(dayEntries)) {
      preTxCount++;
      const c = Number(entry.cash) || 0;
      const inv = Number(entry.invoice) || 0;
      const ret = Number(entry.returnedCash) || 0;

      preTotalCash += c;
      preTotalInvoices += inv;
      preTotalReturned += ret;

      if (!prePersonBalances[pid]) {
        prePersonBalances[pid] = { name: `Unknown (${pid})`, role: 'unknown', cash: 0, invoice: 0, returned: 0, net: 0 };
      }
      prePersonBalances[pid].cash += c;
      prePersonBalances[pid].invoice += inv;
      prePersonBalances[pid].returned += ret;
      prePersonBalances[pid].net += (c - (inv + ret));
    }
  }

  console.log(`  • Pre-Migration Total Withdrawals: ${preWithdrawals.toFixed(2)} QAR`);
  console.log(`  • Pre-Migration Total Cash Distributed: ${preTotalCash.toFixed(2)} QAR`);
  console.log(`  • Pre-Migration Total Invoices Submitted: ${preTotalInvoices.toFixed(2)} QAR`);
  console.log(`  • Pre-Migration Historical Transaction Count: ${preTxCount}`);

  // 2. Execute Latest Application Migration & Validation
  console.log('\n[Phase 2] Executing Application Migration to Schema v5...');
  const migratedData = app.migrateLegacyData(rawData);
  const validatedData = app.validateBackupPayload(migratedData);

  testAssert('Schema version successfully upgraded to 5',
    validatedData.schemaVersion === 5,
    `Got: ${validatedData.schemaVersion}`
  );

  testAssert('All 5 original people preserved with original IDs and names',
    validatedData.people.length === 5 &&
    validatedData.people.some(p => p.name === 'منيع' && p.role === 'driver') &&
    validatedData.people.some(p => p.name === 'جعفر' && p.role === 'staff') &&
    validatedData.people.some(p => p.name === 'محمد' && p.role === 'staff') &&
    validatedData.people.some(p => p.name === 'عمر' && p.role === 'driver') &&
    validatedData.people.some(p => p.name === 'حسن' && p.role === 'driver')
  );

  testAssert('Every person has archived: false and archivedAt: null initialized',
    validatedData.people.every(p => p.archived === false && p.archivedAt === null)
  );

  // Load into application state to execute official accounting engines
  app.state.data = validatedData;
  app.state.year = 2026;
  app.state.month = 1;
  app.state.safeShowYear = false;

  console.log('\n[Phase 3] Post-Migration Financial Engine Verification:');

  // Verify Tab 7 Safe Financials
  const finMonth = app.getSafeTabFinancials(2026, 1, false);
  const finYear = app.getSafeTabFinancials(2026, 1, true);

  testAssert('Total company withdrawals match exactly (25,000.00 QAR)',
    finYear.periodWithdrawn === preWithdrawals && finYear.periodWithdrawn === 25000.00,
    `Pre: ${preWithdrawals}, Post: ${finYear.periodWithdrawn}`
  );

  testAssert('Monthly company withdrawals for Jan 2026 match (25,000.00 QAR)',
    finMonth.periodWithdrawn === 25000.00,
    `Got: ${finMonth.periodWithdrawn}`
  );

  testAssert('Safe invoices array initialized as empty array (0.00 QAR)',
    finYear.periodInvoices === 0 && finMonth.periodInvoices === 0
  );

  testAssert('Tab 7 Net Treasury Balance correctly reports 25,000.00 QAR un-settled cash',
    finMonth.periodNet === 25000.00 && finYear.cumulativeNet === 25000.00
  );

  // 3. Reconcile Every Driver and Employee Balance
  console.log('\n[Phase 4] Reconciling Every Driver and Employee Outstanding Balance:');
  
  let postTotalCash = 0;
  let postTotalInvoices = 0;
  let postTotalReturned = 0;

  for (const person of validatedData.people) {
    const pre = prePersonBalances[person.id];
    
    // Compute post totals using getPersonYearTotals
    const postYearTotals = app.getPersonYearTotals(person.id, 2026);
    postTotalCash += postYearTotals.cash;
    postTotalInvoices += postYearTotals.invoice;
    postTotalReturned += postYearTotals.returnedCash;

    testAssert(`[${person.role.toUpperCase()}] ${person.name} cash advances match to exact cent (${pre.cash.toFixed(2)} QAR)`,
      postYearTotals.cash === pre.cash,
      `Pre: ${pre.cash}, Post: ${postYearTotals.cash}`
    );

    testAssert(`[${person.role.toUpperCase()}] ${person.name} invoices match to exact cent (${pre.invoice.toFixed(2)} QAR)`,
      postYearTotals.invoice === pre.invoice,
      `Pre: ${pre.invoice}, Post: ${postYearTotals.invoice}`
    );

    testAssert(`[${person.role.toUpperCase()}] ${person.name} outstanding balance matches to exact cent (${pre.net.toFixed(2)} QAR)`,
      postYearTotals.diff === pre.net,
      `Pre: ${pre.net}, Post: ${postYearTotals.diff}`
    );
  }

  testAssert('Total Cash Distributed across all people matches exactly (30,200.00 QAR)',
    postTotalCash === preTotalCash && postTotalCash === 30200.00,
    `Pre: ${preTotalCash}, Post: ${postTotalCash}`
  );

  testAssert('Total Invoices Submitted across all people matches exactly (11,000.00 QAR)',
    postTotalInvoices === preTotalInvoices && postTotalInvoices === 11000.00,
    `Pre: ${preTotalInvoices}, Post: ${postTotalInvoices}`
  );

  testAssert('Driver fleet invoices vs Staff invoices separation is accurate (10,200.00 drivers, 800.00 staff)',
    app.calculateMonthDriverInvoices(2026, 1, 'driver') === 10200.00 &&
    app.calculateMonthDriverInvoices(2026, 1, 'staff') === 800.00
  );

  testAssert('Historical transaction counts match exactly (14 entry records across 3 days)',
    preTxCount === 14 && Object.keys(validatedData.entries).length === 3
  );

  // 4. Output Detailed Reconciliation Table
  console.log('\n================================================================');
  console.log('📋 HISTORICAL RECONCILIATION AUDIT TABLE');
  console.log('================================================================');
  console.log('| Metric / Person             | Role   | Pre-Migration | Post-Migration | Variance | Status |');
  console.log('|-----------------------------|--------|---------------|----------------|----------|--------|');
  console.log(`| Company Total Withdrawals   | System | 25,000.00 QAR | ${finYear.periodWithdrawn.toFixed(2).padStart(8, ' ')} QAR | 0.00 QAR | MATCH  |`);
  console.log(`| Total Distributed Cash      | System | 30,200.00 QAR | ${postTotalCash.toFixed(2).padStart(8, ' ')} QAR | 0.00 QAR | MATCH  |`);
  console.log(`| Total Invoices Submitted    | System | 11,000.00 QAR | ${postTotalInvoices.toFixed(2).padStart(8, ' ')} QAR | 0.00 QAR | MATCH  |`);
  console.log(`| Driver Fleet Invoices       | Driver | 10,200.00 QAR | 10,200.00 QAR  | 0.00 QAR | MATCH  |`);
  console.log(`| Staff Expenses Invoices     | Staff  |    800.00 QAR |    800.00 QAR  | 0.00 QAR | MATCH  |`);
  for (const p of validatedData.people) {
    const pre = prePersonBalances[p.id];
    const post = app.getPersonYearTotals(p.id, 2026);
    const varDiff = (post.diff - pre.net).toFixed(2);
    const roleStr = p.role === 'driver' ? 'Driver' : 'Staff ';
    console.log(`| ${p.name.padEnd(27, ' ')} | ${roleStr} | ${pre.net.toFixed(2).padStart(10, ' ')} QAR | ${post.diff.toFixed(2).padStart(11, ' ')} QAR | ${varDiff.padStart(5, ' ')} QAR | MATCH  |`);
  }
  console.log('================================================================\n');

  console.log(`🏁 RECONCILIATION SUMMARY: ${passed} / ${total} CHECKS PASSED (100%)`);
  console.log('🎉 REAL HISTORICAL DATA PRESERVED TO THE EXACT CENT WITH ZERO VARIANCE\n');
}

if (require.main === module) {
  runHistoricalMigrationTest();
}

module.exports = { runHistoricalMigrationTest };
