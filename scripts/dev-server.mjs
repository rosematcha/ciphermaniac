#!/usr/bin/env node
import { createReadStream, existsSync, statSync } from 'fs';
import { createServer } from 'http';
import https from 'https';
import { extname, join, normalize, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');
const rootDir = resolve(__dirname, '..');
const publicDir = join(rootDir, 'public');
const port = Number(process.env.PORT || 3000);
const R2_BASE = 'https://r2.ciphermaniac.com';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8'
};

function getContentType(filePath) {
  return MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function resolvePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  if (decoded === '/' || decoded === '') {
    return join(publicDir, 'index.html');
  }
  const normalized = normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const candidate = resolve(publicDir, `.${normalized}`);
  if (!candidate.startsWith(publicDir)) {
    return null;
  }
  if (existsSync(`${candidate}.html`)) {
    return `${candidate}.html`;
  }
  if (existsSync(candidate) && statSync(candidate).isDirectory()) {
    const indexPath = join(candidate, 'index.html');
    return existsSync(indexPath) ? indexPath : null;
  }
  // SPA-like fallbacks for extensionless routes (e.g., /card/ABC-123, /Gardevoir_ex)
  if (!extname(candidate)) {
    const parts = normalized.split('/').filter(Boolean);
    if (parts[0] === 'card') {
      return join(publicDir, 'card.html');
    }
    if (parts[0] === 'archetype' || parts.length === 1) {
      return join(publicDir, 'archetype.html');
    }
  }
  return candidate;
}

const server = createServer((req, res) => {
  const reqUrl = req.url || '/';

  // Proxy R2 report assets to avoid stale placeholders in dev
  if (reqUrl.startsWith('/reports/')) {
    const target = new URL(reqUrl, R2_BASE);
    https
      .get(target, proxyRes => {
        res.writeHead(proxyRes.statusCode || 502, proxyRes.headers || {});
        proxyRes.pipe(res);
      })
      .on('error', error => {
        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`Upstream fetch failed: ${error.message}`);
      });
    return;
  }

  const filePath = resolvePath(req.url || '/');
  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  res.writeHead(200, { 'Content-Type': getContentType(filePath) });
  createReadStream(filePath).pipe(res);
});

server.listen(port, () => {
  console.log(`Dev server running at http://localhost:${port}`);
});
