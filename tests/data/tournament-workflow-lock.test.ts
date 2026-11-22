/**
 * Tournament Data waits for a commit's checks outside r2-bucket-writers, so it holds no other
 * writer up, and checks once more inside the lock before its first write, so a commit that main
 * moved past while the run queued never ingests.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../../.github/workflows/tournament-data.yml', import.meta.url), 'utf8');

function job(name: string): string {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  assert.ok(start >= 0, `${name} job exists`);
  const next = workflow.slice(start + 1).search(/\n {2}[a-z-]+:\n/);
  return next < 0 ? workflow.slice(start) : workflow.slice(start, start + 1 + next);
}

test('the wait for checks runs outside the writer lock, and the writers check again inside it first', () => {
  const verified = job('verified');
  const writers = job('tournaments');
  assert.doesNotMatch(verified, /r2-bucket-writers/);
  assert.match(verified, /require-verified-code\.ts/);
  assert.match(writers, /needs: \[watch, verified\]/);
  assert.match(writers, /group: r2-bucket-writers/);
  const check = writers.indexOf('require-verified-code.ts');
  const firstWrite = writers.indexOf('run-data-pipeline.ts tournaments');
  assert.ok(check > 0 && check < firstWrite, 'the in-lock check comes before ingest');
});
