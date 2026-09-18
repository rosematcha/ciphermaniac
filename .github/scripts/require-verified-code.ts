import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { setTimeout } from 'node:timers/promises';
import { requireEnv } from './lib/env';

interface CheckRun {
  name: string;
  conclusion: string | null;
  head_sha: string;
  app?: { slug?: string };
}

type VerificationState = 'failure' | 'pending' | 'success';

const REQUIRED_CHECKS = ['quality-gates', 'lighthouse'];

export function getVerificationState(sha: string, mainSha: string, checks: CheckRun[]): VerificationState {
  if (sha !== mainSha) {
    return 'failure';
  }
  let pending = false;
  for (const name of REQUIRED_CHECKS) {
    const check = checks.find(run => run.name === name && run.head_sha === sha && run.app?.slug === 'github-actions');
    if (!check?.conclusion) {
      pending = true;
    } else if (check.conclusion !== 'success') {
      return 'failure';
    }
  }
  return pending ? 'pending' : 'success';
}

export function assertVerifiedCode(sha: string, mainSha: string, checks: CheckRun[]): void {
  if (sha !== mainSha) {
    throw new Error('Refusing to deploy an obsolete or non-main commit');
  }
  for (const name of REQUIRED_CHECKS) {
    const check = checks.find(run => run.name === name && run.head_sha === sha && run.app?.slug === 'github-actions');
    if (check?.conclusion !== 'success') {
      throw new Error(`${name} has not passed for ${sha}`);
    }
  }
}

function api<T>(path: string): T {
  return JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8' })) as T;
}

async function main(): Promise<void> {
  const repository = requireEnv('GITHUB_REPOSITORY');
  const sha = requireEnv('GITHUB_SHA');
  for (let attempt = 0; attempt < 100; attempt++) {
    const head = api<{ sha: string }>(`repos/${repository}/commits/main`);
    const checks = api<{ check_runs: CheckRun[] }>(
      `repos/${repository}/commits/${sha}/check-runs?filter=latest&per_page=100`
    );
    const state = getVerificationState(sha, head.sha, checks.check_runs);
    if (state === 'success') {
      console.log(`Verified quality and performance checks for ${sha}`);
      return;
    }
    if (state === 'failure') {
      assertVerifiedCode(sha, head.sha, checks.check_runs);
    }
    if (attempt === 99) {
      throw new Error(`Timed out waiting for checks on ${sha}`);
    }
    if (attempt === 0) {
      console.log(`Waiting for quality and performance checks on ${sha}`);
    }
    await setTimeout(15_000);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
