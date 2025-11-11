/* eslint-env node */
/* global require:readonly, __dirname:readonly, console:readonly */
/* eslint-disable no-console */
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 8000;
const publicDir = path.join(__dirname, '..', 'public');
const reportsDir = path.join(__dirname, '..', 'reports');

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = mimeTypes[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 - File Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('500 - Internal Server Error');
      }
    } else {
      res.writeHead(200, { 'Content-Type': mimeType });
      res.end(content);
    }
  });
}

const server = http.createServer((req, res) => {
  const { pathname: parsedPathname = '/' } = url.parse(req.url, true);
  let pathname = parsedPathname || '/';

  try {
    pathname = decodeURIComponent(pathname);
  } catch (error) {
    console.warn('Failed to decode request pathname', { parsedPathname, error: error?.message || error });
  }

  if (!pathname.startsWith('/')) {
    pathname = `/${pathname}`;
  }

  let normalizedPathname = path.posix.normalize(pathname);
  if (!normalizedPathname.startsWith('/')) {
    normalizedPathname = `/${normalizedPathname}`;
  }

  pathname = normalizedPathname;

  // Handle API routes - return 404 instead of index.html fallback
  if (pathname.startsWith('/api/')) {
    console.log('API route not implemented:', pathname);
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'API endpoint not available in dev server' }));
    return;
  }

  // Handle reports directory - serve from parent directory's reports folder
  if (pathname.startsWith('/reports/')) {
    const reportPath = pathname.replace(/^\/reports\//, '');
    const fullReportPath = path.join(reportsDir, reportPath);
    
    console.log('Report request:', pathname, '-> reportPath:', fullReportPath);
    
    // Security check
    if (!fullReportPath.startsWith(reportsDir)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('403 - Forbidden');
      return;
    }
    
    fs.access(fullReportPath, fs.constants.F_OK, err => {
      if (err) {
        console.log('  Report file not found:', fullReportPath);
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Report not found' }));
      } else {
        console.log('  Report file found, serving:', fullReportPath);
        serveFile(res, fullReportPath);
      }
    });
    return;
  }

  // Handle hosting rewrites for /card routes
  if (pathname === '/card' || pathname === '/card/') {
    console.log('Rewrite: /card -> card.html');
    serveFile(res, path.join(publicDir, 'card.html'));
    return;
  }

  if (pathname.startsWith('/card/')) {
    // Serve card.html for /card/* routes
    console.log('Rewrite: /card/* -> card.html', pathname);
    serveFile(res, path.join(publicDir, 'card.html'));
    return;
  }

  // Handle archetype routes
  if (pathname === '/archetype' || pathname === '/archetype/') {
    console.log('Redirect: /archetype -> /archetypes');
    res.writeHead(301, { Location: '/archetypes' });
    res.end();
    return;
  }

  if (pathname.startsWith('/archetype/')) {
    // Serve archetype.html for /archetype/* routes
    console.log('Rewrite: /archetype/* -> archetype.html', pathname);
    serveFile(res, path.join(publicDir, 'archetype.html'));
    return;
  }

  // Handle root path
  if (pathname === '/') {
    pathname = '/index.html';
  }

  const relativePath = pathname === '/' ? '' : pathname.replace(/^\/+/, '');
  const resolvedPath = path.resolve(publicDir, relativePath || '.');

  if (!resolvedPath.startsWith(publicDir)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 - Forbidden');
    return;
  }

  let filePath = resolvedPath === publicDir ? path.join(publicDir, 'index.html') : resolvedPath;

  console.log('Request:', pathname, '-> filePath:', filePath);

  // Check if file exists
  fs.access(filePath, fs.constants.F_OK, err => {
    if (err) {
      // If no extension, try adding .html
      if (!path.extname(filePath)) {
        const htmlPath = filePath + '.html';
        console.log('  No extension found, trying:', htmlPath);
        fs.access(htmlPath, fs.constants.F_OK, htmlErr => {
          if (htmlErr) {
            // Only serve index.html as fallback for HTML routes (not JSON, images, etc.)
            const acceptHeader = req.headers.accept || '';
            const isJsonRequest = acceptHeader.includes('application/json');
            const hasFileExtension = pathname.includes('.');
            
            if (isJsonRequest || hasFileExtension) {
              console.log('  File not found, returning 404');
              res.writeHead(404, { 'Content-Type': 'text/plain' });
              res.end('404 - File Not Found');
            } else {
              console.log('  .html file not found, serving index.html as fallback');
              serveFile(res, path.join(publicDir, 'index.html'));
            }
          } else {
            console.log('  Found .html file, serving:', htmlPath);
            serveFile(res, htmlPath);
          }
        });
      } else {
        // File has extension but doesn't exist
        const ext = path.extname(filePath);
        // Only serve index.html fallback for extensionless or .html requests
        if (ext === '.html' || !ext) {
          console.log('  HTML file not found, serving index.html as fallback');
          serveFile(res, path.join(publicDir, 'index.html'));
        } else {
          console.log('  File not found, returning 404:', filePath);
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('404 - File Not Found');
        }
      }
    } else {
      console.log('  File found, serving:', filePath);
      serveFile(res, filePath);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/`);
  console.log('Hosting rewrites enabled:');
  console.log('  /card/* -> card.html');
  console.log('  /** -> index.html (fallback)');
});
