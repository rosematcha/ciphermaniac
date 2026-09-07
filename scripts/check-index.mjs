import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkoutIndex } from './quality/index-snapshot.mjs';

const directory = mkdtempSync(join(tmpdir(), 'ciphermaniac-commit-'));
try {
  checkoutIndex(process.cwd(), directory);
  console.log('Verifying the staged tree...');
  const localVariables = new Set(
    execFileSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8' }).trim().split('\n')
  );
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !localVariables.has(key)));
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'verify'], {
    shell: process.platform === 'win32',
    cwd: directory,
    stdio: 'inherit',
    env: { ...environment, QUALITY_BASE: 'HEAD' }
  });
  if (result.error) {
    console.error(result.error.message);
  }
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(directory, { recursive: true, force: true });
}
