#!/usr/bin/env node
import { existsSync, readdirSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');
const bundleDir = join(rootDir, 'public', 'assets', 'js-prod');

const maxBytesRaw = process.env.MAX_BUNDLE_SIZE_BYTES;
const maxBytes = Number.isFinite(Number(maxBytesRaw)) ? Number(maxBytesRaw) : 1_500_000;

if (!existsSync(bundleDir)) {
  console.error(`Bundle output not found at ${bundleDir}`);
  console.error('Run "npm run build:prod" before checking bundle size.');
  process.exit(1);
}

const files = [];

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
    } else {
      files.push(fullPath);
    }
  }
}

walk(bundleDir);

const measured = files
  .map(path => {
    const stats = statSync(path);
    return { path, size: stats.size };
  })
  .sort((a, b) => b.size - a.size);

const totalBytes = measured.reduce((sum, file) => sum + file.size, 0);
const totalMb = (totalBytes / (1024 * 1024)).toFixed(2);

console.log(`Bundle size: ${totalBytes} bytes (${totalMb} MB)`);
console.log(`Max allowed: ${maxBytes} bytes`);

if (measured.length > 0) {
  console.log('Largest files:');
  measured.slice(0, 5).forEach(file => {
    const sizeKb = (file.size / 1024).toFixed(1);
    console.log(`- ${file.path.replace(`${rootDir}\\`, '')} (${sizeKb} KB)`);
  });
}

if (totalBytes > maxBytes) {
  console.error('Bundle size exceeds limit.');
  process.exit(1);
}
