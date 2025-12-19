#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';

const COVERAGE_SUMMARY = path.resolve(process.cwd(), 'coverage', 'coverage-summary.json');
const OUTPUT_FILE = path.resolve(process.cwd(), 'public', 'assets', 'data', 'coverage-badge.json');

function determineColor(pct) {
  if (pct >= 80) {
    return 'green';
  }
  if (pct >= 60) {
    return 'yellow';
  }
  return 'red';
}

async function readCoverageSummary(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

async function writeBadge(outputPath, badge) {
  const dir = path.dirname(outputPath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(badge, null, 2)}\n`, 'utf8');
}

async function main() {
  const summary = await readCoverageSummary(COVERAGE_SUMMARY);
  if (!summary || !summary.total || typeof summary.total.lines.pct !== 'number') {
    console.warn('coverage-summary.json not found or missing data at:', COVERAGE_SUMMARY);
    const badge = {
      schemaVersion: 1,
      label: 'coverage',
      message: 'unknown',
      color: 'lightgrey'
    };
    await writeBadge(OUTPUT_FILE, badge);
    console.log('Coverage: unknown');
    return;
  }

  const pct = Number(summary.total.lines.pct);
  const rounded = Math.round(pct * 10) / 10;
  const color = determineColor(pct);

  const badge = {
    schemaVersion: 1,
    label: 'coverage',
    message: `${rounded}%`,
    color
  };

  await writeBadge(OUTPUT_FILE, badge);
  console.log(`Coverage: ${rounded}%`);
}

main().catch(err => {
  console.error('Error generating coverage badge:', err);
  process.exitCode = 1;
});
