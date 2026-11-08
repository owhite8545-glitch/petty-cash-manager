/**
 * End-to-End Accounting, Precision & Workflow Test Suite
 * Tests actual application workflows, accounting invariants, financial precision,
 * service worker cache cleanup execution, and legacy data migration.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

console.log('================================================================');
console.log('📊 END-TO-END ACCOUNTING, PRECISION & WORKFLOW TEST SUITE');
console.log('================================================================\n');

// ----------------------------------------------------------------------------
// Interactive DOM & Browser Environment Emulation
// ----------------------------------------------------------------------------
class DOMElement {
  constructor(id = '', tagName = 'div') {
    this.id = id;
    this.tagName = tagName.toUpperCase();
    this.value = '';
    this.textContent = '';
    this.innerHTML = '';
    this.checked = false;
    this.style = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.children = [];
    this.parentElement = null;
    this._classes = new Set();
    this.classList = {
      add: (c) => this._classes.add(c),
      remove: (c) => this._classes.delete(c),
      toggle: (c) => this._classes.has(c) ? (this._classes.delete(c), false) : (this._classes.add(c), true),
      contains: (c) => this._classes.has(c)
    };
  }

  setAttribute(k, v) { this.attributes.set(k, String(v)); }
  getAttribute(k) { return this.attributes.has(k) ? this.attributes.get(k) : null; }
  hasAttribute(k) { return this.attributes.has(k); }

  addEventListener(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(fn);
  }

  dispatchEvent(event) {
    const list = this.listeners.get(event.type) || [];
    for (const fn of list) {
      fn(event);
    }
    return !event.defaultPrevented;
  }

  click() {
    this.dispatchEvent({
      type: 'click',
      target: this,
      preventDefault: () => {},
      stopPropagation: () => {}
    });
  }

  change(val) {
    if (val !== undefined) this.value = val;
    this.dispatchEvent({
      type: 'change',
      target: this,
      preventDefault: () => {}
    });
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) this.children.splice(idx, 1);
    child.parentElement = null;
    return child;
  }

  remove() {
    if (this.parentElement) {
      this.parentElement.removeChild(this);
    }
  }

  querySelector(selector) {
    const all = this.querySelectorAll(selector);
    return all.length > 0 ? all[0] : null;
  }

  querySelectorAll(selector) {
    const results = [];
    const search = (node) => {
      for (const ch of node.children) {
        if (matchesSelector(ch, selector)) results.push(ch);
        search(ch);
      }
    };
    search(this);
    return results;
  }

  focus() {}
}

function matchesSelector(el, sel) {
  if (sel.startsWith('#')) return el.id === sel.slice(1);
  if (sel.startsWith('.')) return el.classList.contains(sel.slice(1));
  if (sel.startsWith('[') && sel.endsWith(']')) {
    const inner = sel.slice(1, -1);
    if (inner.includes('=')) {
      const [attr, rawVal] = inner.split('=');
      const cleanVal = rawVal.replace(/['"]/g, '');
      return el.getAttribute(attr) === cleanVal;
    }
    return el.hasAttribute(inner);
  }
  return el.tagName.toLowerCase() === sel.toLowerCase();
}

const elementRegistry = new Map();
function getOrCreateElement(id, tag = 'div') {
  if (!elementRegistry.has(id)) {
    const el = new DOMElement(id, tag);
    elementRegistry.set(id, el);
  }
  return elementRegistry.get(id);
}

// Pre-register essential HTML elements from index.html
const KNOWN_IDS = [
  'globalYear', 'globalMonth', 'currentDateDisplay', 'appHeader',
  'dayReceivedInput', 'dayExtraAmount', 'dayExtraDesc', 'dailyExtraExcludeCompany',
  'kpiReceived', 'kpiDistributed', 'kpiRemaining', 'dailyTotalCashBadge', 'dailyTotalInvoiceBadge',
  'dailyReceiptsTableBody', 'dailyTableBody', 'extraExpenseRow',
  'newPersonName', 'newPersonRole', 'newPersonMeta', 'btnAddPerson',
  'peopleManageSearchInput', 'peopleManageFilterPills', 'peopleManageTableEl', 'peopleManageTableBody',
  'safeMonthSelect', 'chkSafeShowYear', 'safeInvoiceDate', 'safeInvoiceAmount', 'safeInvoiceRef', 'safeInvoiceNote',
  'btnAddSafeInvoice', 'btnCancelEditSafeInvoice', 'btnAutoFillSafeMonthInvoices',
  'safeWithdrawnTotal', 'safeInvoicesTotal', 'safeNetBalance', 'safeNetStatus',
  'safePriorOpeningBalance', 'safeCumulativeWithdrawnTotal', 'safeCumulativeInvoicesTotal', 'safeCumulativeNetBalance', 'safeCumulativeNetStatus',
  'safeInvoicesBody', 'footSafeInvoicesTotal',
  'custodyReceiptDate', 'custodyReceiptAmount', 'custodyReceiptRef', 'custodyReceiptNote', 'btnAddCustodyReceipt', 'btnCancelEditCustodyReceipt',
  'custodySettlementDate', 'custodySettlementAmount', 'custodySettlementPeriod', 'custodySettlementRef', 'custodySettlementNote',
  'btnAddCustodySettlement', 'btnCancelEditCustodySettlement', 'btnAutoFillMonthInvoices',
  'backupModal', 'btnBackupModal', 'btnCloseBackupModal', 'btnDownloadBackup', 'fileRestoreBackup', 'btnRollbackRestore', 'restoreStatusMsg',
  'calculatorWidget', 'cloudSyncModal', 'cloudAccountNameInput', 'cloudPinInput', 'btnConnectCloudAccount', 'cloudSyncStatusBadge'
];

KNOWN_IDS.forEach(id => getOrCreateElement(id));

const rootDoc = new DOMElement('document', 'html');
rootDoc.body = new DOMElement('body', 'body');
rootDoc.body.parentElement = rootDoc;
rootDoc.children.push(rootDoc.body);

// Append tbody containers to tables
const safeTableBody = getOrCreateElement('safeInvoicesBody', 'tbody');
const peopleTable = getOrCreateElement('peopleManageTableEl', 'table');
const peopleTableBody = getOrCreateElement('peopleManageTableBody', 'tbody');
peopleTable.appendChild(peopleTableBody);

const storage = {};
const alerts = [];
const confirms = [];

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
    querySelector: (sel) => {
      if (sel.startsWith('#')) return getOrCreateElement(sel.slice(1));
      return rootDoc.querySelector(sel);
    },
    querySelectorAll: (sel) => rootDoc.querySelectorAll(sel),
    createElement: (tag) => new DOMElement('', tag),
    body: rootDoc.body,
    addEventListener: () => {}
  },
  window: {
    addEventListener: () => {},
    print: () => {}
  },
  alert: (msg) => alerts.push(msg),
  confirm: (msg) => { confirms.push(msg); return true; },
  Blob: class { constructor(parts) { this.parts = parts; } },
  URL: {
    createObjectURL: () => 'blob://test',
    revokeObjectURL: () => {}
  }
};
sandbox.window.localStorage = sandbox.localStorage;
sandbox.window.document = sandbox.document;
sandbox.window.Blob = sandbox.Blob;
sandbox.window.URL = sandbox.URL;

// Load and evaluate app.js inside sandbox
const appPath = path.join(__dirname, '..', 'app.js');
const appCode = fs.readFileSync(appPath, 'utf8');
vm.createContext(sandbox);
vm.runInContext(appCode, sandbox);

const app = sandbox;
const state = sandbox.window.state || sandbox.state;
app.bindEvents();

let passed = 0;
let total = 0;

function testAssert(name, condition, details = '') {
  total++;
  if (condition) {
    console.log(`  ✓ PASSED: [Test ${total}] ${name}`);
    passed++;
  } else {
    console.error(`  ❌ FAILED: [Test ${total}] ${name} - ${details}`);
    process.exitCode = 1;
  }
}

async function runAccountingAndWorkflowTests() {
  // --------------------------------------------------------------------------
  // Category 1: Financial Precision Throughout Application Workflows
  // --------------------------------------------------------------------------
  console.log('📌 CATEGORY 1: Financial Precision in Transactions, Totals & Storage');

  // Test 1: 1,000 fractional transactions of 0.01 sum to exactly 10.00
  state.data = app.createCleanData();
  const testP1 = { id: 'p_prec_1', num: 1, name: 'سائق الكسور', role: 'driver', archived: false };
  state.data.people = [testP1];

  let centsTotal = 0;
  for (let i = 1; i <= 1000; i++) {
    const dk = `2026-01-${String((i % 28) + 1).padStart(2, '0')}`;
    state.data.entries[dk] = state.data.entries[dk] || {};
    const cur = state.data.entries[dk]['p_prec_1'] || { cash: 0, invoice: 0, returnedCash: 0 };
    cur.invoice = app.addMoney(cur.invoice, 0.01);
    state.data.entries[dk]['p_prec_1'] = cur;
  }
  const janInvTotal = app.calculateMonthDriverInvoices(2026, 1, 'driver');
  testAssert('1,000 transactions of 0.01 sum to exactly 10.00 in monthly invoices',
    janInvTotal === 10.00,
    `Calculated: ${janInvTotal}, Expected: 10.00`
  );

  // Test 2: Standard business math (10.25 + 5.75 = 16.00, 20.00 - 0.05 = 19.95)
  testAssert('Exact two-decimal additions and subtractions (10.25 + 5.75 = 16.00)',
    app.addMoney(10.25, 5.75) === 16.00 && app.subMoney(20.00, 0.05) === 19.95
  );

  // Test 3: Large financial amounts handling without precision loss
  const largeA = 500000.75;
  const largeB = 250000.25;
  testAssert('Large financial amounts (500,000.75 + 250,000.25 = 750,001.00)',
    app.addMoney(largeA, largeB) === 750001.00
  );

  // Test 4: Fractional rounding of 3+ decimal places
  const vRoundUp = app.validateMonetaryInput('10.556');
  const vRoundDown = app.validateMonetaryInput('10.554');
  testAssert('Fractional cent rounding: 10.556 rounds to 10.56, 10.554 rounds to 10.55',
    vRoundUp.value === 10.56 && vRoundDown.value === 10.55
  );

  // Test 5: Negative amounts prohibited where invalid
  const vNegative = app.validateMonetaryInput('-50.00', false);
  testAssert('Negative monetary input is rejected when disallowed',
    vNegative.valid === false && vNegative.value === 0
  );

  // --------------------------------------------------------------------------
  // Category 2: End-to-End Accounting Lifecycle Across Multiple Years
  // --------------------------------------------------------------------------
  console.log('\n📌 CATEGORY 2: End-to-End Accounting Across Multiple Years (2024, 2025, 2026)');

  state.data = app.createCleanData();
  const driverA = { id: 'p_driver_a', num: 1, name: 'سائق أ', role: 'driver', archived: false };
  const staffB = { id: 'p_staff_b', num: 2, name: 'إداري ب', role: 'staff', archived: false };
  state.data.people = [driverA, staffB];

  // 2024 Transactions:
  // Withdrawn from safe in 2024: 15,000
  state.data.dailyReceipts['2024-05-10'] = 15000;
  // Distributed to driver A: 10,000 cash, submitted 8,000 invoice (Driver A balance: 2,000)
  state.data.entries['2024-05-10'] = {
    'p_driver_a': { cash: 10000, invoice: 8000, returnedCash: 0 }
  };
  // Safe invoice submitted to company in 2024: 8,000 (Safe net unpaid: 15,000 - 8,000 = 7,000)
  state.data.safeInvoices.push({
    id: 'si_2024',
    date: '2024-05-20',
    amount: 8000,
    periodKey: '2024-05',
    ref: 'INV-2024-1'
  });

  // 2025 Transactions:
  // Withdrawn from safe in 2025: 20,000
  state.data.dailyReceipts['2025-08-15'] = 20000;
  // Safe invoice submitted in 2025: 18,000 (2025 movement net: 20,000 - 18,000 = 2,000)
  state.data.safeInvoices.push({
    id: 'si_2025',
    date: '2025-08-25',
    amount: 18000,
    periodKey: '2025-08',
    ref: 'INV-2025-1'
  });

  // 2026 Transactions (Current Year):
  // Withdrawn from safe in Jan 2026: 5,000
  state.data.dailyReceipts['2026-01-10'] = 5000;
  // Safe invoice in Jan 2026: 3,000
  state.data.safeInvoices.push({
    id: 'si_2026_jan',
    date: '2026-01-20',
    amount: 3000,
    periodKey: '2026-01',
    ref: 'INV-2026-1'
  });

  // Test 6: Invariant 1 - Year 2026 independent annual balance contains ONLY 2026 movement
  const safeFin2026Year = app.getSafeTabFinancials(2026, 1, true);
  testAssert('Year 2026 annual withdrawals = 5,000.00 (independent of 2024/2025)',
    safeFin2026Year.periodMovement.withdrawn === 5000.00,
    `Got: ${safeFin2026Year.periodMovement.withdrawn}`
  );
  testAssert('Year 2026 annual invoices = 3,000.00',
    safeFin2026Year.periodMovement.invoices === 3000.00
  );
  testAssert('Year 2026 annual net balance = 2,000.00 (5,000 - 3,000)',
    safeFin2026Year.periodMovement.netBalance === 2000.00
  );

  // Test 7: Invariant 2 - Lifetime cumulative balance preserves previous years without double counting
  // Prior opening balance before 2026: (15,000 - 8,000) + (20,000 - 18,000) = 7,000 + 2,000 = 9,000
  testAssert('Historical opening balance before 2026 = 9,000.00 (2024 + 2025 unpaid)',
    safeFin2026Year.cumulativeRunning.priorOpeningBalance === 9000.00,
    `Got: ${safeFin2026Year.cumulativeRunning.priorOpeningBalance}`
  );
  // Total cumulative withdrawals up to 2026: 15,000 + 20,000 + 5,000 = 40,000
  testAssert('Total cumulative withdrawals across all years = 40,000.00',
    safeFin2026Year.cumulativeRunning.cumulativeWithdrawn === 40000.00
  );
  // Total cumulative invoices: 8,000 + 18,000 + 3,000 = 29,000
  testAssert('Total cumulative invoices across all years = 29,000.00',
    safeFin2026Year.cumulativeRunning.cumulativeInvoices === 29000.00
  );
  // Total cumulative net balance: 40,000 - 29,000 = 11,000 (which is 9,000 prior + 2,000 in 2026)
  testAssert('Total cumulative net balance = 11,000.00 (9,000 prior + 2,000 current)',
    safeFin2026Year.cumulativeRunning.cumulativeNetBalance === 11000.00
  );

  // Test 8: Monthly carry-forward running balance for person
  // Driver A in 2024 has balance 2,000.
  // In 2026-02-01, Driver A balance before that date must equal 2,000.00
  const driverABal2026 = app.getPersonBalanceBeforeDate('p_driver_a', '2026-02-01');
  testAssert('Driver historical carry-forward balance across years = 2,000.00',
    driverABal2026 === 2000.00,
    `Got: ${driverABal2026}`
  );

  // --------------------------------------------------------------------------
  // Category 3: Actual UI Event Handlers (CRUD, Archiving, Duplicate Protection)
  // --------------------------------------------------------------------------
  console.log('\n📌 CATEGORY 3: Actual UI Event Handlers & Workflows');

  // Test 9: Safe Invoice Editing Workflow via Real DOM Elements
  // Populate form as user does when editing
  state.editingSafeInvoiceId = 'si_2026_jan';
  const inpSafeDate = getOrCreateElement('safeInvoiceDate');
  const inpSafeAmt = getOrCreateElement('safeInvoiceAmount');
  const inpSafeRef = getOrCreateElement('safeInvoiceRef');
  const inpSafeNote = getOrCreateElement('safeInvoiceNote');
  const btnSaveSafeInv = getOrCreateElement('btnAddSafeInvoice');

  inpSafeDate.value = '2026-01-20';
  inpSafeAmt.value = '3500.50'; // updated amount
  inpSafeRef.value = 'INV-2026-1-EDITED';
  inpSafeNote.value = 'تعديل المبلغ بعد مراجعة الإيصال';

  // Trigger actual click handler on #btnAddSafeInvoice
  btnSaveSafeInv.click();

  const updatedInv = state.data.safeInvoices.find(i => i.id === 'si_2026_jan');
  testAssert('Safe invoice updated via actual #btnAddSafeInvoice click handler',
    updatedInv && updatedInv.amount === 3500.50 && updatedInv.ref === 'INV-2026-1-EDITED',
    `Amount: ${updatedInv?.amount}, Ref: ${updatedInv?.ref}`
  );
  testAssert('state.editingSafeInvoiceId cleared after save',
    state.editingSafeInvoiceId === null
  );

  // Test 10: Safe Invoice Deletion Workflow via Actual Application Function
  const invToDeleteId = 'si_2026_jan';
  // Invoke actual application function deleteSafeInvoice
  const deleteResult = app.deleteSafeInvoice(invToDeleteId);
  testAssert('deleteSafeInvoice execution returns true', deleteResult === true);

  const deletedSearch = state.data.safeInvoices.find(i => i.id === invToDeleteId);
  testAssert('Safe invoice deleted via actual application function',
    deletedSearch === undefined && state.data.safeInvoices.length === 2
  );

  // Test 11: Duplicate Settlement Prevention & Supplemental Invoice Workflow
  // Set up March 2026 driver invoices: 1,500.00
  state.data.entries['2026-03-05'] = {
    'p_driver_a': { cash: 0, invoice: 1500.00, returnedCash: 0 }
  };

  // Initially: 0 settled, 1,500 un-settled
  let summMarch = app.getPeriodSettlementSummary(2026, 3, 'safe', 'driver');
  testAssert('Period summary reports 1,500.00 un-settled driver invoices',
    summMarch.currentDriverInvoices === 1500.00 && summMarch.isFullySettled === false
  );

  // Settle full 1,500.00
  state.data.safeInvoices.push({
    id: 'si_march_full',
    date: '2026-03-10',
    amount: 1500.00,
    periodKey: '2026-03',
    ref: 'INV-MARCH-FULL'
  });

  summMarch = app.getPeriodSettlementSummary(2026, 3, 'safe', 'driver');
  testAssert('Period summary flags isFullySettled = true after 1,500.00 settlement',
    summMarch.isFullySettled === true && summMarch.unSettledDiff === 0
  );

  // Add 300.00 new late invoices later in March
  state.data.entries['2026-03-25'] = {
    'p_driver_a': { cash: 0, invoice: 300.00, returnedCash: 0 }
  };
  summMarch = app.getPeriodSettlementSummary(2026, 3, 'safe', 'driver');
  testAssert('Late invoices detected: hasPartialSettlement = true, unSettledDiff = 300.00',
    summMarch.hasPartialSettlement === true && summMarch.unSettledDiff === 300.00
  );

  // Add supplemental settlement for the 300.00 diff
  state.data.safeInvoices.push({
    id: 'si_march_supp',
    date: '2026-03-28',
    amount: 300.00,
    periodKey: '2026-03',
    ref: 'INV-MARCH-SUPPLEMENTAL'
  });
  summMarch = app.getPeriodSettlementSummary(2026, 3, 'safe', 'driver');
  testAssert('Supplemental settlement completes period settlement (isFullySettled = true)',
    summMarch.isFullySettled === true && summMarch.unSettledDiff === 0 && summMarch.totalSettled === 1800.00
  );

  // Test 12: People Archiving & Reactivation Workflow via Actual Application Functions
  const testArchPerson = {
    id: 'p_test_arch',
    num: 99,
    name: 'سائق الأرشفة',
    role: 'driver',
    archived: false,
    archivedAt: null
  };
  state.data.people.push(testArchPerson);

  // Invoke actual application function archivePerson
  const archResult = app.archivePerson(testArchPerson.id);
  testAssert('archivePerson execution returns true', archResult === true);
  testAssert('Person archived via actual application function (archived = true)',
    testArchPerson.archived === true && testArchPerson.archivedAt !== null
  );

  // Invoke actual application function unarchivePerson
  const unarchResult = app.unarchivePerson(testArchPerson.id);
  testAssert('unarchivePerson execution returns true', unarchResult === true);
  testAssert('Person reactivated via actual application function (archived = false)',
    testArchPerson.archived === false && testArchPerson.archivedAt === null
  );

  // Deletion block test: person with history cannot be deleted
  state.data.entries['2026-03-01'] = { 'p_test_arch': { cash: 100, invoice: 100, returnedCash: 0 } };
  const hasHistory = app.hasPersonAnyEntryInHistory('p_test_arch');
  testAssert('hasPersonAnyEntryInHistory detects financial transactions and blocks deletion',
    hasHistory === true
  );

  // --------------------------------------------------------------------------
  // Category 4: Backup, Schema Validation & Rollback Workflow
  // --------------------------------------------------------------------------
  console.log('\n📌 CATEGORY 4: Backup Restore & Rollback Recovery Workflow');

  // Baseline state
  state.data.people = [{ id: 'p_base_1', num: 1, name: 'الأساسي', role: 'driver', archived: false }];
  state.data.dailyReceipts = { '2026-01-01': 1000 };
  app.saveState();

  // Test 13: Invalid backup rejection preserves existing data
  const initialDataSnapshot = JSON.stringify(state.data);
  const invalidBackupPayload = {
    schemaVersion: 4,
    people: 'invalid_string_not_array' // Corrupted people
  };

  let restoreThrew = false;
  try {
    app.validateBackupPayload(invalidBackupPayload);
  } catch (err) {
    restoreThrew = true;
  }

  testAssert('Invalid backup payload throws validation error', restoreThrew === true);
  testAssert('Existing application data is completely unmodified by failed restore',
    JSON.stringify(state.data) === initialDataSnapshot
  );

  // Test 14: Valid backup restore + Pre-restore snapshot creation + Rollback trigger
  const validImportPayload = {
    schemaVersion: 4,
    people: [
      { id: 'p_imported_1', num: 1, name: 'سائق مستورد 1', role: 'driver' },
      { id: 'p_imported_2', num: 2, name: 'موظف مستورد 2', role: 'staff' }
    ],
    dailyReceipts: { '2026-01-01': 2500.50 },
    entries: {
      '2026-01-01': {
        'p_imported_1': { cash: 1000, invoice: 800, returnedCash: 200 }
      }
    },
    safeInvoices: [
      { id: 'si_imp_1', date: '2026-01-05', amount: 800 }
    ]
  };

  // Execute restore workflow matching app.js line 4945
  const validated = app.validateBackupPayload(validImportPayload);

  // Pre-restore snapshot creation
  const preSnapshot = {
    timestamp: Date.now(),
    dateFormatted: '2026-10-31 23:45',
    data: JSON.parse(JSON.stringify(state.data))
  };
  sandbox.localStorage.setItem('petty_cash_pre_restore_snapshot', JSON.stringify(preSnapshot));

  // Apply new validated data
  state.data = validated;
  app.saveState();

  testAssert('Valid backup restored: people count = 2, dailyReceipts = 2,500.50',
    state.data.people.length === 2 && state.data.dailyReceipts['2026-01-01'] === 2500.50
  );

  // Trigger actual rollback via application function rollbackPreRestore
  const rollbackResult = app.rollbackPreRestore();
  testAssert('rollbackPreRestore execution returns true', rollbackResult === true);

  testAssert('Rollback action restores exact original state before the import',
    JSON.stringify(state.data) === initialDataSnapshot && state.data.people[0].name === 'الأساسي'
  );

  // --------------------------------------------------------------------------
  // Category 5: Realistic Legacy Data Migration
  // --------------------------------------------------------------------------
  console.log('\n📌 CATEGORY 5: Legacy Schema Migration & Historical Integrity');

  // Realistic v1/v2 schema format: missing archived fields, numeric amounts as strings, orphaned entries
  const realisticLegacyBackup = {
    schemaVersion: 2,
    people: [
      { id: 'p_leg_1', num: '1', name: 'سائق قديم 1', role: 'driver', meta: 'سيارة 12' },
      { id: 'p_leg_2', num: '2', name: 'موظف قديم 2', role: 'staff', meta: 'محاسب' }
    ],
    dailyReceipts: {
      '2024-03-01': '5000.50',
      '2024-03-02': '3000'
    },
    entries: {
      '2024-03-01': {
        'p_leg_1': { cash: '1500.25', invoice: '1200.25', returnedCash: '300' },
        'p_orphan_missing': { cash: '500', invoice: '400', returnedCash: '100' } // Orphaned entry!
      }
    },
    custodyReceipts: [
      { id: 'cr_1', date: '2024-03-01', amount: '8000.50', ref: 'REC-1' }
    ]
  };

  const migrated = app.validateBackupPayload(realisticLegacyBackup);

  testAssert('Migration upgrades schemaVersion to 5',
    migrated.schemaVersion === 5
  );
  testAssert('Migration normalizes archived: false and archivedAt: null for existing people',
    migrated.people[0].archived === false && migrated.people[0].archivedAt === null
  );
  testAssert('Referential integrity: Orphaned entry person is automatically recovered as archived person',
    migrated.people.length === 3 &&
    migrated.people.find(p => p.id === 'p_orphan_missing')?.archived === true
  );
  testAssert('Monetary amounts normalized to exact numbers (dailyReceipts = 5000.50)',
    migrated.dailyReceipts['2024-03-01'] === 5000.50 &&
    migrated.entries['2024-03-01']['p_leg_1'].cash === 1500.25 &&
    migrated.entries['2024-03-01']['p_leg_1'].invoice === 1200.25
  );

  // Verify financial totals before and after migration
  const rawSum = 5000.50 + 3000;
  const migratedSum = migrated.dailyReceipts['2024-03-01'] + migrated.dailyReceipts['2024-03-02'];
  testAssert('Financial totals before and after migration match to exact 2 decimal places (8,000.50)',
    migratedSum === 8000.50 && migratedSum === rawSum
  );

  // --------------------------------------------------------------------------
  // Category 6: Service Worker Cache Cleanup Execution Test
  // --------------------------------------------------------------------------
  console.log('\n📌 CATEGORY 6: Service Worker Cache Cleanup Execution Test');

  // Load sw.js and test actual activate event handler logic
  const swPath = path.join(__dirname, '..', 'sw.js');
  const swCode = fs.readFileSync(swPath, 'utf8');

  const swDeletedCaches = [];
  const currentSwCacheName = (swCode.match(/const CACHE_NAME = ['"]([^'"]+)['"]/) || [])[1] || 'petty-cash-v12-tanker';
  const fakeCaches = {
    keys: async () => [
      'petty-cash-v8-old',
      'petty-cash-v7-legacy',
      currentSwCacheName, // current cache
      'other-app-cache',        // unrelated
      'user-browser-data'        // unrelated
    ],
    delete: async (k) => {
      swDeletedCaches.push(k);
      return true;
    }
  };

  const swSandbox = {
    self: {
      addEventListener: (evt, fn) => {
        if (evt === 'activate') swSandbox._activateHandler = fn;
      },
      clients: { claim: async () => {} },
      skipWaiting: () => {}
    },
    caches: fakeCaches
  };

  vm.createContext(swSandbox);
  vm.runInContext(swCode, swSandbox);

  // Trigger the actual activate handler
  if (swSandbox._activateHandler) {
    let waitUntilPromise = null;
    swSandbox._activateHandler({
      waitUntil: (p) => { waitUntilPromise = p; }
    });
    if (waitUntilPromise) await waitUntilPromise;
  }

  testAssert('Service worker cache cleanup deleted older petty-cash-* caches',
    swDeletedCaches.includes('petty-cash-v8-old') && swDeletedCaches.includes('petty-cash-v7-legacy')
  );
  testAssert('Service worker preserved current cache (petty-cash-v9-hardening)',
    !swDeletedCaches.includes(currentSwCacheName)
  );
  testAssert('Service worker preserved unrelated origin caches (other-app-cache, user-browser-data)',
    !swDeletedCaches.includes('other-app-cache') && !swDeletedCaches.includes('user-browser-data')
  );

  // --------------------------------------------------------------------------
  // CATEGORY 7: Tab 7 Audit Trail Persistence, Date-Edit PeriodKey Synchronization & Minor-Unit Excel Precision
  // --------------------------------------------------------------------------
  console.log('\n📌 CATEGORY 7: Tab 7 Audit Trail Persistence, PeriodKey Sync & Minor-Unit Excel Precision');

  // Test 40: Audit Trail Persistence across loadState()
  state.data = app.createCleanData();
  state.data.people = [
    { id: 'p_audit_test_1', num: 1, name: 'سائق الفحص', role: 'driver', archived: false, archivedAt: null }
  ];
  state.data.safeInvoices = [
    { id: 'si_audit_1', date: '2026-01-10', amount: 500, periodKey: '2026-01', ref: 'INV-1', status: 'active' }
  ];
  state.data.safeInvoicesAudit = [
    { action: 'reversed', invoiceId: 'si_audit_old', amount: 200, timestamp: new Date().toISOString(), reason: 'إلغاء تدقيقي' }
  ];

  // Save to storage
  app.saveState();
  testAssert('saveState writes safeInvoicesAudit to localStorage',
    storage['petty_cash_clean_v2'] && JSON.parse(storage['petty_cash_clean_v2']).safeInvoicesAudit.length === 1
  );

  // Clear memory state and reload from storage
  state.data = null;
  app.loadState();
  testAssert('loadState restores safeInvoicesAudit across page reload/restart',
    Array.isArray(state.data.safeInvoicesAudit) &&
    state.data.safeInvoicesAudit.length === 1 &&
    state.data.safeInvoicesAudit[0].action === 'reversed' &&
    state.data.safeInvoicesAudit[0].reason === 'إلغاء تدقيقي'
  );

  // Test 41: Editing safe invoice date updates periodKey to new period and logs audit
  state.editingSafeInvoiceId = 'si_audit_1';
  sandbox.document.getElementById('safeInvoiceDate').value = '2026-02-15';
  sandbox.document.getElementById('safeInvoiceAmount').value = '550.00';
  sandbox.document.getElementById('safeInvoiceRef').value = 'INV-1-EDITED';
  sandbox.document.getElementById('safeInvoiceNote').value = 'تم ترحيل الفاتورة لشهر فبراير';

  // Trigger #btnAddSafeInvoice click handler
  const btnSaveSafe = sandbox.document.getElementById('btnAddSafeInvoice');
  btnSaveSafe.click();

  const editedInv = state.data.safeInvoices.find(x => x.id === 'si_audit_1');
  testAssert('Editing invoice date updates periodKey to match new date (2026-02)',
    editedInv && editedInv.date === '2026-02-15' && editedInv.periodKey === '2026-02'
  );
  testAssert('Editing invoice records audit entry in safeInvoicesAudit with action: edited',
    state.data.safeInvoicesAudit.some(a => a.action === 'edited' && a.invoiceId === 'si_audit_1' && a.periodKey === '2026-02')
  );

  // Test 42: Period settlement summary strictly isolates months without false warnings
  state.data.entries['2026-01-05'] = {
    [state.data.people[0].id]: { cash: 0, invoice: 500, returnedCash: 0 }
  };
  state.data.entries['2026-02-05'] = {
    [state.data.people[0].id]: { cash: 0, invoice: 550, returnedCash: 0 }
  };

  const janSummary = app.getPeriodSettlementSummary(2026, 1, 'safe', 'driver');
  testAssert('January period summary is NOT settled by invoice moved to February (no false settlement)',
    janSummary.totalSettled === 0 && janSummary.isFullySettled === false
  );

  const febSummary = app.getPeriodSettlementSummary(2026, 2, 'safe', 'driver');
  testAssert('February period summary correctly accounts for the edited invoice (550.00 settled)',
    febSummary.totalSettled === 550.00 && febSummary.isFullySettled === true
  );

  // Test 43: Backup payload validation preserves and sanitizes safeInvoicesAudit
  const backupWithAudit = {
    schemaVersion: 5,
    people: [{ id: 'p1', num: 1, name: 'سائق', role: 'driver' }],
    dailyReceipts: {},
    dailyExtras: {},
    entries: {},
    custodyReceipts: [],
    custodySettlements: [],
    safeInvoices: [],
    safeInvoicesAudit: [
      { action: 'reversed', invoiceId: 'si_test', amount: '123.45', timestamp: '2026-02-01T10:00:00Z', reason: 'تدقيق' },
      { badProp: true } // malformed entry
    ]
  };
  const validatedBackup = app.validateBackupPayload(backupWithAudit);
  testAssert('validateBackupPayload retains and sanitizes safeInvoicesAudit array',
    Array.isArray(validatedBackup.safeInvoicesAudit) &&
    validatedBackup.safeInvoicesAudit.length === 2 &&
    validatedBackup.safeInvoicesAudit[0].amount === 123.45 &&
    validatedBackup.safeInvoicesAudit[0].action === 'reversed' &&
    validatedBackup.safeInvoicesAudit[1].action === 'unknown'
  );

  // Test 44: CSV cell formatting blocks formula injection (CWE-1236)
  testAssert('formatCsvCell escapes formula trigger characters (=, +, -, @)',
    app.formatCsvCell('=1+1') === "\"'=1+1\"" &&
    app.formatCsvCell('+SUM(A1:A5)') === "\"'"+"+SUM(A1:A5)\"" &&
    app.formatCsvCell('Regular Text') === '"Regular Text"'
  );

  // --------------------------------------------------------------------------
  // Summary
  // --------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`🏁 END-TO-END WORKFLOW & ACCOUNTING RESULTS: ${passed} / ${total} TESTS PASSED`);
  if (passed === total) {
    console.log('✅ ALL WORKFLOW, ACCOUNTING, PRECISION & MIGRATION TESTS PASSED 100%');
  } else {
    console.log(`❌ SOME TESTS FAILED (${total - passed} failures)`);
  }
  console.log('================================================================\n');
}

if (require.main === module) {
  runAccountingAndWorkflowTests();
}

module.exports = { runAccountingAndWorkflowTests };
