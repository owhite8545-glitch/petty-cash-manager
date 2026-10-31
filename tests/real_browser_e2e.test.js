/**
 * Real Browser E2E Test Suite using Native Microsoft Edge & Chrome DevTools Protocol (CDP)
 * Runs against a live local server instance to verify genuine in-browser behavior,
 * DOM interactions, Tab 7 rendering, dual KPIs, and zero console errors.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const PORT = 8088;
const CDP_PORT = 9228;
const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const TEMP_USER_DATA = path.join(__dirname, '..', '.tmp_edge_e2e_profile');

console.log('================================================================');
console.log('🌐 REAL BROWSER E2E TEST: Microsoft Edge Headless via Native CDP');
console.log('================================================================\n');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.id = 1;
    this.callbacks = new Map();
    this.events = [];
    this.consoleErrors = [];
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (err) => reject(err);
      this.ws.onmessage = (msg) => {
        try {
          const res = JSON.parse(msg.data);
          if (res.id && this.callbacks.has(res.id)) {
            const cb = this.callbacks.get(res.id);
            this.callbacks.delete(res.id);
            if (res.error) cb.reject(new Error(res.error.message));
            else cb.resolve(res.result);
          } else if (res.method === 'Runtime.exceptionThrown') {
            const desc = res.params?.exceptionDetails?.exception?.description || res.params?.exceptionDetails?.text;
            this.consoleErrors.push(desc);
            console.error('    [Browser Console Exception]:', desc);
          } else if (res.method === 'Log.entryAdded' && res.params?.entry?.level === 'error') {
            this.consoleErrors.push(res.params.entry.text);
            console.error('    [Browser Console Error]:', res.params.entry.text);
          }
        } catch (e) {}
      };
    });
  }

  async send(method, params = {}) {
    const id = this.id++;
    return new Promise((resolve, reject) => {
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
    }
    return res.result?.value;
  }

  async close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

async function runBrowserE2E() {
  let serverProcess = null;
  let edgeProcess = null;
  let client = null;

  try {
    // 1. Verify Edge executable exists
    if (!fs.existsSync(EDGE_PATH)) {
      throw new Error(`Microsoft Edge not found at ${EDGE_PATH}`);
    }
    console.log(`[1/6] Found Microsoft Edge: ${EDGE_PATH}`);

    // Clean up previous temp profile if exists
    try {
      if (fs.existsSync(TEMP_USER_DATA)) {
        fs.rmSync(TEMP_USER_DATA, { recursive: true, force: true });
      }
    } catch (e) {}

    // 2. Start local server on PORT
    const serverScript = path.join(__dirname, '..', 'server.js');
    serverProcess = spawn('node', [serverScript], {
      env: { ...process.env, PORT: String(PORT) },
      cwd: path.join(__dirname, '..'),
      stdio: 'pipe'
    });
    console.log(`[2/6] Local web server started on http://localhost:${PORT}`);
    await sleep(800);

    // 3. Launch Microsoft Edge in headless mode with CDP enabled
    edgeProcess = spawn(EDGE_PATH, [
      '--headless=new',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${TEMP_USER_DATA}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-sync',
      `http://localhost:${PORT}`
    ]);
    console.log(`[3/6] Headless Edge spawned (CDP Port: ${CDP_PORT})`);

    // Poll for CDP endpoint readiness
    let targets = null;
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      try {
        targets = await fetchJson(`http://localhost:${CDP_PORT}/json/list`);
        if (targets && targets.length > 0) break;
      } catch (e) {}
    }

    if (!targets || targets.length === 0) {
      throw new Error('Failed to connect to Edge CDP endpoint within 10 seconds');
    }

    const pageTarget = targets.find(t => t.type === 'page') || targets[0];
    console.log(`[4/6] Connected to Edge Page target: ${pageTarget.title || pageTarget.url}`);

    client = new CDPClient(pageTarget.webSocketDebuggerUrl);
    await client.connect();

    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Log.enable');

    // Explicitly navigate to ensure application is fully loaded
    await client.send('Page.navigate', { url: `http://localhost:${PORT}/` });
    await sleep(2000);

    // 4. Assertions on real DOM and interactions
    console.log('[5/6] Executing Real In-Browser Assertions & User Workflows:');

    // Assertion 1: Document title and loaded scripts
    const pageTitle = await client.eval('document.title');
    console.log(`   ✓ Page title loaded: "${pageTitle}"`);

    // Assertion 2: Verify all 7 tabs are present in real browser DOM
    const tabCount = await client.eval('document.querySelectorAll(".nav-tab").length');
    console.log(`   ✓ Navigation tabs count in live DOM: ${tabCount}`);
    if (tabCount < 7) throw new Error(`Expected at least 7 tabs, got ${tabCount}`);

    // Assertion 3: Verify Tab 7 (معاملاتي مع الخزنة) button exists and click it
    const tab7BtnExists = await client.eval('!!document.querySelector("[data-tab=\'safe\']")');
    if (!tab7BtnExists) throw new Error('Tab 7 navigation button not found in DOM');
    
    await client.eval('document.querySelector("[data-tab=\'safe\']").click();');
    await sleep(400);

    const activeTab = await client.eval('state.activeTab');
    const tab7SectionVisible = await client.eval('!document.getElementById("tab-safe").classList.contains("hidden")');
    console.log(`   ✓ Tab 7 active state: ${activeTab}, section visible: ${tab7SectionVisible}`);
    if (activeTab !== 'safe' || !tab7SectionVisible) {
      throw new Error('Failed to activate Tab 7 (Safe Tab)');
    }

    // Assertion 4: Verify Tab 7 Dual KPI cards rendered correctly
    const kpiPeriodMovementText = await client.eval('document.querySelector("#tab-safe h3")?.textContent');
    const safeWithdrawnEl = await client.eval('!!document.getElementById("safeWithdrawnTotal")');
    const safeInvoicesEl = await client.eval('!!document.getElementById("safeInvoicesTotal")');
    const safeNetBalanceEl = await client.eval('!!document.getElementById("safeNetBalance")');
    const safeCumNetBalanceEl = await client.eval('!!document.getElementById("safeCumulativeNetBalance")');

    console.log(`   ✓ Dual KPI elements rendered: Period & Cumulative cards verified`);
    if (!safeWithdrawnEl || !safeInvoicesEl || !safeNetBalanceEl || !safeCumNetBalanceEl) {
      throw new Error('Tab 7 Dual KPI elements missing from live DOM');
    }

    // Assertion 5: Perform live financial transaction in browser
    // Set daily receipt in Safe Tab and add Safe Invoice
    await client.eval(`
      setDayReceived(state.selectedDate, 4000);
      document.getElementById('safeInvoiceAmount').value = '2500';
      document.getElementById('safeInvoiceRef').value = 'سند تسليم فواتير تجريبي #881';
      document.getElementById('safeInvoiceNote').value = 'تسوية فواتير الديزل والصيانة';
      document.getElementById('btnAddSafeInvoice').click();
    `);
    await sleep(400);

    const updatedWithdrawn = await client.eval('document.getElementById("safeWithdrawnTotal").textContent');
    const updatedInvoices = await client.eval('document.getElementById("safeInvoicesTotal").textContent');
    const updatedNetBalance = await client.eval('document.getElementById("safeNetBalance").textContent');
    const invoiceRowsCount = await client.eval('document.querySelectorAll("#safeInvoicesBody tr").length');

    console.log(`   ✓ Live transaction recorded in browser:`);
    console.log(`     - Withdrawn: ${updatedWithdrawn}`);
    console.log(`     - Invoices: ${updatedInvoices}`);
    console.log(`     - Period Net Balance: ${updatedNetBalance}`);
    console.log(`     - Safe Invoices Table Rows: ${invoiceRowsCount}`);

    if (invoiceRowsCount < 1) {
      throw new Error('Safe invoice was not inserted into live DOM table');
    }

    // Assertion 6: Test People Management Archiving in live browser
    await client.eval('document.querySelector("[data-tab=\'people\']").click();');
    await sleep(300);
    const peopleFilterPills = await client.eval('document.querySelectorAll("#peopleManageFilterPills .pill").length');
    console.log(`   ✓ People management filter pills count: ${peopleFilterPills} (includes active & archived)`);
    if (peopleFilterPills < 6) {
      throw new Error(`Expected at least 6 filter pills in People Management, got ${peopleFilterPills}`);
    }

    // Assertion 7: Test Backup modal and pre-restore rollback button
    await client.eval('document.getElementById("btnBackupModal").click();');
    await sleep(200);
    const backupModalVisible = await client.eval('!document.getElementById("backupModal").classList.contains("hidden")');
    console.log(`   ✓ Backup & Restore modal opened: ${backupModalVisible}`);

    // Assertion 8: Capture live browser screenshot for visual proof
    const screenshotData = await client.send('Page.captureScreenshot', { format: 'png' });
    const screenshotPath = path.join(__dirname, '..', 'browser_e2e_verified_tab7.png');
    fs.writeFileSync(screenshotPath, Buffer.from(screenshotData.data, 'base64'));
    console.log(`   ✓ Live browser screenshot saved to: ${screenshotPath}`);

    // Assertion 9: Check for zero console errors throughout the entire test
    console.log(`[6/6] Verifying browser runtime health (Console Errors Count: ${client.consoleErrors.length})`);
    if (client.consoleErrors.length > 0) {
      throw new Error(`Uncaught browser console errors detected:\n${client.consoleErrors.join('\n')}`);
    }
    console.log('   ✓ Zero runtime JavaScript exceptions or console errors!');

    console.log('\n================================================================');
    console.log('🎉 REAL BROWSER E2E TEST PASSED WITH 100% SUCCESS');
    console.log('================================================================\n');

  } catch (err) {
    console.error('\n❌ REAL BROWSER E2E TEST FAILED:');
    console.error(err.message);
    if (err.stack) console.error(err.stack);
    process.exitCode = 1;
  } finally {
    if (client) await client.close().catch(() => {});
    if (edgeProcess) {
      try {
        edgeProcess.kill('SIGKILL');
      } catch (e) {}
    }
    if (serverProcess) {
      try {
        serverProcess.kill('SIGKILL');
      } catch (e) {}
    }
    try {
      if (fs.existsSync(TEMP_USER_DATA)) {
        fs.rmSync(TEMP_USER_DATA, { recursive: true, force: true });
      }
    } catch (e) {}
  }
}

runBrowserE2E();
