import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { budgetFailures, entryFiles, releaseJsonSize } from '../../scripts/quality/bundle-budget.mjs';

test('counts shared chunks once, tolerates cycles, and excludes lazy imports', () => {
  const manifest = {
    main: { file: 'main.js', imports: ['shared'], dynamicImports: ['lazy'], css: ['main.css'] },
    shared: { file: 'shared.js', imports: ['main'], css: ['main.css'] },
    lazy: { file: 'lazy.js', imports: ['shared'] }
  };
  assert.deepEqual([...entryFiles(manifest, 'main')].sort(), ['main.css', 'main.js', 'shared.js']);
  assert.deepEqual([...entryFiles(manifest, 'lazy')].sort(), ['lazy.js', 'main.css', 'main.js', 'shared.js']);
});

test('fails closed on missing manifests or unconfigured budgets', () => {
  assert.throws(() => entryFiles({}, 'main'), /Missing manifest entry/);
  assert.equal(budgetFailures({ initialJs: 10 }, {}).length, 1);
});

test('accepts the limit and rejects a one-byte regression', () => {
  assert.deepEqual(budgetFailures({ initialJs: 10 }, { initialJs: 10 }), []);
  assert.equal(budgetFailures({ initialJs: 11 }, { initialJs: 10 }).length, 1);
});

test('measures only the release manifest inlined into the document', () => {
  const json = JSON.stringify({ releaseId: 'r'.repeat(500) });
  const html = `<head><script type="application/json" id="release">${json}</script></head><body>${'x'.repeat(5000)}</body>`;
  assert.equal(releaseJsonSize(html), gzipSync(json).byteLength);
  assert.equal(releaseJsonSize('<head></head>'), gzipSync('').byteLength);
});
