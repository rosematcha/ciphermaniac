import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkoutIndex } from '../../scripts/quality/index-snapshot.mjs';

test('checks staged contents even when the working tree contains a later fix', () => {
  const root = mkdtempSync(join(tmpdir(), 'quality-index-test-'));
  const repository = join(root, 'repository');
  const snapshot = join(root, 'snapshot');
  mkdirSync(repository);
  mkdirSync(snapshot);
  try {
    execFileSync('git', ['init', '--quiet', repository]);
    writeFileSync(join(repository, 'code.ts'), 'staged version');
    execFileSync('git', ['add', 'code.ts'], { cwd: repository });
    writeFileSync(join(repository, 'code.ts'), 'unstaged fix');
    checkoutIndex(repository, snapshot);
    assert.equal(readFileSync(join(snapshot, 'code.ts'), 'utf8'), 'staged version');
    assert.equal(readFileSync(join(repository, 'code.ts'), 'utf8'), 'unstaged fix');
    assert.equal(execFileSync('git', ['show', ':code.ts'], { cwd: snapshot, encoding: 'utf8' }), 'staged version');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
