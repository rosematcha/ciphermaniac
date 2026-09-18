import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { requireEnv } from './lib/env';

interface CheckRun {
  name: string;
  conclusion: string | null;
  head_sha: string;
  app?: { slug?: string };
}

export function assertVerifiedCode(sha: string, mainSha: string, checks: CheckRun[]): void {
  if (sha !== mainSha) {
    throw new Error('Refusing to deploy an obsolete or non-main commit');
  }
  for (const name of ['quality-gates', 'lighthouse']) {
    const check = checks.find(run => run.name === name && run.head_sha === sha && run.app?.slug === 'github-actions');
    if (check?.conclusion !== 'success') {
      throw new Error(`${name} has not passed for ${sha}`);
    }
  }
}

function api<T>(path: string): T {
  return JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8' })) as T;
}

function main(): void {
  const repository = requireEnv('GITHUB_REPOSITORY');
  const sha = requireEnv('GITHUB_SHA');
  const head = api<{ sha: string }>(`repos/${repository}/commits/main`);
  const checks = api<{ check_runs: CheckRun[] }>(
    `repos/${repository}/commits/${sha}/check-runs?filter=latest&per_page=100`
  );
  assertVerifiedCode(sha, head.sha, checks.check_runs);
  console.log(`Verified quality and performance checks for ${sha}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
