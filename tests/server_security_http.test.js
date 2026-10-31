/**
 * Real HTTP Security & Static Asset Server Test Suite
 * Tests actual HTTP requests against live running server.js instance.
 * Verifies HTTP status codes, headers, response bodies, and security defenses.
 */

const assert = require('assert');
const http = require('http');
const path = require('path');
const server = require('../server.js');

const TEST_PORT = 8091;

function makeRequest(method, requestPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: requestPath,
      method: method,
      headers: headers
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
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

async function runServerHttpTests() {
  console.log('================================================================');
  console.log('🛡️  REAL HTTP REQUESTS SECURITY TEST SUITE (server.js)');
  console.log('================================================================\n');

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

  // Start the server
  await new Promise((resolve) => {
    server.listen(TEST_PORT, '127.0.0.1', () => {
      console.log(`[Setup] Test server listening on http://127.0.0.1:${TEST_PORT}\n`);
      resolve();
    });
  });

  try {
    // ------------------------------------------------------------------------
    // Group 1: Legitimate Public Static Assets (200 OK + Proper MIME)
    // ------------------------------------------------------------------------
    console.log('📌 GROUP 1: Whitelisted Public Assets (Expected 200 OK)');

    const resRoot = await makeRequest('GET', '/');
    testAssert('GET / returns 200 OK and serves index.html',
      resRoot.statusCode === 200 &&
      resRoot.headers['content-type'].includes('text/html') &&
      resRoot.body.includes('<!DOCTYPE html>'),
      `Status: ${resRoot.statusCode}`
    );

    const resIndex = await makeRequest('GET', '/index.html');
    testAssert('GET /index.html returns 200 OK and HTML body',
      resIndex.statusCode === 200 &&
      resIndex.headers['content-type'].includes('text/html') &&
      resIndex.body.includes('<!DOCTYPE html>'),
      `Status: ${resIndex.statusCode}`
    );

    const resCss = await makeRequest('GET', '/styles.css');
    testAssert('GET /styles.css returns 200 OK with text/css',
      resCss.statusCode === 200 &&
      resCss.headers['content-type'].includes('text/css') &&
      resCss.body.length > 100,
      `Status: ${resCss.statusCode}`
    );

    const resAppJs = await makeRequest('GET', '/app.js');
    testAssert('GET /app.js returns 200 OK with application/javascript',
      resAppJs.statusCode === 200 &&
      resAppJs.headers['content-type'].includes('application/javascript') &&
      resAppJs.body.includes('state'),
      `Status: ${resAppJs.statusCode}`
    );

    const resSw = await makeRequest('GET', '/sw.js');
    testAssert('GET /sw.js returns 200 OK with application/javascript',
      resSw.statusCode === 200 &&
      resSw.headers['content-type'].includes('application/javascript') &&
      resSw.body.includes('CACHE_NAME'),
      `Status: ${resSw.statusCode}`
    );

    const resManifest = await makeRequest('GET', '/manifest.json');
    testAssert('GET /manifest.json returns 200 OK with application/json',
      resManifest.statusCode === 200 &&
      resManifest.headers['content-type'].includes('application/json'),
      `Status: ${resManifest.statusCode}`
    );

    // Security Headers on whitelisted assets
    testAssert('Security headers present: CSP, X-Frame-Options, X-Content-Type-Options',
      resIndex.headers['content-security-policy'] &&
      resIndex.headers['x-frame-options'] === 'DENY' &&
      resIndex.headers['x-content-type-options'] === 'nosniff',
      `Headers: ${JSON.stringify(resIndex.headers)}`
    );

    // HEAD method on legitimate asset
    const resHead = await makeRequest('HEAD', '/index.html');
    testAssert('HEAD /index.html returns 200 OK with empty body',
      resHead.statusCode === 200 && resHead.body === '',
      `Status: ${resHead.statusCode}, Body length: ${resHead.body.length}`
    );

    // ------------------------------------------------------------------------
    // Group 2: Internal and Sensitive Files (Expected 403 Forbidden)
    // ------------------------------------------------------------------------
    console.log('\n📌 GROUP 2: Internal & Sensitive Files (Expected 403 Forbidden)');

    const resMemory = await makeRequest('GET', '/PROJECT_MEMORY.md');
    testAssert('GET /PROJECT_MEMORY.md is blocked (403 Forbidden)',
      resMemory.statusCode === 403 && resMemory.body.includes('Forbidden'),
      `Status: ${resMemory.statusCode}`
    );

    const resServerJs = await makeRequest('GET', '/server.js');
    testAssert('GET /server.js is blocked (403 Forbidden)',
      resServerJs.statusCode === 403 && resServerJs.body.includes('Forbidden'),
      `Status: ${resServerJs.statusCode}`
    );

    const resGitConfig = await makeRequest('GET', '/.git/config');
    testAssert('GET /.git/config is blocked (403 Forbidden)',
      resGitConfig.statusCode === 403 && resGitConfig.body.includes('Forbidden'),
      `Status: ${resGitConfig.statusCode}`
    );

    const resGitignore = await makeRequest('GET', '/.gitignore');
    testAssert('GET /.gitignore is blocked (403 Forbidden)',
      resGitignore.statusCode === 403 && resGitignore.body.includes('Forbidden'),
      `Status: ${resGitignore.statusCode}`
    );

    const resEnv = await makeRequest('GET', '/.env');
    testAssert('GET /.env is blocked (403 Forbidden)',
      resEnv.statusCode === 403 && resEnv.body.includes('Forbidden'),
      `Status: ${resEnv.statusCode}`
    );

    const resPackageJson = await makeRequest('GET', '/package.json');
    testAssert('GET /package.json is blocked (403 Forbidden)',
      resPackageJson.statusCode === 403 && resPackageJson.body.includes('Forbidden'),
      `Status: ${resPackageJson.statusCode}`
    );

    // ------------------------------------------------------------------------
    // Group 3: Directory Traversal Attacks (Expected 403 Forbidden)
    // ------------------------------------------------------------------------
    console.log('\n📌 GROUP 3: Directory Traversal Attacks (Expected 403 Forbidden)');

    const resTraversal1 = await makeRequest('GET', '/../server.js');
    testAssert('GET /../server.js is blocked (403 Forbidden)',
      resTraversal1.statusCode === 403 && resTraversal1.body.includes('Forbidden'),
      `Status: ${resTraversal1.statusCode}`
    );

    const resTraversal2 = await makeRequest('GET', '/../../etc/passwd');
    testAssert('GET /../../etc/passwd is blocked (403 Forbidden)',
      resTraversal2.statusCode === 403 && resTraversal2.body.includes('Forbidden'),
      `Status: ${resTraversal2.statusCode}`
    );

    const resTraversalBackslash = await makeRequest('GET', '/..\\server.js');
    testAssert('GET /..\\server.js is blocked (403 Forbidden)',
      resTraversalBackslash.statusCode === 403 && resTraversalBackslash.body.includes('Forbidden'),
      `Status: ${resTraversalBackslash.statusCode}`
    );

    // ------------------------------------------------------------------------
    // Group 4: Encoded & Obfuscated Traversal Attacks (Expected 403 Forbidden)
    // ------------------------------------------------------------------------
    console.log('\n📌 GROUP 4: Encoded Traversal Attacks (Expected 403 Forbidden)');

    const resEncoded1 = await makeRequest('GET', '/%2e%2e/server.js');
    testAssert('GET /%2e%2e/server.js (URL-encoded) is blocked (403 Forbidden)',
      resEncoded1.statusCode === 403 && resEncoded1.body.includes('Forbidden'),
      `Status: ${resEncoded1.statusCode}`
    );

    const resEncoded2 = await makeRequest('GET', '/%2e%2e%2fpackage.json');
    testAssert('GET /%2e%2e%2fpackage.json (URL-encoded slash) is blocked (403 Forbidden)',
      resEncoded2.statusCode === 403 && resEncoded2.body.includes('Forbidden'),
      `Status: ${resEncoded2.statusCode}`
    );

    const resDoubleEncoded = await makeRequest('GET', '/%252e%252e%252fserver.js');
    testAssert('GET /%252e%252e%252fserver.js (Double-encoded) is blocked (403 Forbidden)',
      resDoubleEncoded.statusCode === 403 && resDoubleEncoded.body.includes('Forbidden'),
      `Status: ${resDoubleEncoded.statusCode}`
    );

    const resNullByte = await makeRequest('GET', '/index.html%00.jpg');
    testAssert('GET /index.html%00.jpg (Null byte injection) is blocked (403 Forbidden)',
      resNullByte.statusCode === 403 && resNullByte.body.includes('Forbidden'),
      `Status: ${resNullByte.statusCode}`
    );

    const resTrailingSpace = await makeRequest('GET', '/app.js%20');
    testAssert('GET /app.js%20 (Trailing space) is blocked (403 Forbidden)',
      resTrailingSpace.statusCode === 403 && resTrailingSpace.body.includes('Forbidden'),
      `Status: ${resTrailingSpace.statusCode}`
    );

    // ------------------------------------------------------------------------
    // Group 5: Unsupported HTTP Methods (Expected 405 Method Not Allowed)
    // ------------------------------------------------------------------------
    console.log('\n📌 GROUP 5: Unsupported HTTP Methods (Expected 405 Method Not Allowed)');

    const resPost = await makeRequest('POST', '/index.html');
    testAssert('POST /index.html returns 405 Method Not Allowed',
      resPost.statusCode === 405 && resPost.body.includes('Method Not Allowed'),
      `Status: ${resPost.statusCode}`
    );

    const resPut = await makeRequest('PUT', '/styles.css');
    testAssert('PUT /styles.css returns 405 Method Not Allowed',
      resPut.statusCode === 405 && resPut.body.includes('Method Not Allowed'),
      `Status: ${resPut.statusCode}`
    );

    const resDelete = await makeRequest('DELETE', '/app.js');
    testAssert('DELETE /app.js returns 405 Method Not Allowed',
      resDelete.statusCode === 405 && resDelete.body.includes('Method Not Allowed'),
      `Status: ${resDelete.statusCode}`
    );

    const resPatch = await makeRequest('PATCH', '/index.html');
    testAssert('PATCH /index.html returns 405 Method Not Allowed',
      resPatch.statusCode === 405 && resPatch.body.includes('Method Not Allowed'),
      `Status: ${resPatch.statusCode}`
    );

    console.log('\n================================================================');
    console.log(`🏁 REAL HTTP SECURITY RESULTS: ${passed} / ${total} TESTS PASSED`);
    if (passed === total) {
      console.log('✅ ALL HTTP REQUEST SECURITY TESTS PASSED WITH 100% SUCCESS');
    } else {
      console.log(`❌ SOME HTTP SECURITY TESTS FAILED (${total - passed} failures)`);
    }
    console.log('================================================================\n');

  } finally {
    server.close();
  }
}

if (require.main === module) {
  runServerHttpTests();
}

module.exports = { runServerHttpTests };
