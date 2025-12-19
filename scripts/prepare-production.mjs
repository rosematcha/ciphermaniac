#!/usr/bin/env node
/**
 * Prepare production deployment
 *
 * This script:
 * 1. Runs the production build (strips debug code)
 * 2. Replaces references in HTML files to use /js-prod/ instead of /js/
 * 3. Creates a backup of HTML files for restoration
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');
const publicDir = join(rootDir, 'public');
const backupDir = join(rootDir, '.html-backup');

console.log('🚀 Preparing production deployment...\n');

// Step 1: Build production bundle
console.log('📦 Building production bundle...');
try {
  execSync('npm run build:prod', { stdio: 'inherit', cwd: rootDir });
} catch {
  console.error('❌ Production build failed');
  process.exit(1);
}

// Step 2: Update HTML files to use production JS
console.log('\n📝 Updating HTML files to use production JavaScript...');

// Create backup directory
if (!existsSync(backupDir)) {
  mkdirSync(backupDir, { recursive: true });
}

// Find all HTML files in public directory
function findHtmlFiles(dir, baseDir = dir) {
  const files = [];
  const items = readdirSync(dir, { withFileTypes: true });

  for (const item of items) {
    const fullPath = join(dir, item.name);

    // Skip backup and node_modules
    if (item.name === 'node_modules' || fullPath.includes('.html-backup')) {
      continue;
    }

    if (item.isDirectory()) {
      files.push(...findHtmlFiles(fullPath, baseDir));
    } else if (item.name.endsWith('.html')) {
      files.push(fullPath);
    }
  }

  return files;
}

const htmlFiles = findHtmlFiles(publicDir);
let updatedCount = 0;

for (const htmlPath of htmlFiles) {
  const content = readFileSync(htmlPath, 'utf8');

  // Replace /assets/js/ with /assets/js-prod/
  const updated = content.replace(/\/assets\/js\//g, '/assets/js-prod/');

  if (updated !== content) {
    // Create backup
    const backupPath = join(backupDir, htmlPath.replace(publicDir, ''));
    const backupDirPath = dirname(backupPath);
    if (!existsSync(backupDirPath)) {
      mkdirSync(backupDirPath, { recursive: true });
    }
    copyFileSync(htmlPath, backupPath);

    // Write updated content
    writeFileSync(htmlPath, updated, 'utf8');
    updatedCount++;
    console.log(`  ✓ ${htmlPath.replace(publicDir, '')}`);
  }
}

console.log(`\n✅ Updated ${updatedCount} HTML file(s)`);
console.log(`📋 Backups saved to: ${backupDir}`);

console.log('\n🎉 Production deployment ready!');
console.log('\nTo restore original HTML files, run:');
console.log('  node scripts/restore-dev.mjs\n');
