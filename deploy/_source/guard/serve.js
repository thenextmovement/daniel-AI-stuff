#!/usr/bin/env node
/**
 * Minimal static file server for the deploy/ folder.
 * Used by Playwright webServer during LP guard tests.
 *
 * - Serves deploy/ as document root
 * - Pretty URLs: /leuchtreklame/ -> /leuchtreklame/index.html
 * - Returns 204 No Content for /api/c (so form POSTs don't error in tests)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.GUARD_PORT || 4321);
const ROOT = path.resolve(__dirname, '..', '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif':  'image/gif',
  '.ico':  'image/x-icon',
  '.mp4':  'video/mp4',
  '.webm': 'video/webm',
  '.woff2':'font/woff2',
  '.woff': 'font/woff',
  '.txt':  'text/plain; charset=utf-8',
  '.xml':  'application/xml; charset=utf-8',
};

const server = http.createServer((req, res) => {
  // Stub lead-intake endpoint so form submissions in tests don't 404
  if (req.url.startsWith('/api/c')) {
    res.writeHead(204);
    return res.end();
  }

  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  // Pretty URLs: /slug/ -> /slug/index.html
  if (urlPath.endsWith('/')) urlPath += 'index.html';

  const filePath = path.join(ROOT, urlPath);
  // Prevent path traversal
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); return res.end('Forbidden');
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found: ' + urlPath);
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`[guard-serve] http://localhost:${PORT}  root=${ROOT}`);
});
