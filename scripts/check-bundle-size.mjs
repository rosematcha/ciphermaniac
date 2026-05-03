#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');
const bundleDir = join(rootDir, 'public', 'assets', 'js-prod');
const historyFile = join(rootDir, '.bundlesize-history.json');

const maxBytesRaw = process.env.MAX_BUNDLE_SIZE_BYTES;
const maxBytes = Number.isFinite(Number(maxBytesRaw)) ? Number(maxBytesRaw) : 1_500_000;
const perFileLimitBytes = 300_000;

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
  .map(filePath => {
    const stats = statSync(filePath);
    return { path: filePath, rel: relative(rootDir, filePath), size: stats.size };
  })
  .sort((a, b) => b.size - a.size);

const totalBytes = measured.reduce((sum, f) => sum + f.size, 0);
const totalMb = (totalBytes / (1024 * 1024)).toFixed(2);

// Load previous snapshot for diff display
let prev = null;
if (existsSync(historyFile)) {
  try {
    const history = JSON.parse(readFileSync(historyFile, 'utf8'));
    if (Array.isArray(history) && history.length > 0) {
      prev = history[history.length - 1];
    }
  } catch {
    // corrupt history — ignore
  }
}

const prevMap = new Map((prev?.files ?? []).map(f => [f.rel, f.size]));

// Print table
const colWidth = 60;
console.log(`\nBundle size report — ${new Date().toISOString()}`);
console.log('─'.repeat(80));
console.log(`${'File'.padEnd(colWidth)} ${'Size'.padStart(10)}  ${'Δ vs prev'.padStart(12)}`);
console.log('─'.repeat(80));

let anyOverPerFileLimit = false;
for (const f of measured) {
  const sizeKb = (f.size / 1024).toFixed(1);
  const prevSize = prevMap.get(f.rel);
  let delta = '';
  if (prevSize != null) {
    const diff = f.size - prevSize;
    const sign = diff >= 0 ? '+' : '';
    delta = `${sign}${(diff / 1024).toFixed(1)} KB`;
    if (diff > 0) {
      delta = `\x1b[33m${delta}\x1b[0m`;
    } else if (diff < 0) {
      delta = `\x1b[32m${delta}\x1b[0m`;
    }
  } else {
    delta = '(new)';
  }
  const overLimit = f.size > perFileLimitBytes ? ' \x1b[31m[OVER LIMIT]\x1b[0m' : '';
  if (f.size > perFileLimitBytes) {
    anyOverPerFileLimit = true;
  }
  console.log(`${f.rel.padEnd(colWidth)} ${`${sizeKb} KB`.padStart(10)}  ${delta.padStart(12)}${overLimit}`);
}

console.log('─'.repeat(80));
const prevTotal = prev?.totalBytes;
const totalDelta =
  prevTotal != null
    ? (() => {
        const diff = totalBytes - prevTotal;
        const sign = diff >= 0 ? '+' : '';
        return ` (${sign}${(diff / 1024).toFixed(1)} KB vs prev)`;
      })()
    : '';
console.log(`${'TOTAL'.padEnd(colWidth)} ${`${totalMb} MB`.padStart(10)}${totalDelta}`);
console.log(`Max allowed: ${(maxBytes / (1024 * 1024)).toFixed(2)} MB\n`);

// Persist snapshot
const snapshot = {
  timestamp: new Date().toISOString(),
  totalBytes,
  files: measured.map(f => ({ rel: f.rel, size: f.size }))
};
try {
  const history = existsSync(historyFile) ? JSON.parse(readFileSync(historyFile, 'utf8')) : [];
  history.push(snapshot);
  // Keep last 50 snapshots
  if (history.length > 50) {
    history.splice(0, history.length - 50);
  }
  writeFileSync(historyFile, JSON.stringify(history, null, 2));
} catch {
  // Non-fatal — tracking is best-effort
}

if (totalBytes > maxBytes) {
  console.error('\x1b[31mTotal bundle size exceeds limit.\x1b[0m');
  process.exit(1);
}

if (anyOverPerFileLimit) {
  console.warn(
    `\x1b[33mOne or more files exceed the ${(perFileLimitBytes / 1024).toFixed(0)} KB per-file guideline.\x1b[0m`
  );
}
