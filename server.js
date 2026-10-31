const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;

// Strict whitelist of public static web assets that the browser is allowed to request
const ALLOWED_PUBLIC_FILES = new Set([
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/sw.js',
  '/manifest.json',
  '/favicon.ico'
]);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  // Only allow GET and HEAD requests for static file serving
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method Not Allowed');
    return;
  }

  const urlPath = req.url.split('?')[0];

  // Enforce strict whitelist of publicly accessible application files
  if (!ALLOWED_PUBLIC_FILES.has(urlPath)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  const safePath = urlPath === '/' ? '/index.html' : urlPath;
  const filePath = path.normalize(path.join(__dirname, safePath));

  // Path traversal verification
  const rel = path.relative(__dirname, filePath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Content-Security-Policy': "default-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com data: blob:;"
    });
    if (req.method === 'HEAD') {
      res.end();
    } else {
      res.end(content);
    }
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

module.exports = server;
