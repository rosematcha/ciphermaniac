import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { budgetFailures, compressedSizes, entryFiles, splitRelease } from './quality/bundle-budget.mjs';

const directory = fileURLToPath(new URL('../dist/', import.meta.url));
const manifest = JSON.parse(readFileSync(new URL('../dist/.vite/manifest.json', import.meta.url), 'utf8'));
const budgets = JSON.parse(readFileSync(new URL('../config/quality/bundle-budgets.json', import.meta.url), 'utf8'));
const { code: initial, release } = splitRelease(manifest, entryFiles(manifest, 'index.html'));
const totals = splitRelease(
  manifest,
  Object.keys(manifest).flatMap(key => [...entryFiles(manifest, key)])
).code;
const initialSizes = compressedSizes(directory, initial);
const totalSizes = compressedSizes(directory, totals);
const releaseSizes = compressedSizes(directory, release);
const failures = budgetFailures(
  {
    initialJs: initialSizes.js,
    initialCss: initialSizes.css,
    totalJs: totalSizes.js,
    totalCss: totalSizes.css,
    releaseJs: releaseSizes.js
  },
  budgets
);
console.log({ initial: initialSizes, total: totalSizes, release: releaseSizes });
for (const [key, chunk] of Object.entries(manifest)) {
  if (!chunk.isDynamicEntry) {
    continue;
  }
  const files = splitRelease(manifest, [...initial, ...entryFiles(manifest, key)]).code;
  const sizes = compressedSizes(directory, files);
  console.log(`${key}: ${sizes.js} JS / ${sizes.css} CSS gzip bytes`);
  failures.push(
    ...budgetFailures({ routeJs: sizes.js, routeCss: sizes.css }, budgets).map(message => `${key}: ${message}`)
  );
}
for (const failure of failures) {
  console.error(failure);
}
process.exitCode = failures.length ? 1 : 0;
