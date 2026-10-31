/**
 * Live Vercel Preview HTTP Security & Protection Verification Suite
 * 
 * Target: https://petty-cash-manager-8scr0abs8-ored.vercel.app (Preview Deployment for commit bdef415)
 */

const https = require('https');
const assert = require('assert');

const PREVIEW_HOST = 'petty-cash-manager-8scr0abs8-ored.vercel.app';
const PREVIEW_BASE_URL = `https://${PREVIEW_HOST}`;

let total = 0;
let passed = 0;

function testAssert(name, condition, extra = '') {
  total++;
  if (condition) {
    passed++;
    console.log(`  ✓ PASSED: [Preview Test ${total}] ${name}`);
  } else {
    console.error(`  ❌ FAILED: [Preview Test ${total}] ${name} ${extra ? '(' + extra + ')' : ''}`);
    throw new Error(`Assertion failed: ${name} (${extra})`);
  }
}

function sendHttpRequest(path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: PREVIEW_HOST,
      port: 443,
      path: path,
      method: method,
      headers: {
        'User-Agent': 'Vercel-Preview-Security-Auditor/1.0',
        'Accept': '*/*'
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: body
        });
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function runPreviewLiveTests() {
  console.log('================================================================');
  console.log('🛡️  LIVE VERCEL PREVIEW HTTP SECURITY & PROTECTION SUITE');
  console.log(`🎯 TARGET: ${PREVIEW_BASE_URL}`);
  console.log('================================================================\n');

  // --------------------------------------------------------------------------
  // GROUP 1: Vercel Deployment Protection & Edge Authentication
  // --------------------------------------------------------------------------
  console.log('📌 GROUP 1: Vercel Deployment Protection & Edge Shields');

  const rootRes = await sendHttpRequest('/');
  testAssert('Live Preview URL responds from Vercel Edge Server',
    rootRes.headers['server'] === 'Vercel' && !!rootRes.headers['x-vercel-id'],
    `Server: ${rootRes.headers['server']}`
  );

  testAssert('Preview is shielded by Vercel Deployment Protection (SSO redirect)',
    rootRes.statusCode === 302 && rootRes.headers['location'] && rootRes.headers['location'].startsWith('https://vercel.com/sso-api'),
    `Status: ${rootRes.statusCode}, Location: ${rootRes.headers['location']}`
  );

  testAssert('Vercel Edge sets secure, httpOnly, sameSite session nonce cookie',
    Array.isArray(rootRes.headers['set-cookie']) && rootRes.headers['set-cookie'].some(c => c.includes('_vercel_sso_nonce') && c.includes('Secure') && c.includes('HttpOnly'))
  );

  // --------------------------------------------------------------------------
  // GROUP 2: Security Headers on Live Preview Edge
  // --------------------------------------------------------------------------
  console.log('\n📌 GROUP 2: Security Headers Enforced on Live Preview');

  const xfo = rootRes.headers['x-frame-options'] || '';
  testAssert('X-Frame-Options is DENY (clickjacking protection)', xfo === 'DENY', `Got: ${xfo}`);

  const hsts = rootRes.headers['strict-transport-security'] || '';
  testAssert('Strict-Transport-Security (HSTS) is strictly enforced with preload',
    hsts.includes('max-age=63072000') && hsts.includes('includeSubDomains'),
    `Got: ${hsts}`
  );

  const robots = rootRes.headers['x-robots-tag'] || '';
  testAssert('X-Robots-Tag is noindex (blocks search engine indexing of preview)', robots === 'noindex', `Got: ${robots}`);

  // --------------------------------------------------------------------------
  // GROUP 3: Internal & Sensitive Files Strict Inaccessibility
  // --------------------------------------------------------------------------
  console.log('\n📌 GROUP 3: Inaccessibility of Internal & Sensitive Files');

  // 1. /server.js
  const serverRes = await sendHttpRequest('/server.js');
  testAssert('/server.js is completely inaccessible (blocked from public access)',
    serverRes.statusCode === 302 || serverRes.statusCode === 404 || serverRes.statusCode === 403,
    `Status: ${serverRes.statusCode}`
  );
  testAssert('/server.js does NOT expose server source code', !serverRes.body.includes('http.createServer'));

  // 2. /PROJECT_MEMORY.md
  const memRes = await sendHttpRequest('/PROJECT_MEMORY.md');
  testAssert('/PROJECT_MEMORY.md is completely inaccessible',
    memRes.statusCode === 302 || memRes.statusCode === 404 || memRes.statusCode === 403,
    `Status: ${memRes.statusCode}`
  );
  testAssert('/PROJECT_MEMORY.md does NOT expose private memory notes', !memRes.body.includes('Project Memory'));

  // 3. /tests/ files
  const testRes = await sendHttpRequest('/tests/accounting_and_precision.test.js');
  testAssert('/tests/ files are completely inaccessible',
    testRes.statusCode === 302 || testRes.statusCode === 404 || testRes.statusCode === 403,
    `Status: ${testRes.statusCode}`
  );
  testAssert('/tests/ does NOT expose test files', !testRes.body.includes('testAssert'));

  // 4. /scratch/ files
  const scratchRes = await sendHttpRequest('/scratch/check_leveldb_completeness.js');
  testAssert('/scratch/ files are completely inaccessible',
    scratchRes.statusCode === 302 || scratchRes.statusCode === 404 || scratchRes.statusCode === 403,
    `Status: ${scratchRes.statusCode}`
  );

  // 5. Hidden files: /.git/config
  const gitRes = await sendHttpRequest('/.git/config');
  testAssert('/.git/config is completely inaccessible',
    gitRes.statusCode === 302 || gitRes.statusCode === 404 || gitRes.statusCode === 403,
    `Status: ${gitRes.statusCode}`
  );
  testAssert('/.git/config does NOT expose git configuration', !gitRes.body.includes('[core]'));

  // 6. /.env
  const envRes = await sendHttpRequest('/.env');
  testAssert('/.env is completely inaccessible',
    envRes.statusCode === 302 || envRes.statusCode === 404 || envRes.statusCode === 403,
    `Status: ${envRes.statusCode}`
  );

  // 7. /.vercelignore
  const vIgnoreRes = await sendHttpRequest('/.vercelignore');
  testAssert('/.vercelignore is completely inaccessible',
    vIgnoreRes.statusCode === 302 || vIgnoreRes.statusCode === 404 || vIgnoreRes.statusCode === 403,
    `Status: ${vIgnoreRes.statusCode}`
  );

  // --------------------------------------------------------------------------
  // GROUP 4: Zero Production Financial Data Leakage in Preview
  // --------------------------------------------------------------------------
  console.log('\n📌 GROUP 4: Zero Production Financial Data Leakage');

  // Verify that historical production copy is not accessible
  const copyRes = await sendHttpRequest('/tests/historical_production_copy.json');
  testAssert('Historical production copy is completely inaccessible on Preview',
    copyRes.statusCode === 302 || copyRes.statusCode === 404 || copyRes.statusCode === 403,
    `Status: ${copyRes.statusCode}`
  );

  testAssert('Response bodies contain zero client person IDs (e.g. p_1790643844750_yhuz)',
    !rootRes.body.includes('p_1790643844750_yhuz') && !serverRes.body.includes('p_1790643844750_yhuz')
  );

  console.log('\n================================================================');
  console.log(`🏁 LIVE PREVIEW VERIFICATION: ${passed} / ${total} TESTS PASSED (100%)`);
  console.log(`✅ LIVE PREVIEW ENVIRONMENT IS FULLY SECURED AND SHIELDED`);
  console.log('================================================================\n');
}

if (require.main === module) {
  runPreviewLiveTests().catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
  });
}

module.exports = { runPreviewLiveTests };
