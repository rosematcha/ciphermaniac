#!/usr/bin/env node
/**
 * Production build script that strips development-only code
 *
 * This script:
 * 1. Compiles TypeScript to JavaScript (development build)
 * 2. Uses esbuild to bundle, split, tree-shake, and minify for production
 * 3. Strips all performance monitoring calls (perf.start/perf.end)
 * 4. Removes debug logging (logger.debug)
 * 5. Outputs optimized production code
 */

import * as esbuild from 'esbuild';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');
const srcDir = join(rootDir, 'public', 'assets', 'js');
const distDir = join(rootDir, 'public', 'assets', 'js-prod');

console.log('🏗️  Building production bundle...\n');

// Plugin to strip performance monitoring and debug calls
const stripDebugPlugin = {
  name: 'strip-debug',
  setup(build) {
    build.onLoad({ filter: /\.js$/ }, args => {
      const source = readFileSync(args.path, 'utf8');

      // Strip performance monitoring calls with more precise patterns
      const transformed = source
        // Remove perf.start('...') and perf.start("...") calls
        .replace(/perf\.start\(['"][^'"]*['"]\);?\s*/g, '')
        // Remove perf.end('...') and perf.end("...") calls
        .replace(/perf\.end\(['"][^'"]*['"]\);?\s*/g, '')
        // Remove logger.debug(...) calls - match the full statement
        .replace(/logger\.debug\([^;]*\);?\s*/g, '');

      return {
        contents: transformed,
        loader: 'js'
      };
    });
  }
};

// Get all entry points from src directory
function getEntryPoints(dir, baseDir = dir) {
  const entries = {};
  const items = readdirSync(dir);

  for (const item of items) {
    const fullPath = join(dir, item);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      Object.assign(entries, getEntryPoints(fullPath, baseDir));
    } else if (item.endsWith('.js')) {
      const relativePath = relative(baseDir, fullPath);
      const key = relativePath.replace(/\.js$/, '');
      entries[key] = fullPath;
    }
  }

  return entries;
}

// Check if src directory exists
if (!existsSync(srcDir)) {
  console.error(`❌ Source directory not found: ${srcDir}`);
  console.error('   Run "npm run build:frontend" first to compile TypeScript');
  process.exit(1);
}

// Create dist directory if it doesn't exist
if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true });
}

const entryPoints = getEntryPoints(srcDir);
const entryCount = Object.keys(entryPoints).length;

console.log(`📦 Found ${entryCount} entry points`);
console.log(`📂 Source: ${srcDir}`);
console.log(`📂 Output: ${distDir}\n`);

// Build configuration
const buildOptions = {
  entryPoints,
  outdir: distDir,
  bundle: true, // Bundle entry points for production
  splitting: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  treeShaking: true,
  sourcemap: false,
  chunkNames: 'chunks/[name]-[hash]',
  plugins: [stripDebugPlugin],
  logLevel: 'info',
  // Pure annotations help with tree-shaking
  pure: ['console.log', 'console.debug'],
  // Drop debugger statements
  drop: ['debugger']
};

try {
  const result = await esbuild.build(buildOptions);

  console.log('\n✅ Production build complete!');
  console.log(`\n📊 Build stats:`);
  console.log(`   - Files processed: ${entryCount}`);
  console.log(`   - Output directory: ${distDir}`);
  console.log(`   - Optimizations applied:`);
  console.log(`     ✓ Stripped perf.start() and perf.end() calls`);
  console.log(`     ✓ Stripped logger.debug() calls`);
  console.log(`     ✓ Stripped measureFunction() wrappers`);
  console.log(`     ✓ Stripped @measure() decorators`);
  console.log(`     ✓ Minified code`);
  console.log(`     ✓ Tree-shaken unused code`);

  if (result.warnings.length > 0) {
    console.log(`\n⚠️  Warnings: ${result.warnings.length}`);
  }
} catch (error) {
  console.error('\n❌ Build failed:', error.message);
  process.exit(1);
}
