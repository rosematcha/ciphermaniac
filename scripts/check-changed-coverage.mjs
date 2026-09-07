import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import coverage from 'istanbul-lib-coverage';
import { addedLines, changedLineCoverage } from './quality/changed-coverage.mjs';

const git = args => execFileSync('git', args, { encoding: 'utf8' });
const base = process.env.QUALITY_BASE || 'HEAD';
// Validate the revision before constructing the diff; CI supplies the PR base SHA.
git(['rev-parse', '--verify', `${base}^{commit}`]);
const files = git(['diff', '--name-only', '--diff-filter=ACMR', '-z', base, '--']).split('\0').filter(Boolean);
const map = coverage.createCoverageMap(JSON.parse(readFileSync('coverage/coverage-final.json', 'utf8')));
const measured = new Set(map.files());
let failures = 0;
for (const file of files) {
  const path = resolve(file);
  if (!measured.has(path)) {
    continue;
  }
  const diff = git(['diff', '--no-ext-diff', '--unified=0', base, '--', file]);
  const result = changedLineCoverage(addedLines(diff), map.fileCoverageFor(path).getLineCoverage());
  if (result.percent < 80) {
    console.error(
      `${file}: ${result.percent.toFixed(1)}% changed-line coverage; minimum 80%. Uncovered: ${result.uncovered.join(', ')}`
    );
    failures++;
  }
}
process.exitCode = failures ? 1 : 0;
