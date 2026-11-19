/**
 * Daily Data's scheduled start is the fallback for Botan's 12:17 UTC dispatch:
 * it runs only after the slot, while no main run since then has succeeded or is
 * still open, and runs when that lookup fails.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const workflow = readFileSync(new URL('../../.github/workflows/daily-data.yml', import.meta.url), 'utf8');
const step = /- id: check\n {8}shell: bash\n {8}run: \|\n((?: {10}.*\n)+)/.exec(workflow)?.[1].replace(/^ {10}/gm, '');

/** Run the step as `shell: bash` does, with `gh` and `date` stubbed on PATH. */
function slot(gh: string, time: string): { open: string; ghArgs: string } {
  assert.ok(step, 'daily-data.yml has a bash check step');
  const dir = mkdtempSync(join(tmpdir(), 'daily-slot-'));
  try {
    const bin = (name: string, body: string) => {
      writeFileSync(join(dir, name), `#!/bin/bash\n${body}\n`);
      chmodSync(join(dir, name), 0o755);
    };
    bin('gh', `echo "$*" > "${dir}/gh-args"\n${gh}`);
    bin('date', `case "$*" in *%F*) echo 2026-11-18 ;; *) echo ${time} ;; esac`);
    writeFileSync(join(dir, 'step.sh'), step);
    const output = join(dir, 'output');
    writeFileSync(output, '');
    execFileSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', join(dir, 'step.sh')], {
      env: {
        PATH: `${dir}:${process.env.PATH}`,
        GITHUB_OUTPUT: output,
        GITHUB_REPOSITORY: 'owner/repo',
        GITHUB_RUN_ID: '7'
      },
      stdio: ['ignore', 'ignore', 'ignore']
    });
    return { open: readFileSync(output, 'utf8').trim(), ghArgs: readFileSync(join(dir, 'gh-args'), 'utf8') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const runs = (...list: object[]) => `echo '${JSON.stringify(list)}'`;

test('a scheduled start runs after the slot unless a main run since then succeeded or is open', () => {
  const self = { databaseId: 7, status: 'in_progress', conclusion: '' };
  assert.equal(slot(runs(self), '1800').open, 'open=true');
  assert.equal(
    slot(runs(self, { databaseId: 5, status: 'completed', conclusion: 'failure' }), '1800').open,
    'open=true'
  );
  assert.equal(
    slot(runs(self, { databaseId: 5, status: 'completed', conclusion: 'success' }), '1800').open,
    'open=false'
  );
  assert.equal(slot(runs(self, { databaseId: 5, status: 'queued', conclusion: '' }), '1800').open, 'open=false');
  assert.equal(slot(runs(self), '0030').open, 'open=false', 'a start delayed past midnight waits for its slot');
  assert.match(slot(runs(self), '1800').ghArgs, /--branch main/);
});

test('a failed run lookup runs the day instead of skipping it', () => {
  assert.equal(slot('echo "HTTP 502" >&2; exit 1', '1800').open, 'open=true');
});
