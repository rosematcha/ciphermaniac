#!/usr/bin/env node

/**
 * Upload include-exclude reports to Cloudflare R2 storage
 *
 * This script uploads all JSON files from the include-exclude directory
 * to R2 storage, preserving the folder structure as object key prefixes.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const BUCKET_NAME = 'ciphermaniac-reports';
const BASE_REPORT_DIR = path.join(__dirname, '..', 'reports');
const REPORT_NAME = '2025-09-20, Regional Pittsburgh, PA';
const INCLUDE_EXCLUDE_DIR = path.join(BASE_REPORT_DIR, REPORT_NAME, 'archetypes', 'include-exclude');

// Batch settings
const BATCH_SIZE = 100; // Upload in batches to avoid overwhelming the system
const DELAY_MS = 100; // Delay between uploads to avoid rate limiting

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getAllJsonFiles(dir, baseDir = dir) {
  let files = [];
  const items = fs.readdirSync(dir, { withFileTypes: true });

  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      files = files.concat(getAllJsonFiles(fullPath, baseDir));
    } else if (item.isFile() && item.name.endsWith('.json')) {
      // Get relative path from base directory
      const relativePath = path.relative(baseDir, fullPath);
      files.push({ fullPath, relativePath });
    }
  }

  return files;
}

async function uploadFile(filePath, objectKey) {
  try {
    // Use npx wrangler to upload the file to remote R2
    const command = `npx wrangler r2 object put "${BUCKET_NAME}/${objectKey}" --file "${filePath}" --remote`;
    execSync(command, { stdio: 'pipe' });
    return true;
  } catch (error) {
    console.error(`Failed to upload ${objectKey}:`, error.message);
    return false;
  }
}

async function main() {
  console.log('Starting R2 upload process...');
  console.log(`Source directory: ${INCLUDE_EXCLUDE_DIR}`);
  console.log(`Target bucket: ${BUCKET_NAME}`);
  console.log('');

  // Check if directory exists
  if (!fs.existsSync(INCLUDE_EXCLUDE_DIR)) {
    console.error(`Error: Directory not found: ${INCLUDE_EXCLUDE_DIR}`);
    process.exit(1);
  }

  // Get all JSON files
  console.log('Scanning for JSON files...');
  const files = getAllJsonFiles(INCLUDE_EXCLUDE_DIR);
  console.log(`Found ${files.length} files to upload`);
  console.log('');

  // Upload files in batches
  let uploaded = 0;
  let failed = 0;

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(files.length / BATCH_SIZE);

    console.log(`Processing batch ${batchNumber}/${totalBatches} (${batch.length} files)...`);

    for (const file of batch) {
      // Create object key: include-exclude/Archetype/file.json
      const objectKey = `include-exclude/${file.relativePath.replace(/\\/g, '/')}`;

      const success = await uploadFile(file.fullPath, objectKey);
      if (success) {
        uploaded++;
        process.stdout.write(`\r  Uploaded: ${uploaded}/${files.length} (${failed} failed)`);
      } else {
        failed++;
      }

      // Small delay to avoid rate limiting
      if (DELAY_MS > 0) {
        await sleep(DELAY_MS);
      }
    }

    console.log(''); // New line after batch
  }

  console.log('');
  console.log('Upload complete!');
  console.log(`Successfully uploaded: ${uploaded} files`);
  console.log(`Failed uploads: ${failed} files`);

  if (failed > 0) {
    console.log('\nNote: Some uploads failed. You may want to retry those files.');
  }
}

// Run the script
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
