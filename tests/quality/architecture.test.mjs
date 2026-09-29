import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';

// One dependency-cruiser run over a tree that holds every case; spawning it costs
// about half a second, so each case reads its own violations from the shared result.
// The JSON reporter always exits 0, so a blocking violation is one with severity error.
function cruise(files) {
  const root = mkdtempSync(join(tmpdir(), 'quality-architecture-'));
  try {
    writeFileSync(join(root, 'tsconfig.frontend.json'), '{}');
    for (const [file, source] of Object.entries(files)) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), source);
    }
    const result = spawnSync(
      process.execPath,
      [
        resolve('node_modules/dependency-cruiser/bin/dependency-cruiser.mjs'),
        '--config',
        resolve('.dependency-cruiser.cjs'),
        '--output-type',
        'json',
        'src'
      ],
      { cwd: root, encoding: 'utf8' }
    );
    return JSON.parse(result.stdout).summary.violations;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const violations = cruise({
  'src/a.ts': "import './b';",
  'src/b.ts': "import './a';",
  'src/main.ts': "import './adapter';",
  'src/adapter.ts': "import '../scripts/producer';",
  'scripts/producer.ts': 'export const value = 1;',
  'src/ui.ts': "import '../shared/value';",
  'shared/value.ts': 'export const value = 1;'
});

function errorsFrom(from) {
  return violations
    .filter(violation => violation.from === from && violation.rule.severity === 'error')
    .map(violation => violation.rule.name);
}

test('architecture gate rejects runtime cycles', () => {
  assert.ok(errorsFrom('src/a.ts').includes('no-cycles'));
});

test('architecture gate rejects indirect browser access to producer code', () => {
  assert.ok(errorsFrom('src/main.ts').includes('browser-has-no-producer'));
});

test('architecture gate permits UI to consume shared logic', () => {
  assert.deepEqual(errorsFrom('src/ui.ts'), []);
  assert.deepEqual(errorsFrom('shared/value.ts'), []);
});
