#!/usr/bin/env node

/**
 * One-time migration script to upload all reports to R2 storage
 * 
 * Usage:
 *   node scripts/upload-reports-to-r2.mjs
 * 
 * Requirements:
 *   - wrangler.toml configured with R2 bucket binding
 *   - Wrangler CLI installed
 *   - Authenticated with Cloudflare (wrangler login)
 * 
 * This script:
 *   1. Scans the local /reports directory
 *   2. Uploads all files to R2 preserving the directory structure
 *   3. Sets appropriate Content-Type headers for JSON files
 */

import { readdir, readFile, stat } from 'fs/promises';
import { join, relative, sep } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');
const REPORTS_DIR = join(ROOT_DIR, 'reports');

// Determine the correct wrangler command for the platform
const WRANGLER_CMD = process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler';

// ANSI color codes for pretty output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m'
};

const stats = {
  total: 0,
  uploaded: 0,
  skipped: 0,
  failed: 0,
  bytes: 0
};

/**
 * Check if wrangler is installed and authenticated
 */
async function checkWrangler() {
  return new Promise((resolve) => {
    const proc = spawn(WRANGLER_CMD, ['--version'], { shell: true });
    let output = '';
    
    proc.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    proc.on('close', (code) => {
      if (code === 0) {
        console.log(`${colors.green}✓${colors.reset} Wrangler CLI found: ${output.trim()}`);
        resolve(true);
      } else {
        console.error(`${colors.red}✗${colors.reset} Wrangler CLI not found. Please install: npm install -g wrangler`);
        resolve(false);
      }
    });
    
    proc.on('error', () => {
      console.error(`${colors.red}✗${colors.reset} Wrangler CLI not found. Please install: npm install -g wrangler`);
      resolve(false);
    });
  });
}

/**
 * Upload a file to R2 using wrangler
 */
async function uploadToR2(localPath, r2Key, options = {}) {
  const content = await readFile(localPath);
  const contentType = localPath.endsWith('.json') ? 'application/json' : 'application/octet-stream';
  
  // Ensure the R2 key is in the reports/ folder
  const fullR2Key = `reports/${r2Key}`;
  
  // Use wrangler's R2 put command with --remote flag for cloud storage
  // The format is: wrangler r2 object put <bucket>/<key> --file <file> --remote
  return new Promise((resolve, reject) => {
    // Build command arguments - quote the bucket/key path to handle commas
    const args = [
      'r2',
      'object',
      'put',
      `"ciphermaniac-reports/${fullR2Key}"`,
      '--file',
      `"${localPath}"`,
      '--content-type',
      contentType,
      '--remote'
    ];
    
    if (options.verbose) {
      console.log(`\n${colors.cyan}[DEBUG]${colors.reset} Command: ${WRANGLER_CMD} ${args.join(' ')}`);
      console.log(`${colors.cyan}[DEBUG]${colors.reset} Bucket: ciphermaniac-reports (REMOTE)`);
      console.log(`${colors.cyan}[DEBUG]${colors.reset} R2 Key: ${fullR2Key}`);
      console.log(`${colors.cyan}[DEBUG]${colors.reset} Local: ${localPath}`);
    }
    
    const proc = spawn(WRANGLER_CMD, args, { 
      shell: true,
      cwd: ROOT_DIR
    });
    
    let errorOutput = '';
    let stdoutOutput = '';
    
    proc.stdout.on('data', (data) => {
      stdoutOutput += data.toString();
    });
    
    proc.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });
    
    proc.on('close', (code) => {
      if (code === 0) {
        if (options.verbose && stdoutOutput) {
          console.log(`${colors.cyan}[DEBUG]${colors.reset} Output: ${stdoutOutput.trim()}`);
        }
        resolve();
      } else {
        reject(new Error(`Upload failed: ${errorOutput}`));
      }
    });
    
    proc.on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * Recursively scan directory and return all file paths
 */
async function scanDirectory(dir, baseDir = dir) {
  const files = [];
  const entries = await readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    
    if (entry.isDirectory()) {
      // Recursively scan subdirectories
      const subFiles = await scanDirectory(fullPath, baseDir);
      files.push(...subFiles);
    } else if (entry.isFile()) {
      // Get relative path from reports directory
      const relativePath = relative(baseDir, fullPath);
      files.push({
        localPath: fullPath,
        relativePath: relativePath.split(sep).join('/'), // Use forward slashes for R2
        size: (await stat(fullPath)).size
      });
    }
  }
  
  return files;
}

/**
 * Format bytes to human-readable size
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

/**
 * Main execution
 */
async function main() {
  console.log(`${colors.bright}${colors.cyan}===========================================`);
  console.log(`  Upload Reports to R2 Storage`);
  console.log(`===========================================${colors.reset}\n`);
  
  // Check if wrangler is available
  const hasWrangler = await checkWrangler();
  if (!hasWrangler) {
    process.exit(1);
  }
  
  console.log(`${colors.blue}ℹ${colors.reset} Scanning reports directory: ${REPORTS_DIR}\n`);
  
  // Scan the reports directory
  let files;
  try {
    files = await scanDirectory(REPORTS_DIR);
  } catch (error) {
    console.error(`${colors.red}✗${colors.reset} Failed to scan reports directory:`, error.message);
    process.exit(1);
  }
  
  stats.total = files.length;
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  
  console.log(`${colors.green}✓${colors.reset} Found ${stats.total} files (${formatBytes(totalSize)})\n`);
  
  // Confirm before proceeding
  console.log(`${colors.yellow}⚠${colors.reset}  This will upload all files to R2 bucket 'ciphermaniac-reports'`);
  console.log(`   Binding name: REPORTS`);
  console.log(`   Files will be uploaded to: reports/{relative-path}`);
  console.log(`   Example: reports/tournaments.json`);
  console.log(`            reports/2025-04-12, Regional Atlanta, GA/master.json\n`);
  
  // Upload each file
  console.log(`${colors.bright}Starting upload...${colors.reset}\n`);
  
  // Enable verbose mode for first 3 uploads
  const verboseCount = 3;
  
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const r2Key = `reports/${file.relativePath}`;
    const progress = `[${i + 1}/${files.length}]`;
    const verbose = i < verboseCount;
    
    try {
      process.stdout.write(`${progress} Uploading ${file.relativePath}... `);
      
      await uploadToR2(file.localPath, file.relativePath, { verbose });
      
      stats.uploaded++;
      stats.bytes += file.size;
      console.log(`${colors.green}✓${colors.reset}`);
      
    } catch (error) {
      stats.failed++;
      console.log(`${colors.red}✗${colors.reset} ${error.message}`);
    }
  }
  
  // Print summary
  console.log(`\n${colors.bright}${colors.cyan}===========================================`);
  console.log(`  Upload Complete`);
  console.log(`===========================================${colors.reset}\n`);
  
  console.log(`${colors.green}Uploaded:${colors.reset} ${stats.uploaded} files (${formatBytes(stats.bytes)})`);
  
  if (stats.skipped > 0) {
    console.log(`${colors.yellow}Skipped:${colors.reset}  ${stats.skipped} files`);
  }
  
  if (stats.failed > 0) {
    console.log(`${colors.red}Failed:${colors.reset}   ${stats.failed} files`);
  }
  
  console.log(`${colors.blue}Total:${colors.reset}    ${stats.total} files\n`);
  
  if (stats.failed > 0) {
    console.log(`${colors.yellow}⚠${colors.reset}  Some files failed to upload. Please check the errors above.\n`);
    process.exit(1);
  } else {
    console.log(`${colors.green}✓${colors.reset} All files uploaded successfully!\n`);
    console.log(`${colors.blue}ℹ${colors.reset} Your reports are now available at:`);
    console.log(`   https://r2.ciphermaniac.com/reports/tournaments.json`);
    console.log(`   https://r2.ciphermaniac.com/reports/2025-04-12, Regional Atlanta, GA/master.json`);
    console.log(`   (etc.)\n`);
  }
}

// Run the script
main().catch((error) => {
  console.error(`${colors.red}✗${colors.reset} Fatal error:`, error);
  process.exit(1);
});
