const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const PORT = 8089;
const CDP_PORT = 9229;
const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const TEMP_USER_DATA = path.join(__dirname, '..', '.tmp_edge_audit_profile');
const ARTIFACT_DIR = 'C:\\Users\\PC\\.gemini\\antigravity\\brain\\29620b95-5fea-4399-bc07-fbe5fbd8fd4f';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function startStaticServer(baseDir, port) {
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2'
  };

  const server = http.createServer((req, res) => {
    let reqPath = req.url.split('?')[0];
    if (reqPath === '/' || reqPath === '') reqPath = '/index.html';
    const filePath = path.join(baseDir, reqPath);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    });
  });

  return new Promise(resolve => {
    server.listen(port, () => resolve(server));
  });
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
  }

  async connect() {
    const WS = globalThis.WebSocket;
    return new Promise((resolve, reject) => {
      this.ws = new WS(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = reject;
      this.ws.onmessage = event => {
        const msg = JSON.parse(event.data);
        if (msg.id && this.callbacks.has(msg.id)) {
          const cb = this.callbacks.get(msg.id);
          this.callbacks.delete(msg.id);
          if (msg.error) cb.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          else cb.resolve(msg.result);
        }
      };
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expr) {
    const res = await this.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval error: ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result ? res.result.value : undefined;
  }

  async screenshot(outPath) {
    const res = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(outPath, Buffer.from(res.data, 'base64'));
  }
}

async function run() {
  const server = await startStaticServer(path.join(__dirname, '..'), PORT);
  console.log(`Static server running on port ${PORT}`);

  try {
    fs.rmSync(TEMP_USER_DATA, { recursive: true, force: true });
  } catch {}

  const edgeProcess = spawn(EDGE_PATH, [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${TEMP_USER_DATA}`,
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1440,900',
    'about:blank'
  ], { stdio: 'ignore' });

  await sleep(1500);

  const targets = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json`);
  const pageTarget = targets.find(t => t.type === 'page');
  const cdp = new CDPClient(pageTarget.webSocketDebuggerUrl);
  await cdp.connect();

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url: `http://localhost:${PORT}/index.html` });
  await sleep(2000);

  // Populate rich synthetic data so all tabs render live tables and numbers
  await cdp.eval(`(() => {
    // Add people
    state.data.people = [
      { id: 'p_1', num: 1, name: 'أحمد علي السائق', role: 'driver', meta: 'باص 14 - موقع لوسيل' },
      { id: 'p_2', num: 2, name: 'محمد حسن السائق', role: 'driver', meta: 'بيك آب 22 - مشروع اللؤلؤة' },
      { id: 'p_3', num: 3, name: 'إبراهيم مهندس الموقع', role: 'staff', meta: 'مشرف كهرباء' },
      { id: 'p_4', num: 4, name: 'سائق سابق مؤرشف', role: 'driver', meta: 'سيارة 09', archived: true }
    ];

    // Daily receipt and entries for selected date
    const dKey = state.selectedDate; // e.g. 2026-11-08
    state.data.dailyReceipts[dKey] = 5000;
    if (!state.data.entries[dKey]) state.data.entries[dKey] = {};
    state.data.entries[dKey]['p_1'] = { cash: 1500, invoice: 950, returnedCash: 150, note: 'وقود بترول وصيانة زيت' };
    state.data.entries[dKey]['p_2'] = { cash: 1200, invoice: 800, returnedCash: 0, note: 'مشتريات مواد كهربائية' };
    state.data.entries[dKey]['p_3'] = { cash: 800, invoice: 800, returnedCash: 0, note: 'ضيافة مهندسين' };

    // Company Custody (Tab 7)
    state.data.custodyReceipts = [
      { id: 'cr_1', date: '2026-11-01', year: 2026, month: 11, amount: 25000, ref: 'CHQ-9812', note: 'دفعة عهدة نقدية تحويل بنكي' }
    ];
    state.data.custodySettlements = [
      { id: 'cs_1', date: '2026-11-05', year: 2026, month: 11, amount: 18000, period: 'فواتير الأسبوع الأول نوفمبر', ref: 'SET-102', note: 'كشف تسوية فواتير معتمد' }
    ];

    // Safe Invoices (Tab 8)
    state.data.safeInvoices = [
      { id: 'si_1', date: '2026-11-04', year: 2026, month: 11, amount: 6500, ref: 'INV-SAFE-01', note: 'تسوية سحب نقدي سابق' }
    ];

    // Tanker Deliveries (Tab 9)
    state.data.tankerDeliveries = [
      { id: 'td_1', date: '2026-11-02', year: 2026, month: 11, project: 'مشروع لوسيل السكني', liters: 800, pricePerLiter: 2.1, amount: 1680, invoiceNo: 'WQ-9921', receiver: 'المهندس أحمد', supplier: 'وقود (WOQOD)', notes: 'تفريغ مولد رئيسي' },
      { id: 'td_2', date: '2026-11-06', year: 2026, month: 11, project: 'مشروع أبراج الدفنة', liters: 500, pricePerLiter: 2.1, amount: 1050, invoiceNo: 'WQ-9955', receiver: 'المشرف خالد', supplier: 'وقود (WOQOD)', notes: 'تفريغ مضخة' }
    ];
    state.data.projectsList = ['مشروع لوسيل السكني', 'مشروع أبراج الدفنة', 'مشروع اللؤلؤة'];

    saveState();
    renderAll();
  })()`);
  await sleep(600);

  // Switch to Dark Mode
  await cdp.eval(`(() => {
    if (!document.body.classList.contains('dark-mode')) {
      const btn = document.getElementById('btnThemeToggle');
      if (btn) btn.click();
      else {
        document.body.classList.add('dark-mode');
        state.theme = 'dark';
      }
    }
  })()`);
  await sleep(800);

  console.log('Capturing Dark Mode screenshots of all tabs...');

  const tabs = [
    { id: 'daily', name: 'tab1_daily' },
    { id: 'monthly', name: 'tab2_monthly' },
    { id: 'dispatch', name: 'tab3_dispatch' },
    { id: 'person', name: 'tab4_person' },
    { id: 'annual', name: 'tab5_annual' },
    { id: 'people', name: 'tab6_people' },
    { id: 'custody', name: 'tab7_custody' },
    { id: 'safe', name: 'tab8_safe' },
    { id: 'tanker', name: 'tab9_tanker' }
  ];

  for (const t of tabs) {
    await cdp.eval(`(() => {
      const btn = document.querySelector('.nav-tab[data-tab="${t.id}"]');
      if (btn) btn.click();
    })()`);
    await sleep(600);
    const shotPath = path.join(ARTIFACT_DIR, `audit_dark_${t.name}.png`);
    await cdp.screenshot(shotPath);
    console.log(`Captured: audit_dark_${t.name}.png`);
  }

  // Modals capture
  // 1. Tanker Delivery Modal
  await cdp.eval(`(() => {
    openTankerModal();
  })()`);
  await sleep(600);
  await cdp.screenshot(path.join(ARTIFACT_DIR, 'audit_dark_modal_tanker.png'));
  console.log('Captured: audit_dark_modal_tanker.png');

  // Close tanker modal
  await cdp.eval(`(() => {
    closeTankerModal();
  })()`);
  await sleep(400);

  // 2. Cloud Sync / App Lock modal
  await cdp.eval(`(() => {
    const btn = document.getElementById('btnCloudSyncModal');
    if (btn) btn.click();
  })()`);
  await sleep(600);
  await cdp.screenshot(path.join(ARTIFACT_DIR, 'audit_dark_modal_lock.png'));
  console.log('Captured: audit_dark_modal_lock.png');

  // Close modal
  await cdp.eval(`(() => {
    const btn = document.getElementById('btnCloseCloudSyncModal');
    if (btn) btn.click();
  })()`);
  await sleep(400);

  // 3. Move/Copy Distribution modal
  await cdp.eval(`(() => {
    openMoveDistModal();
  })()`);
  await sleep(600);
  await cdp.screenshot(path.join(ARTIFACT_DIR, 'audit_dark_modal_move_dist.png'));
  console.log('Captured: audit_dark_modal_move_dist.png');

  await cdp.eval(`(() => {
    document.getElementById('moveDistModal').classList.add('hidden');
  })()`);
  await sleep(400);

  // 4. Replenishment Modal
  await cdp.eval(`(() => {
    openReplenishmentModal();
  })()`);
  await sleep(600);
  await cdp.screenshot(path.join(ARTIFACT_DIR, 'audit_dark_modal_replenishment.png'));
  console.log('Captured: audit_dark_modal_replenishment.png');

  await cdp.eval(`(() => {
    document.getElementById('replenishmentModal').classList.add('hidden');
  })()`);
  await sleep(400);

  // 5. Backup Modal
  await cdp.eval(`(() => {
    const btn = document.getElementById('btnBackupModal');
    if (btn) btn.click();
  })()`);
  await sleep(600);
  await cdp.screenshot(path.join(ARTIFACT_DIR, 'audit_dark_modal_backup.png'));
  console.log('Captured: audit_dark_modal_backup.png');

  await cdp.eval(`(() => {
    document.getElementById('backupModal').classList.add('hidden');
  })()`);
  await sleep(400);
  await sleep(600);
  await cdp.screenshot(path.join(ARTIFACT_DIR, 'audit_dark_modal_move_dist.png'));
  console.log('Captured: audit_dark_modal_move_dist.png');

  // Clean up
  edgeProcess.kill();
  server.close();
  try {
    fs.rmSync(TEMP_USER_DATA, { recursive: true, force: true });
  } catch {}
  console.log('All audit screenshots saved to artifacts!');
}

run().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
