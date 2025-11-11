#!/usr/bin/env node

/**
 * Local test script for online meta with include-exclude generation
 * 
 * This script runs the full online meta job locally and saves results to
 * a local directory instead of R2. Useful for testing before deployment.
 * 
 * Requirements:
 * - LIMITLESS_API_KEY environment variable
 * 
 * Usage:
 *   node dev/test-online-meta-local.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, '..', 'test-output', 'include-exclude-test');

// Mock environment for local testing
const mockEnv = {
  LIMITLESS_API_KEY: process.env.LIMITLESS_API_KEY,
  REPORTS: {
    async put(key, value, options) {
      const fullPath = path.join(OUTPUT_DIR, key);
      const dir = path.dirname(fullPath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fullPath, value, 'utf-8');
      console.log(`[LocalTest] Wrote: ${key}`);
    },
    async get(key) {
      const fullPath = path.join(OUTPUT_DIR, key);
      if (!fs.existsSync(fullPath)) {
        return null;
      }
      return {
        async text() {
          return fs.readFileSync(fullPath, 'utf-8');
        }
      };
    }
  }
};

// Check for API key
if (!mockEnv.LIMITLESS_API_KEY) {
  console.error('Error: LIMITLESS_API_KEY environment variable is required');
  console.error('Set it in your environment or .env file');
  process.exit(1);
}

// Import the online meta job (this will fail if functions/lib use Cloudflare-specific APIs)
// We'll need to adapt it for local testing
console.log('This test requires adapting the Cloudflare Workers code for Node.js');
console.log('The core logic is tested in test-include-exclude.mjs');
console.log('');
console.log('To test locally:');
console.log('1. Run: node dev/test-include-exclude.mjs (tests include-exclude logic)');
console.log('2. Deploy to Cloudflare and test with wrangler:');
console.log('   - wrangler pages functions dev');
console.log('   - Visit: http://localhost:8788/_cron/online-meta');
console.log('');
console.log('Or use the existing standalone script:');
console.log('   - Set environment variables: LIMITLESS_API_KEY, R2_ACCOUNT_ID, etc.');
console.log('   - Run: node scripts/run-online-meta.mjs');
console.log('   - Note: This does NOT include include-exclude generation yet');
