#!/usr/bin/env node
/**
 * Apply release-channel flags to HTML templates.
 *
 * This runs as part of build scripts and only marks pages as
 * "cloudflare-production" when the build is a Cloudflare Pages production build.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');
const publicDir = join(rootDir, 'public');

const RELEASE_CHANNEL_META_NAME = 'ciphermaniac-release-channel';
const PRODUCTION_CHANNEL = 'cloudflare-production';
const HEAD_CLOSE_REGEX = /(^[ \t]*)<\/head>/im;
const RELEASE_META_REGEX =
  /(^[ \t]*)<meta\s+name=["']ciphermaniac-release-channel["']\s+content=["'][^"']*["']\s*\/>[ \t]*\n?/im;

function isCloudflarePagesProductionBuild(env = process.env) {
  const explicitChannel = String(env.CIPHERMANIAC_RELEASE_CHANNEL || '')
    .trim()
    .toLowerCase();
  if (explicitChannel === 'production' || explicitChannel === PRODUCTION_CHANNEL) {
    return true;
  }
  if (explicitChannel === 'local' || explicitChannel === 'preview' || explicitChannel === 'development') {
    return false;
  }

  if (env.CF_PAGES !== '1') {
    return false;
  }

  const branch = String(env.CF_PAGES_BRANCH || '').trim();
  const productionBranch = String(
    env.CF_PAGES_PRODUCTION_BRANCH || env.CIPHERMANIAC_PRODUCTION_BRANCH || 'main'
  ).trim();

  return Boolean(branch) && branch === productionBranch;
}

function findHtmlFiles(dir) {
  const files = [];
  const entries = readdirSync(dir);

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...findHtmlFiles(fullPath));
      continue;
    }
    if (entry.endsWith('.html')) {
      files.push(fullPath);
    }
  }

  return files;
}

function upsertReleaseMeta(content, releaseChannel) {
  const tag = `<meta name="${RELEASE_CHANNEL_META_NAME}" content="${releaseChannel}" />`;

  if (RELEASE_META_REGEX.test(content)) {
    return content.replace(RELEASE_META_REGEX, (_match, indent) => `${indent}${tag}\n`);
  }

  if (HEAD_CLOSE_REGEX.test(content)) {
    return content.replace(HEAD_CLOSE_REGEX, (_match, indent) => `${indent}${tag}\n${indent}</head>`);
  }

  return content;
}

function removeReleaseMeta(content) {
  return content.replace(RELEASE_META_REGEX, '');
}

const isProductionBuild = isCloudflarePagesProductionBuild();
const htmlFiles = findHtmlFiles(publicDir);
let updatedCount = 0;

for (const htmlPath of htmlFiles) {
  const content = readFileSync(htmlPath, 'utf8');
  const updated = isProductionBuild ? upsertReleaseMeta(content, PRODUCTION_CHANNEL) : removeReleaseMeta(content);

  if (updated !== content) {
    writeFileSync(htmlPath, updated, 'utf8');
    updatedCount += 1;
  }
}

if (isProductionBuild) {
  console.log(`🔒 Applied production release flags to ${updatedCount} HTML file(s).`);
} else {
  console.log(`🧹 Cleared production release flags from ${updatedCount} HTML file(s).`);
}
