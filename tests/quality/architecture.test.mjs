import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';

function cruise(files) {
  const root = mkdtempSync(join(tmpdir(), 'quality-architecture-'));
  try {
    writeFileSync(join(root, 'tsconfig.frontend.json'), '{}');
    for (const [file, source] of Object.entries(files)) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), source);
    }
    return spawnSync(
      process.execPath,
      [
        resolve('node_modules/dependency-cruiser/bin/dependency-cruise.mjs'),
        '--config',
        resolve('.dependency-cruiser.cjs'),
        'src'
      ],
      { cwd: root, encoding: 'utf8' }
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('architecture gate rejects runtime cycles', () => {
  const result = cruise({ 'src/a.ts': "import './b';", 'src/b.ts': "import './a';" });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /no-cycles/);
});

test('architecture gate rejects indirect browser access to producer code', () => {
  const result = cruise({
    'src/main.ts': "import './adapter';",
    'src/adapter.ts': "import '../scripts/producer';",
    'scripts/producer.ts': 'export const value = 1;'
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /browser-has-no-producer/);
});

test('architecture gate permits UI to consume shared logic', () => {
  const result = cruise({ 'src/main.ts': "import '../shared/value';", 'shared/value.ts': 'export const value = 1;' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
