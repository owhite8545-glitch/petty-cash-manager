/**
 * ملف اختبار مؤقت للتحقق من دوال وحسابات التبويب السابع: "معاملاتي مع الخزنة"
 * يقوم باختبار:
 * 1. صحة هيكل البيانات والتخزين لـ safeInvoices
 * 2. دوال التصفية بالحسابات الشهرية والسنوية getSafeInvoicesForMonth / getSafeInvoicesForYear
 * 3. قراءة السحوبات اليومية وحساب الصافي (سحوبات - فواتير)
 * 4. حالة التصفية التامة وحالات العجز أو الفائض
 */

const fs = require('fs');
const vm = require('vm');

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
        add: () => {},
        remove: () => {},
        toggle: () => {},
        contains: () => false
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
      classList: { add: () => {}, remove: () => {} },
      appendChild: () => {}
    }),
    body: {
      classList: { add: () => {}, remove: () => {}, toggle: () => {} }
    },
    addEventListener: () => {}
  },
  window: {
    addEventListener: () => {},
    print: () => {}
  },
  alert: (msg) => console.log('ALERT:', msg),
  confirm: () => true
};
sandbox.window.localStorage = sandbox.localStorage;
sandbox.window.document = sandbox.document;

const appCode = fs.readFileSync(__dirname + '/app.js', 'utf8');
vm.createContext(sandbox);
vm.runInContext(appCode, sandbox);

vm.runInContext(`
  console.log('--- Test 1: Initial Data Schema Check ---');
  const cleanData = createCleanData();
  if (!Array.isArray(cleanData.safeInvoices)) throw new Error('safeInvoices missing in createCleanData');
  console.log('cleanData.safeInvoices is array: OK ✓');

  state.year = 2026;
  state.month = 1;
  state.data.dailyReceipts['2026-01-05'] = 3000;
  state.data.dailyReceipts['2026-01-06'] = 2000;
  state.data.safeInvoices = [
    { id: 'si_1', date: '2026-01-10', amount: 3500, ref: 'INV-101', note: 'بترول' }
  ];

  console.log('--- Test 2: Helper Functions Check ---');
  const janInvs = getSafeInvoicesForMonth(2026, 1);
  if (janInvs.length !== 1 || janInvs[0].amount !== 3500) throw new Error('getSafeInvoicesForMonth failed');
  const yearInvs = getSafeInvoicesForYear(2026);
  if (yearInvs.length !== 1) throw new Error('getSafeInvoicesForYear failed');
  console.log('Helper functions: OK ✓');

  console.log('--- Test 3: Render Safe Tab Month Scope Check ---');
  state.safeMonth = 1;
  state.safeShowYear = false;
  renderSafeTab();

  const wTotal = document.getElementById('safeWithdrawnTotal').textContent;
  const iTotal = document.getElementById('safeInvoicesTotal').textContent;
  const netBal = document.getElementById('safeNetBalance').textContent;
  const netStat = document.getElementById('safeNetStatus').textContent;

  console.log('Withdrawals KPI:', wTotal);
  console.log('Invoices KPI:', iTotal);
  console.log('Net Balance KPI:', netBal);
  console.log('Net Status:', netStat);

  if (wTotal !== '5,000 ر.ق') throw new Error('Withdrawals total mismatch: ' + wTotal);
  if (iTotal !== '3,500 ر.ق') throw new Error('Invoices total mismatch: ' + iTotal);
  if (netBal !== '1,500 ر.ق') throw new Error('Net balance mismatch: ' + netBal);

  console.log('--- Test 4: Fully Settled Balance Check ---');
  state.data.safeInvoices.push({ id: 'si_2', date: '2026-01-20', amount: 1500, ref: 'INV-102', note: 'صيانة' });
  renderSafeTab();
  const netBalSettled = document.getElementById('safeNetBalance').textContent;
  const netStatSettled = document.getElementById('safeNetStatus').textContent;
  console.log('Settled Net Balance:', netBalSettled);
  console.log('Settled Status:', netStatSettled);
  if (netBalSettled !== '0 ر.ق') throw new Error('Settled balance mismatch: ' + netBalSettled);
  if (!netStatSettled.includes('خالص ومصفى')) throw new Error('Settled status text mismatch');

  console.log('--- Test 5: Year Scope Check ---');
  state.data.dailyReceipts['2026-02-01'] = 4000;
  state.safeShowYear = true;
  renderSafeTab();
  const wTotalYear = document.getElementById('safeWithdrawnTotal').textContent;
  console.log('Year Scope Withdrawals:', wTotalYear);
  if (wTotalYear !== '9,000 ر.ق') throw new Error('Year withdrawals mismatch: ' + wTotalYear);

  console.log('\\n=======================================');
  console.log('ALL TESTS PASSED WITH 100% SUCCESS! ✓✓✓');
  console.log('=======================================\\n');
`, sandbox);
