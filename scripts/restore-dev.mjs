#!/usr/bin/env node
/**
 * Restore development HTML files
 *
 * This script restores the original HTML files that reference /js/
 * instead of /js-prod/ for local development
 */

import { copyFileSync, existsSync, readdirSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');
const publicDir = join(rootDir, 'public');
const backupDir = join(rootDir, '.html-backup');

console.log('🔄 Restoring development HTML files...\n');

if (!existsSync(backupDir)) {
  console.log('ℹ️  No backups found - HTML files are already in development mode');
  process.exit(0);
}

// Restore all backed up files
function restoreFiles(dir) {
  const items = readdirSync(dir, { withFileTypes: true });
  let count = 0;

  for (const item of items) {
    const backupPath = join(dir, item.name);
    const originalPath = join(publicDir, backupPath.replace(backupDir, ''));

    if (item.isDirectory()) {
      count += restoreFiles(backupPath);
    } else if (item.name.endsWith('.html')) {
      copyFileSync(backupPath, originalPath);
      console.log(`  ✓ ${originalPath.replace(publicDir, '')}`);
      count++;
    }
  }

  return count;
}

const restoredCount = restoreFiles(backupDir);

// Clean up backup directory
rmSync(backupDir, { recursive: true, force: true });

console.log(`\n✅ Restored ${restoredCount} HTML file(s)`);
console.log('🛠️  Development mode ready\n');
