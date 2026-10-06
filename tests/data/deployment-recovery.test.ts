import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareDeployment } from '../../.github/scripts/prepare-deployment';
import { renderModule } from '../../.github/scripts/generate-release-module';
import { PointerConflictError } from '../../shared/data/build/channel';
import { RELEASE_SCOPES, type ReleaseManifest } from '../../shared/data/build/release';
import {
  DEPLOYMENT_STATE_KEY,
  deploymentState,
  type DeploymentStore,
  type PagesReader,
  persistCandidate,
  reconcileDeployment as reconcileRelease,
  recordAttempt
} from '../../.github/scripts/lib/build/deployment';
import { createPagesReader, legacyManifest } from '../../.github/scripts/lib/build/pages';
import { reconcileAndClear } from '../../.github/scripts/update-channel';

import { ATTEMPT_ABANDON_MS, CANDIDATE_GRACE_MS } from '../../.github/scripts/lib/build/deploymentLifecycle';
const NOW = Date.parse('2026-09-12T00:00:02Z');

const reconcileDeployment = (
  store: DeploymentStore,
  pages: PagesReader,
  expected?: string,
  options: Parameters<typeof reconcileRelease>[3] = {}
) => reconcileRelease(store, pages, expected, { now: NOW, wait: async () => {}, ...options });

const manifest = (releaseId: string): ReleaseManifest => ({
  contractVersion: 2,
  releaseId,
  publishedAt: '2026-09-12T00:00:00Z',
  roots: Object.fromEntries(
    RELEASE_SCOPES.map(scope => [scope, `/releases/v1/${scope}/aaaaaaaaaaaa`])
  ) as ReleaseManifest['roots'],
  events: {},
  dependencies: {}
});

function fixture() {
  const objects = new Map<string, string>();
  let version = 0;
  let failPointer = false;
  const store: DeploymentStore & { delete(key: string): Promise<void> } = {
    async get(key) {
      return objects.get(key) ?? null;
    },
    async delete(key) {
      objects.delete(key);
    },
    async putIfAbsent(key, body) {
      if (objects.has(key)) {
        throw new Error('Already exists');
      }
      objects.set(key, body);
    },
    async read(key) {
      const body = objects.get(key);
      return body === undefined ? null : { value: JSON.parse(body) as unknown, etag: String(version) };
    },
    async createIfAbsent(key, value) {
      if (objects.has(key)) {
        throw new PointerConflictError(key);
      }
      objects.set(key, JSON.stringify(value));
      version++;
    },
    async writeIfMatch(key, value, etag) {
      if (key === 'current.json' && failPointer) {
        throw new PointerConflictError(key);
      }
      if (etag !== String(version) && key === 'current.json') {
        throw new PointerConflictError(key);
      }
      objects.set(key, JSON.stringify(value));
      // Journal writes have their own ETags in R2.
      if (key === 'current.json') {
        version++;
      }
    }
  };
  let release = manifest('old');
  let id = 'pages-old';
  let attemptId: string | undefined;
  let unavailable = false;
  const pages: PagesReader = {
    async inspect() {
      if (unavailable) {
        throw new Error('Ambiguous Pages state');
      }
      const deployed = { id, url: `https://${id}.ciphermaniac.pages.dev`, status: 'success', attemptId };
      return { deployed, deployments: [deployed] };
    },
    async manifest() {
      return release;
    }
  };
  const journal = () => deploymentState(JSON.parse(objects.get(DEPLOYMENT_STATE_KEY) ?? 'null'));
  return {
    store,
    objects,
    pages,
    journal,
    pointerFails(value: boolean) {
      failPointer = value;
    },
    ambiguous(value: boolean) {
      unavailable = value;
    },
    deploy(value: ReleaseManifest, attempt: string) {
      release = value;
      id = `pages-${attempt}`;
      attemptId = attempt;
    }
  };
}

async function initialized() {
  const f = fixture();
  await persistCandidate(f.store, manifest('old'));
  await reconcileDeployment(f.store, f.pages);
  return f;
}

test('candidate persistence is idempotent, including reordered keys, and refuses conflicting IDs', async () => {
  const f = fixture();
  const candidate = manifest('candidate');
  await persistCandidate(f.store, candidate);
  await persistCandidate(f.store, {
    ...candidate,
    roots: Object.fromEntries(Object.entries(candidate.roots).reverse())
  });
  assert.equal(Object.keys(f.journal().candidates).length, 1);
  await assert.rejects(
    persistCandidate(f.store, { ...candidate, events: { Event: '/releases/v1/events/Event/bbbbbbbbbbbb' } }),
    /Conflicting/
  );
  await assert.rejects(persistCandidate(f.store, { ...candidate, releaseId: '../bad' }), /ID/);
});

test('termination before deployment leaves durable pins across recovery and subsequent candidates', async () => {
  const f = await initialized();
  await persistCandidate(f.store, manifest('prepared'));
  await recordAttempt(f.store, manifest('attempted'), 'attempt-1', '2026-09-12T00:00:00Z');
  assert.equal((await reconcileDeployment(f.store, f.pages)).releaseId, 'old');
  await persistCandidate(f.store, manifest('subsequent'));
  assert.deepEqual(Object.keys(f.journal().candidates).sort(), ['attempted', 'prepared', 'subsequent']);
  assert.equal(f.journal().attempts['attempt-1'].deploymentId, undefined);
});

test('termination after Pages success recovers the identity and promotes the deployed release', async () => {
  const f = await initialized();
  const candidate = manifest('candidate');
  await recordAttempt(f.store, candidate, 'attempt-1', '2026-09-12T00:00:00Z');
  f.deploy(candidate, 'attempt-1');
  assert.equal((JSON.parse(f.objects.get('current.json')!) as { releaseId: string }).releaseId, 'old');
  assert.equal((await reconcileDeployment(f.store, f.pages)).releaseId, 'candidate');
  assert.equal(f.journal().attempts['attempt-1'].deploymentId, 'pages-attempt-1');
  assert.equal(f.journal().deployed?.releaseId, 'candidate');
  assert.deepEqual(f.journal().candidates, {});
});

test('recovery after Pages success clears pending events the deployed release already serves', async () => {
  const f = await initialized();
  const event = '2026-10-03, Event';
  const candidate = { ...manifest('candidate'), events: { [event]: `/releases/v1/events/${event}/aaaaaaaaaaaa` } };
  f.objects.set('pending-events.json', JSON.stringify({ events: candidate.events }));
  await recordAttempt(f.store, candidate, 'attempt-1', '2026-09-12T00:00:00Z');
  f.deploy(candidate, 'attempt-1');
  const options = { now: NOW, wait: async () => {} };
  assert.deepEqual(await reconcileAndClear(f.store, f.pages, undefined, options), {
    releaseId: 'candidate',
    cleared: 1
  });
  assert.equal(f.objects.has('pending-events.json'), false);
});

test('recovery keeps pending events the deployed release does not serve yet', async () => {
  const f = await initialized();
  const event = '2026-10-03, Event';
  const pending = JSON.stringify({ events: { [event]: `/releases/v1/events/${event}/bbbbbbbbbbbb` } });
  f.objects.set('pending-events.json', pending);
  const options = { now: NOW, wait: async () => {} };
  assert.deepEqual(await reconcileAndClear(f.store, f.pages, undefined, options), { releaseId: 'old', cleared: 0 });
  assert.equal(f.objects.get('pending-events.json'), pending);
});

test('ambiguous success keeps the candidate pinned until Pages can be verified', async () => {
  const f = await initialized();
  const candidate = manifest('candidate');
  await recordAttempt(f.store, candidate, 'attempt-1', '2026-09-12T00:00:00Z');
  f.deploy(candidate, 'attempt-1');
  f.ambiguous(true);
  await assert.rejects(reconcileDeployment(f.store, f.pages), /Ambiguous/);
  assert.ok(f.journal().candidates.candidate);
  f.ambiguous(false);
  await reconcileDeployment(f.store, f.pages);
  assert.equal(f.journal().deployed?.releaseId, 'candidate');
});

test('pointer failure records Pages identity, preserves pin, and recovers without redeploying', async () => {
  const f = await initialized();
  const candidate = manifest('candidate');
  await recordAttempt(f.store, candidate, 'attempt-1', '2026-09-12T00:00:00Z');
  f.deploy(candidate, 'attempt-1');
  f.pointerFails(true);
  await assert.rejects(reconcileDeployment(f.store, f.pages), /conflict/);
  assert.equal(f.journal().deployed?.releaseId, 'candidate');
  assert.ok(f.journal().candidates.candidate);
  f.pointerFails(false);
  await reconcileDeployment(f.store, f.pages);
  await persistCandidate(f.store, manifest('next'));
  assert.deepEqual(Object.keys(f.journal().candidates), ['next']);
});

test('rollback follows actual Pages production, rather than release timestamps or the journal', async () => {
  const f = await initialized();
  const candidate = manifest('new');
  await recordAttempt(f.store, candidate, 'new', '2026-09-12T00:00:00Z');
  f.deploy(candidate, 'new');
  await reconcileDeployment(f.store, f.pages);
  await recordAttempt(f.store, manifest('old'), 'rollback', '2026-09-12T00:00:01Z');
  f.deploy(manifest('old'), 'rollback');
  assert.equal((await reconcileDeployment(f.store, f.pages)).releaseId, 'old');
  assert.equal(f.journal().deployed?.deploymentId, 'pages-rollback');
});

test('verification and unexpected deployment identity failures never promote a pointer', async () => {
  const f = await initialized();
  await recordAttempt(f.store, manifest('missing'), 'unknown', '2026-09-12T00:00:00Z');
  f.objects.delete('releases/v1/manifests/missing.json');
  f.deploy(manifest('missing'), 'unknown');
  await assert.rejects(reconcileDeployment(f.store, f.pages), /persisted manifest/);
  await assert.rejects(reconcileDeployment(f.store, f.pages, 'expected'), /not serving/);
  f.deploy({ ...manifest('old'), events: { Other: '/releases/v1/events/Other/bbbbbbbbbbbb' } }, 'unknown');
  await assert.rejects(reconcileDeployment(f.store, f.pages), /candidate attempt disagree/);
  assert.equal((JSON.parse(f.objects.get('current.json')!) as { releaseId: string }).releaseId, 'old');
});

test('a Pages change between verification and promotion cancels promotion', async () => {
  const f = await initialized();
  const { inspect } = f.pages;
  let calls = 0;
  f.pages.inspect = async () => {
    const value = await inspect();
    if (++calls === 2) {
      value.deployed.id = 'different';
    }
    return value;
  };
  await assert.rejects(reconcileDeployment(f.store, f.pages), /changed during/);
});

test('legacy release discovery reads literal manifests without evaluating JavaScript', () => {
  const release = manifest('legacy');
  assert.deepEqual(legacyManifest(`const data=${JSON.stringify(release)};throw new Error('never execute')`), release);
  assert.equal(legacyManifest('const data=null'), null);
  assert.throws(() => legacyManifest('const data={contractVersion:2,releaseId:evil()}'), /Nonliteral/);
});

const apiFields = {
  stage: 'latest_stage',
  trigger: 'deployment_trigger',
  message: 'commit_message',
  info: 'result_info',
  pages: 'total_pages',
  canonical: 'canonical_deployment',
  created: 'created_on'
} as const;

function pagesApi() {
  const release = manifest('candidate');
  const deployed = {
    id: 'deployment-1',
    url: 'https://1234.ciphermaniac.pages.dev',
    environment: 'production',
    [apiFields.created]: new Date(NOW).toISOString(),
    [apiFields.stage]: { name: 'deploy', status: 'success' },
    [apiFields.trigger]: { type: 'ad_hoc', metadata: { [apiFields.message]: 'ciphermaniac:attempt-1' } }
  };
  const requests: string[] = [];
  let inventory: unknown[][] = [[deployed]];
  let marker: unknown = { manifest: release, attemptId: 'attempt-1' };
  let totalPages = 1;
  const request: typeof fetch = async input => {
    const url = String(input);
    requests.push(url);
    if (url.endsWith('/deployment-release.json')) {
      return Response.json(marker);
    }
    if (url.includes('/deployments?')) {
      assert.equal(new URL(url).searchParams.get('per_page'), '25');
      const page = Number(new URL(url).searchParams.get('page'));
      return Response.json({
        success: true,
        result: inventory[page - 1] ?? [],
        [apiFields.info]: { [apiFields.pages]: totalPages }
      });
    }
    return Response.json({ success: true, result: { [apiFields.canonical]: deployed } });
  };
  return {
    reader: createPagesReader('account', 'token', request),
    deployed,
    release,
    requests,
    inventory(value: unknown[], pages = 1) {
      inventory = [value];
      totalPages = pages;
    },
    history(value: unknown[][], pages = value.length) {
      inventory = value;
      totalPages = pages;
    },
    marker(value: unknown) {
      marker = value;
    }
  };
}

test('Pages adapter paginates inventory and verifies marker against deployment attempt identity', async () => {
  const f = pagesApi();
  const earlier = {
    ...f.deployed,
    id: 'earlier',
    [apiFields.trigger]: { type: 'ad_hoc', metadata: { [apiFields.message]: 'ciphermaniac:earlier' } }
  };
  f.history([[f.deployed], [earlier]], 38);
  const state = await f.reader.inspect({
    earlier: { releaseId: 'older', startedAt: new Date(NOW - 1000).toISOString() }
  });
  assert.equal(state.deployed.attemptId, 'attempt-1');
  assert.equal(f.requests.filter(url => url.includes('/deployments?')).length, 2);
  assert.deepEqual(await f.reader.manifest(state.deployed), f.release);
  f.marker({ manifest: f.release, attemptId: 'other' });
  await assert.rejects(f.reader.manifest(state.deployed), /identity disagree/);
});

test('Pages adapter fails closed on running, malformed, incomplete, or failed deployed state', async () => {
  const f = pagesApi();
  for (const latestStage of [
    { name: 'deploy', status: 'active' },
    { name: 'build', status: 'success' },
    { name: 'queued', status: 'idle' }
  ]) {
    f.inventory([{ ...f.deployed, [apiFields.stage]: latestStage }]);
    await assert.rejects(f.reader.inspect(), /unresolved/);
  }
  f.inventory([{ ...f.deployed, url: 'https://untrusted.example' }]);
  await assert.rejects(f.reader.inspect(), /identity/);
  f.inventory([f.deployed], NaN);
  await assert.rejects(f.reader.inspect(), /Incomplete/);
  f.deployed[apiFields.stage].status = 'failure';
  await assert.rejects(f.reader.inspect(), /not a successful/);
});

test('an ambiguous manifest write is idempotent and a failed pin cannot start an attempt', async () => {
  const f = fixture();
  const { putIfAbsent, createIfAbsent } = f.store;
  f.store.putIfAbsent = async (key, body) => {
    await putIfAbsent(key, body);
    throw new Error('Write response lost');
  };
  await persistCandidate(f.store, manifest('candidate'));
  assert.ok(f.journal().candidates.candidate);
  f.store.createIfAbsent = async () => {
    throw new Error('Pin write failed');
  };
  f.objects.delete(DEPLOYMENT_STATE_KEY);
  await assert.rejects(recordAttempt(f.store, manifest('another'), 'attempt', '2026-09-12T00:00:00Z'), /Pin write/);
  assert.equal(f.journal().attempts.attempt, undefined);
  f.store.createIfAbsent = createIfAbsent;
  await persistCandidate(f.store, manifest('another'));
  assert.ok(f.journal().candidates.another);
});

test('verification does not unpin a release with another attempt whose outcome is unknown', async () => {
  const f = await initialized();
  const candidate = manifest('candidate');
  await recordAttempt(f.store, candidate, 'unknown', '2026-09-12T00:00:00Z');
  await recordAttempt(f.store, candidate, 'success', '2026-09-12T00:00:01Z');
  f.deploy(candidate, 'success');
  await reconcileDeployment(f.store, f.pages);
  assert.ok(f.journal().candidates.candidate);
  await assert.rejects(recordAttempt(f.store, candidate, 'success', '2026-09-12T00:00:02Z'), /already exists/);
});

test('Pages adapter verifies legacy bundles and refuses inaccessible release metadata', async () => {
  const deployed = { id: 'old', url: 'https://old.ciphermaniac.pages.dev', status: 'success' };
  const release = manifest('legacy');
  let assetStatus = 200;
  let markerStatus = 404;
  const request: typeof fetch = async input => {
    const url = String(input);
    if (url.endsWith('/deployment-release.json')) {
      return new Response('missing', { status: markerStatus });
    }
    if (url.endsWith('.js')) {
      return new Response(`const data=${JSON.stringify(release)}`, { status: assetStatus });
    }
    return new Response('<script src="/assets/release-123.js"></script>');
  };
  const reader = createPagesReader('account', 'token', request);
  assert.deepEqual(await reader.manifest(deployed), release);
  assetStatus = 503;
  await assert.rejects(reader.manifest(deployed), /legacy Pages bundle/);
  markerStatus = 503;
  await assert.rejects(reader.manifest(deployed), /manifest read failed/);
});

test('the next code deployment repairs divergence before embedding data, and cannot embed on recovery failure', async () => {
  const f = await initialized();
  const candidate = manifest('candidate');
  await recordAttempt(f.store, candidate, 'interrupted', '2026-09-12T00:00:00Z');
  f.deploy(candidate, 'interrupted');
  const directory = await mkdtemp(join(tmpdir(), 'ciphermaniac-recovery-'));
  try {
    const output = join(directory, 'release.ts');
    f.pointerFails(true);
    await assert.rejects(prepareDeployment(f.store, f.pages, output), /conflict/);
    await assert.rejects(readFile(output), /ENOENT/);
    f.pointerFails(false);
    await prepareDeployment(f.store, f.pages, output);
    assert.equal(await readFile(output, 'utf8'), renderModule(candidate));
    assert.equal((JSON.parse(f.objects.get('current.json')!) as { releaseId: string }).releaseId, 'candidate');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('malformed journal pins and attempts fail closed', () => {
  for (const state of [
    {},
    { version: 1, candidates: [], attempts: {} },
    { version: 1, candidates: { bad: 'reports/raw.json' }, attempts: {} },
    { version: 1, candidates: {}, attempts: { attempt: { releaseId: 'candidate', startedAt: 'bad' } } }
  ]) {
    assert.throws(() => deploymentState(state));
  }
});

test('a matching attempt identity cannot promote different data than its recorded candidate', async () => {
  const f = await initialized();
  await recordAttempt(f.store, manifest('candidate'), 'attempt', '2026-09-12T00:00:00Z');
  f.deploy(manifest('old'), 'attempt');
  await assert.rejects(reconcileDeployment(f.store, f.pages, 'attempt'), /candidate attempt disagree/);
  assert.ok(f.journal().candidates.candidate);
});

test('dormant GitHub production pushes do not block ad-hoc publication', async () => {
  const f = pagesApi();
  const dormant = {
    ...f.deployed,
    id: 'dormant',
    [apiFields.stage]: { name: 'queued', status: 'idle' },
    [apiFields.trigger]: { type: 'github:push', metadata: { [apiFields.message]: 'ordinary push' } }
  };
  f.history([[dormant, f.deployed]], 38);
  await f.reader.inspect();
  assert.equal(f.requests.filter(url => url.includes('/deployments?')).length, 1);
  f.inventory([{ ...dormant, [apiFields.trigger]: { type: 'ad_hoc' } }]);
  await assert.rejects(f.reader.inspect(), /unresolved/);
  f.inventory([
    {
      ...dormant,
      [apiFields.trigger]: { type: 'github:push', metadata: { [apiFields.message]: 'ciphermaniac:known' } }
    }
  ]);
  await assert.rejects(f.reader.inspect(), /unresolved/);
});

test('inventory stops at the oldest unresolved attempt rather than scanning 937 historical deployments', async () => {
  const f = pagesApi();
  const old = { ...f.deployed, id: 'old', [apiFields.created]: new Date(NOW - 1000).toISOString() };
  f.history([[old]], 38);
  const missing = { releaseId: 'missing', startedAt: new Date(NOW).toISOString() };
  await f.reader.inspect({ missing });
  assert.equal(f.requests.filter(url => url.includes('/deployments?')).length, 1);
  f.requests.length = 0;
  f.history([[f.deployed, old]], 38);
  await f.reader.inspect({ missing });
  assert.equal(f.requests.filter(url => url.includes('/deployments?')).length, 1);
  f.requests.length = 0;
  f.history([[{ ...old, [apiFields.created]: new Date(NOW).toISOString() }], [old]], 38);
  await f.reader.inspect({ missing });
  assert.equal(f.requests.filter(url => url.includes('/deployments?')).length, 2);
});

test('never-started candidates and missing Pages attempts expire only after timeout and grace', async () => {
  const f = await initialized();
  await persistCandidate(f.store, manifest('prepared'), NOW);
  await persistCandidate(f.store, manifest('attempted'), NOW);
  await recordAttempt(f.store, manifest('attempted'), 'missing', new Date(NOW).toISOString());
  await reconcileDeployment(f.store, f.pages, undefined, { now: NOW + ATTEMPT_ABANDON_MS - 1 });
  assert.equal(f.journal().attempts.missing.status, undefined);
  await reconcileDeployment(f.store, f.pages, undefined, { now: NOW + ATTEMPT_ABANDON_MS });
  assert.equal(f.journal().attempts.missing.status, 'abandoned');
  assert.ok(f.journal().candidates.attempted);
  await reconcileDeployment(f.store, f.pages, undefined, { now: NOW + CANDIDATE_GRACE_MS });
  assert.equal(f.journal().candidates.prepared, undefined);
  assert.ok(f.journal().candidates.attempted);
  await reconcileDeployment(f.store, f.pages, undefined, { now: NOW + ATTEMPT_ABANDON_MS + CANDIDATE_GRACE_MS });
  assert.deepEqual(f.journal().candidates, {});
  assert.deepEqual(f.journal().attempts, {});
});

test('Pages errors cannot abandon old attempts or release their pins', async () => {
  const f = await initialized();
  await recordAttempt(f.store, manifest('candidate'), 'missing', new Date(NOW).toISOString());
  f.ambiguous(true);
  await assert.rejects(
    reconcileDeployment(f.store, f.pages, undefined, { now: NOW + 10 * CANDIDATE_GRACE_MS }),
    /Ambiguous/
  );
  assert.ok(f.journal().candidates.candidate);
  assert.equal(f.journal().attempts.missing.status, undefined);
});

test('failed attempts resolve without abandonment, unpin after grace, and compact', async () => {
  const f = await initialized();
  await persistCandidate(f.store, manifest('failed'), NOW);
  await recordAttempt(f.store, manifest('failed'), 'failed', new Date(NOW).toISOString());
  const { inspect } = f.pages;
  f.pages.inspect = async () => {
    const state = await inspect();
    state.deployments.push({
      id: 'pages-failed',
      url: 'https://pages-failed.ciphermaniac.pages.dev',
      attemptId: 'failed',
      status: 'failure'
    });
    return state;
  };
  await reconcileDeployment(f.store, f.pages);
  assert.equal(f.journal().attempts.failed.status, 'failure');
  assert.ok(f.journal().candidates.failed);
  await reconcileDeployment(f.store, f.pages, undefined, { now: NOW + CANDIDATE_GRACE_MS });
  assert.equal(f.journal().candidates.failed, undefined);
  assert.equal(f.journal().attempts.failed, undefined);
});

test('resolved attempts compact while the deployed identity remains usable for later rollback', async () => {
  const f = await initialized();
  await recordAttempt(f.store, manifest('first'), 'first', new Date(NOW).toISOString());
  f.deploy(manifest('first'), 'first');
  await reconcileDeployment(f.store, f.pages);
  await recordAttempt(f.store, manifest('next'), 'next', new Date(NOW).toISOString());
  f.deploy(manifest('next'), 'next');
  await reconcileDeployment(f.store, f.pages);
  await reconcileDeployment(f.store, f.pages, undefined, { now: NOW + CANDIDATE_GRACE_MS });
  assert.equal(f.journal().attempts.first, undefined);
  assert.ok(f.journal().attempts.next);
  f.deploy(manifest('first'), 'first');
  assert.equal((await reconcileDeployment(f.store, f.pages)).releaseId, 'first');
});

test('Pages propagation polls with bounded backoff before promoting exactly once', async () => {
  const f = await initialized();
  await recordAttempt(f.store, manifest('candidate'), 'expected', new Date(NOW).toISOString());
  const { inspect } = f.pages;
  let calls = 0;
  f.pages.inspect = async () => {
    calls++;
    if (calls === 1) {
      throw new Error('Pages production is not a successful deployment');
    }
    if (calls === 3) {
      f.deploy(manifest('candidate'), 'expected');
    }
    return inspect();
  };
  const waits: number[] = [];
  await reconcileDeployment(f.store, f.pages, 'expected', {
    wait: async milliseconds => {
      waits.push(milliseconds);
    }
  });
  assert.deepEqual(waits, [1000, 2000]);
  assert.equal(f.journal().deployed?.releaseId, 'candidate');
});

test('polling exhausts after five attempts and never retries an R2 pointer conflict', async () => {
  const f = await initialized();
  const waits: number[] = [];
  const options = {
    wait: async (milliseconds: number) => {
      waits.push(milliseconds);
    }
  };
  await assert.rejects(reconcileDeployment(f.store, f.pages, 'missing', options), /not serving/);
  assert.deepEqual(waits, [1000, 2000, 4000, 8000]);
  assert.equal(f.journal().deployed?.releaseId, 'old');
  waits.length = 0;
  await recordAttempt(f.store, manifest('candidate'), 'expected', new Date(NOW).toISOString());
  f.deploy(manifest('candidate'), 'expected');
  f.pointerFails(true);
  await assert.rejects(reconcileDeployment(f.store, f.pages, 'expected', options), /conflict/);
  assert.deepEqual(waits, []);
  assert.ok(f.journal().candidates.candidate);
});

test('existing journals migrate missing pin and resolution timestamps without shortening grace', async () => {
  const f = await initialized();
  await persistCandidate(f.store, manifest('prepared'), NOW);
  await recordAttempt(f.store, manifest('failed'), 'failed', new Date(NOW).toISOString());
  const legacy = f.journal();
  delete legacy.pinnedAt;
  legacy.attempts.failed.status = 'failure';
  f.objects.set(DEPLOYMENT_STATE_KEY, JSON.stringify(legacy));
  await reconcileDeployment(f.store, f.pages);
  assert.equal(f.journal().pinnedAt?.prepared, new Date(NOW).toISOString());
  assert.equal(f.journal().attempts.failed.resolvedAt, new Date(NOW).toISOString());
  await reconcileDeployment(f.store, f.pages, undefined, { now: NOW + CANDIDATE_GRACE_MS - 1 });
  assert.ok(f.journal().candidates.prepared);
  await reconcileDeployment(f.store, f.pages, undefined, { now: NOW + CANDIDATE_GRACE_MS });
  assert.deepEqual(f.journal().candidates, {});
  assert.deepEqual(f.journal().attempts, {});
  assert.throws(() => deploymentState({ ...legacy, pinnedAt: { prepared: 'invalid' } }), /timestamp/);
});

test('release-marker propagation retries without promoting incomplete metadata', async () => {
  const f = await initialized();
  await recordAttempt(f.store, manifest('candidate'), 'expected', new Date(NOW).toISOString());
  f.deploy(manifest('candidate'), 'expected');
  const readManifest = f.pages.manifest;
  let calls = 0;
  f.pages.manifest = async deployed => {
    if (++calls === 1) {
      throw new Error('Pages manifest read failed: HTTP 503');
    }
    return readManifest(deployed);
  };
  const waits: number[] = [];
  await reconcileDeployment(f.store, f.pages, 'expected', {
    wait: async milliseconds => {
      waits.push(milliseconds);
    }
  });
  assert.deepEqual(waits, [1000]);
  assert.equal(f.journal().deployed?.releaseId, 'candidate');
});
