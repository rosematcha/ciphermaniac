import { spawn, spawnSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { chromium } from '@playwright/test';

function run(args, env = process.env) {
  const result = spawnSync('npx', args, { stdio: 'inherit', env });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${args[0]} failed with ${result.status}`);
  }
}

async function waitForFixtures() {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch('http://127.0.0.1:4320/reports/tournaments.json');
      if (response.ok) {
        await response.arrayBuffer();
        return;
      }
    } catch {
      /* The fixture process has not bound the port yet. */
    }
    await setTimeout(100);
  }
  throw new Error('Fixture server did not start');
}

const fixtures = spawn(process.execPath, ['--import', 'tsx', 'tests/e2e/serve-fixtures.ts'], {
  stdio: 'inherit',
  env: { ...process.env, FIXTURE_PORT: '4320' }
});
try {
  await waitForFixtures();
  run(['vite', 'build', '--config', 'tests/e2e/release-build.config.ts', '--outDir', '.cache/lighthouse-dist'], {
    ...process.env,
    VITE_DATA_ORIGIN: 'http://127.0.0.1:4320'
  });
  run(['--yes', '@lhci/cli@0.14.0', 'autorun'], {
    ...process.env,
    CHROME_PATH: chromium.executablePath()
  });
} finally {
  fixtures.kill();
}
