import type { DeploymentAttempt, DeploymentState, PagesState } from './deploymentTypes';

// Longest publishing job: 150 minutes, plus 30 minutes for termination/propagation.
export const ATTEMPT_ABANDON_MS = 180 * 60_000;
export const CANDIDATE_GRACE_MS = 86_400_000;

export function resolvedAttempt(attempt: DeploymentAttempt): boolean {
  return ['success', 'failure', 'canceled', 'skipped', 'abandoned'].includes(attempt.status ?? '');
}

export function observeAttempts(state: DeploymentState, pages: PagesState, now: number): DeploymentState {
  const attempts = { ...state.attempts };
  const observed = new Set<string>();
  for (const deployment of [...pages.deployments, pages.deployed]) {
    const id = deployment.attemptId;
    if (!id || !attempts[id]) {
      continue;
    }
    observed.add(id);
    const attempt = { ...attempts[id], deploymentId: deployment.id, status: deployment.status };
    attempts[id] = {
      ...attempt,
      resolvedAt: resolvedAttempt(attempt) ? (attempt.resolvedAt ?? new Date(now).toISOString()) : undefined
    };
  }
  for (const [id, attempt] of Object.entries(attempts)) {
    if (resolvedAttempt(attempt) && !attempt.resolvedAt) {
      attempts[id] = { ...attempt, resolvedAt: new Date(now).toISOString() };
    }
    if (!observed.has(id) && !resolvedAttempt(attempt) && now - Date.parse(attempt.startedAt) >= ATTEMPT_ABANDON_MS) {
      // Only after a successful Pages inventory covering the attempt's start time.
      attempts[id] = { ...attempt, status: 'abandoned', resolvedAt: new Date(now).toISOString() };
    }
  }
  return { ...state, attempts };
}

function oldEnough(timestamp: string | undefined, now: number): boolean {
  return timestamp !== undefined && now - Date.parse(timestamp) >= CANDIDATE_GRACE_MS;
}

function canUnpin(state: DeploymentState, releaseId: string, now: number): boolean {
  const attempts = Object.values(state.attempts).filter(attempt => attempt.releaseId === releaseId);
  if (attempts.some(attempt => !resolvedAttempt(attempt))) {
    return false;
  }
  if (state.deployed?.releaseId === releaseId) {
    return true;
  }
  return oldEnough(state.pinnedAt?.[releaseId], now) && attempts.every(attempt => oldEnough(attempt.resolvedAt, now));
}

/** Run only after verifying Pages production and completing the conditional promotion. */
export function compactDeploymentState(state: DeploymentState, now: number): DeploymentState {
  const candidates = { ...state.candidates };
  const pinnedAt = { ...state.pinnedAt };
  for (const id of Object.keys(candidates)) {
    if (canUnpin(state, id, now)) {
      delete candidates[id];
      delete pinnedAt[id];
    }
  }
  const attempts = Object.fromEntries(
    Object.entries(state.attempts).filter(
      ([, attempt]) =>
        attempt.deploymentId === state.deployed?.deploymentId ||
        candidates[attempt.releaseId] ||
        !resolvedAttempt(attempt) ||
        !oldEnough(attempt.resolvedAt, now)
    )
  );
  return { ...state, candidates, pinnedAt, attempts };
}
