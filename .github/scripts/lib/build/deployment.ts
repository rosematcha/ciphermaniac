import { setTimeout as delay } from 'node:timers/promises';
import { compactDeploymentState, observeAttempts } from './deploymentLifecycle';
import { canonicalStringify } from '../../../../shared/data/canonicalJson';
import { type ReleaseManifest, validateReleaseManifest } from '../../../../shared/data/build/release';
import { updatePointer } from '../../../../shared/data/build/channel';

export const DEPLOYMENT_STATE_KEY = 'deployment/v1/state.json';

export type {
  DeploymentAttempt,
  DeploymentState,
  DeploymentStore,
  PagesDeployment,
  PagesReader
} from './deploymentTypes';
import type { DeploymentState, DeploymentStore, PagesReader } from './deploymentTypes';

export function deploymentState(value: unknown): DeploymentState {
  if (value === null) {
    return { version: 1, candidates: {}, attempts: {} };
  }
  const state = value as DeploymentState;
  if (!state || state.version !== 1 || !isRecord(state.candidates) || !isRecord(state.attempts)) {
    throw new Error('Invalid deployment journal');
  }
  validateJournalTiming(state);
  for (const [id, key] of Object.entries(state.candidates)) {
    if (key !== manifestKey(id)) {
      throw new Error('Invalid candidate pin');
    }
  }
  for (const [id, attempt] of Object.entries(state.attempts)) {
    validId(id);
    validId(attempt.releaseId);
    if (!Number.isFinite(Date.parse(attempt.startedAt))) {
      throw new Error('Invalid deployment attempt');
    }
  }
  return state;
}

function validateJournalTiming(state: DeploymentState): void {
  if (state.pinnedAt !== undefined && !isRecord(state.pinnedAt)) {
    throw new Error('Invalid candidate pin timestamps');
  }
  const resolved = Object.values(state.attempts).flatMap(attempt =>
    attempt.resolvedAt === undefined ? [] : [attempt.resolvedAt]
  );
  for (const timestamp of [...Object.values(state.pinnedAt ?? {}), ...resolved]) {
    if (typeof timestamp !== 'string' || !Number.isFinite(Date.parse(timestamp))) {
      throw new Error('Invalid deployment lifecycle timestamp');
    }
  }
}

function isRecord(value: unknown): boolean {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validId(id: string): void {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error('Invalid release or attempt ID');
  }
}

function manifestKey(id: string): string {
  validId(id);
  return `releases/v1/manifests/${id}.json`;
}

export function validatedManifest(value: unknown): ReleaseManifest {
  const errors = validateReleaseManifest(value);
  if (errors.length) {
    throw new Error(`Invalid deployment manifest: ${errors.join(', ')}`);
  }
  const manifest = value as ReleaseManifest;
  validId(manifest.releaseId);
  if (!Number.isFinite(Date.parse(manifest.publishedAt))) {
    throw new Error('Invalid manifest timestamp');
  }
  return manifest;
}

async function saveState(
  store: DeploymentStore,
  change: (state: DeploymentState) => DeploymentState
): Promise<DeploymentState> {
  const written = await updatePointer(store, DEPLOYMENT_STATE_KEY, current => change(deploymentState(current)));
  return deploymentState(written);
}

/** Create-only content plus a durable pin; safe to repeat after an ambiguous R2 write. */
export async function persistCandidate(
  store: DeploymentStore,
  value: unknown,
  now = Date.now()
): Promise<ReleaseManifest> {
  const manifest = validatedManifest(value);
  const key = manifestKey(manifest.releaseId);
  const body = canonicalStringify(manifest);
  try {
    await store.putIfAbsent(key, body);
  } catch (error) {
    const existing = await store.get(key);
    if (existing === null || canonicalStringify(JSON.parse(existing)) !== body) {
      if (existing !== null) {
        throw new Error(`Conflicting manifest for release ${manifest.releaseId}`, { cause: error });
      }
      throw error;
    }
  }
  await saveState(store, state => ({
    ...state,
    candidates: { ...state.candidates, [manifest.releaseId]: key },
    pinnedAt: {
      ...state.pinnedAt,
      [manifest.releaseId]: state.pinnedAt?.[manifest.releaseId] ?? new Date(now).toISOString()
    }
  }));
  return manifest;
}

export async function recordAttempt(
  store: DeploymentStore,
  manifest: ReleaseManifest,
  attemptId: string,
  startedAt: string
): Promise<void> {
  validId(attemptId);
  if (!Number.isFinite(Date.parse(startedAt))) {
    throw new Error('Invalid deployment attempt timestamp');
  }
  await persistCandidate(store, manifest, Date.parse(startedAt));
  await saveState(store, state => {
    const existing = state.attempts[attemptId];
    if (existing) {
      throw new Error(`Deployment attempt already exists: ${attemptId}`);
    }
    return { ...state, attempts: { ...state.attempts, [attemptId]: { releaseId: manifest.releaseId, startedAt } } };
  });
}

interface ReconcileOptions {
  now?: number;
  wait?: (milliseconds: number) => Promise<void>;
}

async function readyDeployment(
  pages: PagesReader,
  state: DeploymentState,
  expectedAttempt: string | undefined,
  options: ReconcileOptions
) {
  const count = expectedAttempt ? 5 : 1;
  const wait =
    options.wait ??
    (async milliseconds => {
      await delay(milliseconds);
    });
  for (let attempt = 0; attempt < count; attempt++) {
    try {
      const observed = await pages.inspect(state.attempts);
      if (expectedAttempt && observed.deployed.attemptId !== expectedAttempt) {
        throw new Error('Expected deployment attempt is not serving production');
      }
      const manifest = validatedManifest(await pages.manifest(observed.deployed));
      if ((await pages.inspect(state.attempts)).deployed.id !== observed.deployed.id) {
        throw new Error('Pages production changed during reconciliation');
      }
      return { observed, manifest };
    } catch (error) {
      if (attempt === count - 1) {
        throw error;
      }
      await wait(1000 * 2 ** attempt);
    }
  }
  throw new Error('Pages polling exhausted');
}

function verifyAttempt(
  state: DeploymentState,
  pages: Awaited<ReturnType<PagesReader['inspect']>>,
  manifest: ReleaseManifest,
  expectedAttempt?: string
): void {
  const { attemptId } = pages.deployed;
  // Compacted historical attempts may be rolled back; their full immutable manifest is still checked below.
  if (
    attemptId &&
    (expectedAttempt || state.attempts[attemptId]) &&
    state.attempts[attemptId]?.releaseId !== manifest.releaseId
  ) {
    throw new Error('Deployed release and recorded candidate attempt disagree');
  }
}

/** All callers hold the shared writer lock. Never infer deployment from current.json. */
export async function reconcileDeployment(
  store: DeploymentStore,
  pages: PagesReader,
  expectedAttempt?: string,
  options: ReconcileOptions = {}
): Promise<ReleaseManifest> {
  const now = options.now ?? Date.now();
  const state = deploymentState((await store.read(DEPLOYMENT_STATE_KEY))?.value ?? null);
  const pointer = await store.read('current.json');
  const { observed, manifest } = await readyDeployment(pages, state, expectedAttempt, options);
  const recorded = await saveState(store, current => observeAttempts(current, observed, now));
  verifyAttempt(recorded, observed, manifest, expectedAttempt);
  const key = manifestKey(manifest.releaseId);
  const body = await store.get(key);
  if (body === null || canonicalStringify(JSON.parse(body)) !== canonicalStringify(manifest)) {
    throw new Error('Deployed release does not match its persisted manifest');
  }
  await saveState(store, state => ({
    ...state,
    deployed: { deploymentId: observed.deployed.id, releaseId: manifest.releaseId }
  }));
  const proposed = { channel: 'production', releaseId: manifest.releaseId, manifest: `/${key}`, promotedFrom: 'pages' };
  if (pointer === null) {
    await store.createIfAbsent('current.json', proposed);
  } else {
    await store.writeIfMatch('current.json', proposed, pointer.etag);
  }
  await saveState(store, current => {
    // Journals from the previous schema have no pin timestamps. Start their grace now.
    const pinnedAt = { ...current.pinnedAt };
    for (const id of Object.keys(current.candidates)) {
      pinnedAt[id] ??= new Date(now).toISOString();
    }
    return compactDeploymentState({ ...current, pinnedAt }, now);
  });
  return manifest;
}
