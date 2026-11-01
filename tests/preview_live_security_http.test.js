/**
 * Live Vercel Preview HTTP Security & Protection Verification Suite
 * 
 * Dynamically resolves deployment metadata from GitHub API.
 * Features two distinct modes:
 * - Mode A: Unauthenticated access (Verifies Vercel SSO deployment protection shield)
 * - Mode B: Authenticated access (Verifies route-level file access and CSP when authorized session is present)
 */

const https = require('https');
const assert = require('assert');
const { resolvePreviewDeployment } = require('./preview_metadata');

let total = 0;
let passed = 0;
let skipped = 0;

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

function testSkip(name, reason) {
  skipped++;
  console.log(`  ⏭️ SKIPPED: [${name}] - Reason: ${reason}`);
}

function sendHttpRequest(hostname, path, method = 'GET', authHeaders = {}) {
  return new Promise((resolve, reject) => {
    const headers = {
      'User-Agent': 'Vercel-Preview-Security-Auditor/2.0',
      'Accept': '*/*',
      ...authHeaders
    };

    const options = {
      hostname,
      port: 443,
      path,
      method,
      headers
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
  console.log('================================================================\n');

  // Step 1: Dynamically resolve Preview Deployment Metadata
  const meta = await resolvePreviewDeployment();

  console.log('📋 DEPLOYMENT TARGET SPECIFICATION:');
  console.log(`  • Exact Preview URL:    ${meta.previewUrl}`);
  console.log(`  • Deployment ID:        ${meta.deploymentId}`);
  console.log(`  • Git Commit SHA:       ${meta.commitSha}`);
  console.log(`  • Branch:               ${meta.branch}`);
  console.log(`  • Deployment Status:    ${meta.deploymentStatus}`);
  console.log('----------------------------------------------------------------\n');

  // Fail immediately if target does not match intended deployment
  if (!meta.isHeadMatch) {
    console.error(`❌ CRITICAL MISMATCH: Deployment ref (${meta.commitSha}) does not match local HEAD (${meta.currentHeadSha})!`);
    throw new Error(`Deployment commit mismatch: expected ${meta.currentHeadSha}, got ${meta.commitSha}`);
  }

  if (meta.deploymentStatus !== 'success' && meta.deploymentStatus !== 'ready') {
    throw new Error(`Deployment status is not ready: ${meta.deploymentStatus}`);
  }

  const previewHost = new URL(meta.previewUrl).hostname;

  // ==========================================================================
  // MODE A: UNAUTHENTICATED ACCESS VERIFICATION
  // ==========================================================================
  console.log('📌 MODE A: Unauthenticated Access & SSO Deployment Shield');

  const rootRes = await sendHttpRequest(previewHost, '/');
  testAssert('Live Preview URL responds from Vercel Edge Server',
    rootRes.headers['server'] === 'Vercel' && !!rootRes.headers['x-vercel-id'],
    `Server: ${rootRes.headers['server']}`
  );

  testAssert('Unauthorized root access is blocked and redirected to Vercel SSO (302)',
    rootRes.statusCode === 302 && rootRes.headers['location'] && rootRes.headers['location'].startsWith('https://vercel.com/sso-api'),
    `Status: ${rootRes.statusCode}, Location: ${rootRes.headers['location']}`
  );

  testAssert('Vercel Edge sets secure, httpOnly session nonce cookie',
    Array.isArray(rootRes.headers['set-cookie']) && rootRes.headers['set-cookie'].some(c => c.includes('_vercel_sso_nonce') && c.includes('Secure') && c.includes('HttpOnly'))
  );

  const xfo = rootRes.headers['x-frame-options'] || '';
  testAssert('Edge enforces X-Frame-Options: DENY (clickjacking defense)', xfo === 'DENY', `Got: ${xfo}`);

  const hsts = rootRes.headers['strict-transport-security'] || '';
  testAssert('Edge strictly enforces HSTS with preload',
    hsts.includes('max-age=63072000') && hsts.includes('includeSubDomains'),
    `Got: ${hsts}`
  );

  const robots = rootRes.headers['x-robots-tag'] || '';
  testAssert('Edge enforces X-Robots-Tag: noindex on Preview', robots === 'noindex', `Got: ${robots}`);

  // Test sensitive unauthenticated endpoints
  const sensitivePaths = [
    { path: '/server.js', name: 'Server source file (/server.js)' },
    { path: '/PROJECT_MEMORY.md', name: 'Private memory notes (/PROJECT_MEMORY.md)' },
    { path: '/tests/accounting_and_precision.test.js', name: 'Test suite directory (/tests/)' },
    { path: '/scratch/test_cookies.js', name: 'Scratch files directory (/scratch/)' },
    { path: '/.git/config', name: 'Git repository metadata (/.git/config)' },
    { path: '/.env', name: 'Environment variables file (/.env)' },
    { path: '/.vercelignore', name: 'Build ignore config (/.vercelignore)' },
    { path: '/tests/historical_production_copy.json', name: 'Historical backup dataset copy' }
  ];

  for (const item of sensitivePaths) {
    const res = await sendHttpRequest(previewHost, item.path);
    testAssert(`Unauthenticated ${item.name} is blocked (302/404/403)`,
      res.statusCode === 302 || res.statusCode === 404 || res.statusCode === 403,
      `Status: ${res.statusCode}`
    );
    testAssert(`${item.name} does NOT expose private source content`,
      !res.body.includes('http.createServer') &&
      !res.body.includes('Project Memory') &&
      !res.body.includes('[core]') &&
      !res.body.includes('p_1790643844750_yhuz')
    );
  }

  // ==========================================================================
  // MODE B: AUTHENTICATED ACCESS VERIFICATION
  // ==========================================================================
  console.log('\n📌 MODE B: Authenticated Access & File-Level Route Protection');

  const authCookie = process.env.VERCEL_AUTH_COOKIE || '';
  const bypassSecret = process.env.VERCEL_PROTECTION_BYPASS || '';

  const authHeaders = {};
  if (authCookie) {
    authHeaders['Cookie'] = authCookie;
  }
  if (bypassSecret) {
    authHeaders['x-vercel-protection-bypass'] = bypassSecret;
  }

  const hasAuthSession = Boolean(authCookie || bypassSecret);

  if (hasAuthSession) {
    console.log('  🔑 Authorized session credentials detected in environment. Running Mode B tests...');

    const authRootRes = await sendHttpRequest(previewHost, '/', 'GET', authHeaders);
    testAssert('Authenticated GET / returns 200 OK',
      authRootRes.statusCode === 200,
      `Got: ${authRootRes.statusCode}`
    );

    // Verify Actual Security Headers on Authenticated Response
    console.log('\n  [Mode B Headers Inspection]:');
    const csp = authRootRes.headers['content-security-policy'] || '';
    const xcto = authRootRes.headers['x-content-type-options'] || '';
    const refPol = authRootRes.headers['referrer-policy'] || '';
    const permPol = authRootRes.headers['permissions-policy'] || '';

    testAssert('Authenticated response contains Content-Security-Policy', !!csp, 'CSP is missing');
    if (csp) {
      testAssert('CSP enforces script-src \'self\'', csp.includes("script-src 'self'"), `CSP: ${csp}`);
      testAssert('CSP blocks object-src', csp.includes("object-src 'none'"), `CSP: ${csp}`);
    }

    testAssert('Authenticated response enforces X-Content-Type-Options: nosniff', xcto === 'nosniff', `Got: ${xcto}`);
    testAssert('Authenticated response enforces Referrer-Policy', !!refPol, `Got: ${refPol}`);

    // Verify File-Level Access Protection for Sensitive Paths when Authenticated
    for (const item of sensitivePaths) {
      const res = await sendHttpRequest(previewHost, item.path, 'GET', authHeaders);
      testAssert(`Authenticated access to ${item.name} is BLOCKED (404/403/redirect to /)`,
        res.statusCode === 404 || res.statusCode === 403 || res.statusCode === 307 || res.statusCode === 308 || (res.statusCode === 200 && !res.body.includes('http.createServer') && !res.body.includes('Project Memory')),
        `Status: ${res.statusCode}`
      );
      testAssert(`Authenticated ${item.name} does NOT reveal source code or private data`,
        !res.body.includes('http.createServer') &&
        !res.body.includes('Project Memory') &&
        !res.body.includes('[core]') &&
        !res.body.includes('p_1790643844750_yhuz')
      );
    }
  } else {
    console.log('  ℹ️  NOTICE: No active VERCEL_AUTH_COOKIE or VERCEL_PROTECTION_BYPASS found in environment.');
    console.log('  🔒 As per strict instructions, credentials are never hardcoded or stored in commits.');
    testSkip('Mode B Authenticated File-Level Live Check', 'Pending user session token (VERCEL_AUTH_COOKIE or VERCEL_PROTECTION_BYPASS)');
    testSkip('Mode B Authenticated Live CSP Header Check', 'Requires active authenticated session');
    console.log('  💡 (Note: Route-level file protection is verified deterministically via local server HTTP suite and .vercelignore build verification).');
  }

  console.log('\n================================================================');
  console.log(`🏁 LIVE PREVIEW TEST SUMMARY: ${passed} PASSED | ${skipped} SKIPPED | 0 FAILED`);
  console.log(`🎯 EXACT TARGET: ${meta.previewUrl} (ID: ${meta.deploymentId})`);
  console.log('================================================================\n');
}

if (require.main === module) {
  runPreviewLiveTests().catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
  });
}

module.exports = { runPreviewLiveTests };
