/**
 * The admin routes end to end, against the real schema in SQLite and a
 * proofs bucket in memory. What must hold: only an Admin gets anything from
 * them; an Admin works the queue of Applications oldest first, sees each
 * proof only through its own request, with headers that keep it inert, and
 * decides each once, approving making the store asked for and the proof
 * going either way; Community organizers lose and regain the right to start
 * events, Admins never; stores are revoked, restored and handed to a new
 * Manager; accounts are found by POP ID, email or ID; and a POP ID moves
 * between accounts whole, its History with it and its players let go.
 */

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import * as accounts from '../../functions/api/admin/accounts.ts';
import * as adminApplications from '../../functions/api/admin/applications/index.ts';
import * as decide from '../../functions/api/admin/applications/[id].ts';
import * as proofFile from '../../functions/api/admin/applications/[id]/proof.ts';
import * as organizers from '../../functions/api/admin/organizers/index.ts';
import * as organizer from '../../functions/api/admin/organizers/[id].ts';
import * as popIds from '../../functions/api/admin/pop-ids.ts';
import * as adminStores from '../../functions/api/admin/stores/index.ts';
import * as adminStore from '../../functions/api/admin/stores/[id].ts';
import * as applications from '../../functions/api/applications/index.ts';
import * as proof from '../../functions/api/applications/proof.ts';
import * as history from '../../functions/api/history.ts';
import * as me from '../../functions/api/me.ts';
import * as report from '../../functions/api/tournaments/[code]/report.ts';
import * as tournaments from '../../functions/api/tournaments/index.ts';
import type { TournamentEnv } from '../../functions/lib/auth/env.ts';
import { apiCalls, type Call, type Handler, ORIGIN } from '../__utils__/apiCalls.ts';
import { at, eventCalls } from '../__utils__/eventCalls.ts';
import { memoryProofs, stalledDeletes } from '../__utils__/proofBucket.ts';
import { storeApplication } from '../__utils__/storeApplication.ts';
import { sqliteD1 } from '../__utils__/sqliteD1.ts';

let env: TournamentEnv;
let proofs: ReturnType<typeof memoryProofs>;
const { hit, signIn } = apiCalls(() => env);
const { newSwiss, send, addPlayers, settle, playerSays } = eventCalls(hit);

beforeEach(() => {
  proofs = memoryProofs();
  env = { TOURNAMENT_DB: sqliteD1('tournaments.sql'), DEV_LOGIN: 'true', PROOFS: proofs };
  proof._resetRateLimitStore();
  applications._resetRateLimitStore();
  report._resetRateLimitStore();
});

/** The test database itself, for what no request sets. */
const raw = () => (env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>).raw;

const profileOf = (popId: string, lastName = 'Player') => ({
  popId,
  firstName: 'Pat',
  lastName,
  birthDate: '02/27/2001'
});

/** The account's id, read through /api/me as the page would. */
async function idOf(cookie: string): Promise<string> {
  return (await hit(me.onRequestGet as Handler, '/api/me', {}, { cookie })).json.user.id as string;
}

/** An account signed in with its profile saved under `popId`. */
async function player(name: string, popId: string) {
  const cookie = await signIn(name);
  const saved = await hit(me.onRequestPut as Handler, '/api/me', {}, { method: 'PUT', cookie, body: profileOf(popId) });
  assert.equal(saved.status, 200);
  return cookie;
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const PDF = new TextEncoder().encode('%PDF-1.7\n%');

async function upload(cookie: string, body: Uint8Array<ArrayBuffer>) {
  const request = new Request(`${ORIGIN}/api/applications/proof`, {
    method: 'PUT',
    headers: { origin: ORIGIN, cookie },
    body
  });
  const response = await proof.onRequestPut({ request, env, params: {} } as never);
  assert.equal(response.status, 200);
}

/** An account that has applied, with `file` as its proof when given; answers its cookie and the Application's id. */
async function applied(name: string, popId: string, file?: Uint8Array<ArrayBuffer>) {
  const cookie = await player(name, popId);
  if (file) {
    await upload(cookie, file);
  }
  const sent = await hit(
    applications.onRequestPost as Handler,
    '/api/applications',
    {},
    {
      method: 'POST',
      cookie,
      body: { store: storeApplication(`77${popId}`), explanation: `${name} runs a league`, proof: Boolean(file) }
    }
  );
  assert.equal(sent.status, 201);
  return { cookie, id: sent.json.application.id as string };
}

const list = (cookie: string, status = '') =>
  hit(
    adminApplications.onRequestGet as Handler,
    `/api/admin/applications${status && `?status=${status}`}`,
    {},
    {
      cookie
    }
  );

const decision = (cookie: string, id: string, body: unknown) =>
  hit(decide.onRequestPost as Handler, `/api/admin/applications/${id}`, { id }, { method: 'POST', cookie, body });

/** The proof as the admin page's request gets it: status, headers and bytes. */
async function viewProof(cookie: string | undefined, id: string) {
  const request = new Request(`${ORIGIN}/api/admin/applications/${id}/proof`, {
    headers: cookie ? { cookie } : {}
  });
  const response = await proofFile.onRequestGet({ request, env, params: { id } } as never);
  return { status: response.status, headers: response.headers, bytes: new Uint8Array(await response.arrayBuffer()) };
}

const setRole = (cookie: string, id: string, role: unknown) =>
  hit(
    organizer.onRequestPost as Handler,
    `/api/admin/organizers/${id}`,
    { id },
    {
      method: 'POST',
      cookie,
      body: { role }
    }
  );

const lookUp = (cookie: string, query: string) =>
  hit(accounts.onRequestGet as Handler, `/api/admin/accounts?${query}`, {}, { cookie });

const move = (cookie: string, body: unknown) =>
  hit(popIds.onRequestPost as Handler, '/api/admin/pop-ids', {}, { method: 'POST', cookie, body });

/** Starts an event: the account's own on `day` (one a day for a Community organizer), or for `store`. */
const createEvent = (cookie: string, where: { day?: number; store?: string } = {}) =>
  hit(
    tournaments.onRequestPost as Handler,
    '/api/tournaments',
    {},
    {
      method: 'POST',
      cookie,
      body: {
        mode: 'swiss',
        name: 'Test Cup',
        settings: { startsAt: `2026-11-${String(where.day ?? 1).padStart(2, '0')}T18:00` },
        ...(where.store ? { store: where.store } : {})
      }
    }
  );

/** The stores the account belongs to, as /api/me says. */
const storesOf = async (cookie: string): Promise<{ id: string; role: string; leagueId: string }[]> =>
  (await hit(me.onRequestGet as Handler, '/api/me', {}, { cookie })).json.user.stores;

const storeAct = (cookie: string, id: string, body: unknown) =>
  hit(adminStore.onRequestPost as Handler, `/api/admin/stores/${id}`, { id }, { method: 'POST', cookie, body });

test('every admin route answers only an Admin', async () => {
  const { id } = await applied('Applicant', '100', PNG);
  const target = await idOf(await signIn('Target', 'community'));
  const calls: [string, (call: Call) => Promise<{ status: number }>][] = [
    ['list', call => hit(adminApplications.onRequestGet as Handler, '/api/admin/applications', {}, call)],
    [
      'decide',
      call =>
        hit(
          decide.onRequestPost as Handler,
          `/x/${id}`,
          { id },
          { ...call, method: 'POST', body: { decision: 'approve' } }
        )
    ],
    ['proof', call => viewProof(call.cookie, id)],
    ['organizers', call => hit(organizers.onRequestGet as Handler, '/api/admin/organizers', {}, call)],
    [
      'revoke',
      call =>
        hit(
          organizer.onRequestPost as Handler,
          `/x/${target}`,
          { id: target },
          {
            ...call,
            method: 'POST',
            body: { role: 'revoked' }
          }
        )
    ],
    ['accounts', call => hit(accounts.onRequestGet as Handler, '/api/admin/accounts?popId=100', {}, call)],
    ['stores', call => hit(adminStores.onRequestGet as Handler, '/api/admin/stores', {}, call)],
    [
      'store',
      call =>
        hit(
          adminStore.onRequestPost as Handler,
          '/x/s',
          { id: 's' },
          { ...call, method: 'POST', body: { status: 'revoked' } }
        )
    ],
    [
      'pop-ids',
      call =>
        hit(
          popIds.onRequestPost as Handler,
          '/api/admin/pop-ids',
          {},
          {
            ...call,
            method: 'POST',
            body: { popId: '100', accountId: null }
          }
        )
    ]
  ];
  const askers: [string | undefined, number][] = [
    [undefined, 401],
    [await signIn('Plain'), 403],
    [await signIn('Organizer', 'organizer'), 403],
    [await signIn('Revoked', 'revoked'), 403]
  ];
  for (const [name, call] of calls) {
    for (const [cookie, status] of askers) {
      assert.equal((await call({ cookie })).status, status, `${name} for ${cookie ? 'a non-admin' : 'no one'}`);
    }
  }
  const admin = await signIn('Admin', 'admin');
  assert.equal(
    (await hit(organizers.onRequestGet as Handler, '/api/admin/organizers', {}, { cookie: admin })).status,
    200
  );
  const fromElsewhere = await hit(
    organizer.onRequestPost as Handler,
    `/x/${target}`,
    { id: target },
    {
      method: 'POST',
      cookie: admin,
      origin: 'https://elsewhere.test',
      body: { role: 'revoked' }
    }
  );
  assert.equal(fromElsewhere.status, 403);
  assert.equal(raw().prepare('SELECT role FROM users WHERE id = ?').get(target)?.role, 'community');
  assert.equal(raw().prepare('SELECT status FROM applications WHERE id = ?').get(id)?.status, 'pending');
  delete env.TOURNAMENT_DB;
  assert.equal(
    (await hit(organizers.onRequestGet as Handler, '/api/admin/organizers', {}, { cookie: admin })).status,
    503
  );
});

test('pending Applications come oldest first, with the account as it is now and as it applied', async () => {
  const admin = await signIn('Admin', 'admin');
  const first = await applied('First', '101', PNG);
  const second = await applied('Second', '102');
  raw().prepare('UPDATE applications SET created_at = 1 WHERE id = ?').run(first.id);
  await hit(
    me.onRequestPut as Handler,
    '/api/me',
    {},
    {
      method: 'PUT',
      cookie: first.cookie,
      body: profileOf('201', 'Renamed')
    }
  );
  const pending = await list(admin);
  assert.equal(pending.status, 200);
  assert.deepEqual(
    pending.json.applications.map((application: { id: string }) => application.id),
    [first.id, second.id]
  );
  const [shown] = pending.json.applications;
  assert.deepEqual(shown.account, {
    id: await idOf(first.cookie),
    name: 'Pat Renamed',
    email: null,
    popId: '201',
    role: null
  });
  assert.deepEqual(shown.applied, { popId: '101', firstName: 'Pat', lastName: 'Player' });
  assert.deepEqual(
    [shown.status, shown.explanation, shown.proofType, shown.hasProof],
    ['pending', 'First runs a league', 'image/png', true]
  );
  assert.equal(shown.decidedBy, null);
  assert.equal(pending.json.applications[1].hasProof, false);
  assert.deepEqual((await list(admin, 'approved')).json.applications, []);
  assert.equal((await list(admin, 'withdrawn')).status, 400);
});

test('a proof goes to an Admin inert: its own type, never cached, never sniffed, sandboxed', async () => {
  const admin = await signIn('Admin', 'admin');
  const image = await applied('Image', '103', PNG);
  const shown = await viewProof(admin, image.id);
  assert.equal(shown.status, 200);
  assert.deepEqual(shown.bytes, PNG);
  assert.equal(shown.headers.get('content-type'), 'image/png');
  assert.equal(shown.headers.get('content-disposition'), 'inline; filename="proof.png"');
  assert.equal(shown.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(shown.headers.get('cache-control'), 'private, no-store');
  assert.equal(shown.headers.get('content-security-policy'), "default-src 'none'; sandbox");
  const document = await applied('Document', '104', PDF);
  const pdf = await viewProof(admin, document.id);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.equal(
    pdf.headers.get('content-disposition'),
    'attachment; filename="proof.pdf"',
    'a PDF is not drawn on the site'
  );
  // Whatever else a slot came to hold is only ever bytes to download.
  const key = raw().prepare('SELECT proof_key FROM applications WHERE id = ?').get(document.id)?.proof_key as string;
  proofs.objects.set(key, { ...proofs.objects.get(key)!, bytes: new Uint8Array([60, 104]), contentType: 'text/html' });
  const odd = await viewProof(admin, document.id);
  assert.equal(odd.headers.get('content-type'), 'application/octet-stream');
  assert.equal(odd.headers.get('content-disposition'), 'attachment; filename="proof.bin"');
});

test('there is no proof to see without one, for an unknown Application, or without the bucket', async () => {
  const admin = await signIn('Admin', 'admin');
  const wordsOnly = await applied('Words', '105');
  assert.equal((await viewProof(admin, wordsOnly.id)).status, 404);
  assert.equal((await viewProof(admin, 'nope')).status, 404);
  const withFile = await applied('File', '106', PNG);
  proofs.objects.clear();
  assert.equal((await viewProof(admin, withFile.id)).status, 404, 'a file gone from the bucket');
  delete env.PROOFS;
  assert.equal((await viewProof(admin, withFile.id)).status, 503);
});

test('a proof uploaded while its Application is being sent leaves the one sent as it was', async () => {
  const admin = await signIn('Admin', 'admin');
  const cookie = await player('Applicant', '114');
  await upload(cookie, PNG);
  let id = '';
  // A second file is still arriving when another tab sends the Application with the first.
  const arriving = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        const sent = await hit(
          applications.onRequestPost as Handler,
          '/api/applications',
          {},
          {
            method: 'POST',
            cookie,
            body: { store: storeApplication('77114'), explanation: '', proof: true }
          }
        );
        id = sent.json.application.id as string;
        controller.enqueue(PDF);
        controller.close();
      }
    },
    { highWaterMark: 0 }
  );
  const request = new Request(`${ORIGIN}/api/applications/proof`, {
    method: 'PUT',
    headers: { origin: ORIGIN, cookie },
    body: arriving,
    duplex: 'half'
  } as RequestInit);
  const late = await proof.onRequestPut({ request, env, params: {} } as never);
  // It passed its checks before the send landed, and is refused when it lands after.
  assert.deepEqual(
    [late.status, ((await late.json()) as { error: string }).error],
    [409, 'Your application is pending']
  );
  const [listed] = (await list(admin)).json.applications;
  assert.deepEqual([listed.id, listed.proofType, listed.hasProof], [id, 'image/png', true]);
  const shown = await viewProof(admin, id);
  assert.deepEqual([shown.status, shown.bytes], [200, PNG]);
  assert.equal(proofs.objects.size, 1, 'the refused file is not kept');
});

test('the delete after a decision takes that Application’s proof alone, however late it lands', async () => {
  const admin = await signIn('Admin', 'admin');
  const { cookie, id } = await applied('Applicant', '115', PNG);
  const stalled = stalledDeletes(proofs);
  env.PROOFS = stalled.bucket;
  const kept: Promise<unknown>[] = [];
  const rejected = await decide.onRequestPost({
    request: new Request(`${ORIGIN}/api/admin/applications/${id}`, {
      method: 'POST',
      headers: { origin: ORIGIN, cookie: admin, 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'reject' })
    }),
    env,
    params: { id },
    waitUntil: (work: Promise<unknown>) => kept.push(work)
  } as never);
  assert.equal(rejected.status, 200);
  // The account applies again with another file before R2 has deleted the first.
  await upload(cookie, PDF);
  const again = await hit(
    applications.onRequestPost as Handler,
    '/api/applications',
    {},
    { method: 'POST', cookie, body: { store: storeApplication('77115'), explanation: '', proof: true } }
  );
  assert.equal(again.status, 201);
  stalled.release();
  await Promise.all(kept);
  const shown = await viewProof(admin, again.json.application.id as string);
  assert.deepEqual([shown.status, shown.bytes], [200, PDF]);
  assert.equal(proofs.objects.size, 1, 'the first proof is gone');
});

test('approving makes the store with the applicant its Manager, records who decided, and deletes the proof', async () => {
  const admin = await signIn('Admin', 'admin');
  const adminId = await idOf(admin);
  const { cookie, id } = await applied('Applicant', '107', PNG);
  assert.equal((await createEvent(cookie)).status, 403);
  const approved = await decision(admin, id, { decision: 'approve', note: '  Welcome aboard  ' });
  assert.equal(approved.status, 200);
  const { application } = approved.json;
  assert.deepEqual(
    [application.status, application.note, application.hasProof, application.proofType],
    ['approved', 'Welcome aboard', false, 'image/png']
  );
  assert.deepEqual(application.decidedBy, { id: adminId, name: 'admin' });
  assert.equal(application.account.role, null, 'a store is not a role');
  assert.equal(application.leagueTaken?.name, 'Combat Power Gaming', 'the league is the new store’s now');
  const [store] = await storesOf(cookie);
  assert.deepEqual([store?.role, store?.leagueId], ['manager', '77107']);
  const made = raw().prepare('SELECT time_zone AS zone, nights, lat FROM stores WHERE id = ?').get(store!.id);
  assert.deepEqual(
    [made?.zone, JSON.parse(String(made?.nights)).length, made?.lat],
    ['America/Chicago', 2, 29.4928],
    'as the application said'
  );
  assert.equal(proofs.objects.size, 0);
  assert.equal((await createEvent(cookie, { store: store!.id })).status, 201);
  const again = await decision(admin, id, { decision: 'reject' });
  assert.deepEqual([again.status, again.json.error], [409, 'Already decided']);
  assert.equal(raw().prepare('SELECT COUNT(*) AS n FROM stores').get()?.n, 1);
  assert.deepEqual(
    (await list(admin, 'approved')).json.applications.map((shown: { id: string }) => shown.id),
    [id]
  );
});

test('rejecting makes no store, leaves the role as it was, and deletes the proof', async () => {
  const admin = await signIn('Admin', 'admin');
  const { cookie, id } = await applied('Applicant', '108', PDF);
  raw().prepare("UPDATE users SET role = 'revoked' WHERE handle = 'applicant'").run();
  const rejected = await decision(admin, id, { decision: 'reject' });
  assert.equal(rejected.status, 200);
  assert.deepEqual([rejected.json.application.status, rejected.json.application.note], ['rejected', null]);
  assert.equal(raw().prepare("SELECT role FROM users WHERE handle = 'applicant'").get()?.role, 'revoked');
  assert.equal(proofs.objects.size, 0);
  assert.deepEqual(await storesOf(cookie), []);
  const plain = await applied('Plain', '109');
  await decision(admin, plain.id, { decision: 'reject', note: 'Send your certificate' });
  assert.equal(raw().prepare('SELECT COUNT(*) AS n FROM stores').get()?.n, 0);
  assert.deepEqual(
    (await list(admin, 'rejected')).json.applications.map((shown: { id: string }) => shown.id).sort(),
    [id, plain.id].sort()
  );
});

test('a league that already has a store is shown as taken and cannot be approved again', async () => {
  const admin = await signIn('Admin', 'admin');
  const first = await applied('First', '110');
  await decision(admin, first.id, { decision: 'approve' });
  const rival = await player('Rival', '111');
  const sent = await hit(
    applications.onRequestPost as Handler,
    '/api/applications',
    {},
    {
      method: 'POST',
      cookie: rival,
      body: { store: storeApplication('77110'), proof: false }
    }
  );
  assert.equal(sent.status, 201, 'a dispute reaches an Admin');
  const [pending] = (await list(admin)).json.applications;
  assert.equal(pending.leagueTaken.name, 'Combat Power Gaming');
  const clash = await decision(admin, sent.json.application.id, { decision: 'approve' });
  assert.deepEqual([clash.status, clash.json.error], [409, 'That league already has a store']);
  assert.equal(
    raw().prepare('SELECT status FROM applications WHERE id = ?').get(sent.json.application.id)?.status,
    'pending'
  );
  assert.equal(raw().prepare('SELECT COUNT(*) AS n FROM store_members').get()?.n, 1);
});

test('an Application from before stores can only be rejected', async () => {
  const admin = await signIn('Admin', 'admin');
  const { id } = await applied('Applicant', '116');
  raw().prepare('UPDATE applications SET store = NULL WHERE id = ?').run(id);
  assert.equal((await decision(admin, id, { decision: 'approve' })).status, 400);
  assert.equal((await decision(admin, id, { decision: 'reject' })).status, 200);
});

test('a decision names approve or reject, a note is short, and the Application must exist', async () => {
  const admin = await signIn('Admin', 'admin');
  const { id } = await applied('Applicant', '112');
  assert.equal((await decision(admin, id, { decision: 'maybe' })).status, 400);
  assert.equal((await decision(admin, id, 'approve')).status, 400);
  const long = await decision(admin, id, { decision: 'approve', note: 'x'.repeat(501) });
  assert.deepEqual([long.status, long.json.error], [400, 'Up to 500 characters']);
  assert.equal((await decision(admin, 'nope', { decision: 'approve' })).status, 404);
  assert.equal(raw().prepare('SELECT status FROM applications WHERE id = ?').get(id)?.status, 'pending');
});

test('a decision that loses the race to another Admin’s changes nothing', async () => {
  const admin = await signIn('Admin', 'admin');
  const { id } = await applied('Applicant', '113', PNG);
  const db = env.TOURNAMENT_DB as NonNullable<TournamentEnv['TOURNAMENT_DB']>;
  // Another Admin rejects it between this request's sign-in read and its writes.
  env.TOURNAMENT_DB = {
    ...db,
    batch: statements => {
      raw().prepare("UPDATE applications SET status = 'rejected' WHERE id = ?").run(id);
      return db.batch(statements);
    }
  };
  const late = await decision(admin, id, { decision: 'approve' });
  env.TOURNAMENT_DB = db;
  assert.equal(late.status, 409);
  assert.equal(raw().prepare('SELECT COUNT(*) AS n FROM stores').get()?.n, 0, 'no store for a rejected Application');
});

test('the Organizers list holds every account with a role and how many events it owns', async () => {
  const admin = await signIn('Admin', 'admin');
  const owner = await signIn('Busy', 'community');
  await createEvent(owner, { day: 1 });
  await createEvent(owner, { day: 2 });
  await signIn('Gone', 'revoked');
  await signIn('Plain');
  await signIn('Store Owner', 'organizer');
  const listed = await hit(organizers.onRequestGet as Handler, '/api/admin/organizers', {}, { cookie: admin });
  assert.deepEqual(
    listed.json.accounts.map((account: { name: string; role: string; events: number }) => [
      account.name,
      account.role,
      account.events
    ]),
    [
      ['admin', 'admin', 0],
      ['busy', 'community', 2],
      ['gone', 'revoked', 0]
    ]
  );
  const [first] = listed.json.accounts;
  assert.deepEqual(Object.keys(first).sort(), ['email', 'events', 'id', 'name', 'popId', 'role', 'roleAt']);
});

test('a Community organizer’s access is removed and given back; an Admin’s and a player’s are not one', async () => {
  const admin = await signIn('Admin', 'admin');
  const adminId = await idOf(admin);
  const owner = await signIn('Owner', 'community');
  const ownerId = await idOf(owner);
  const code = (await createEvent(owner, { day: 1 })).json.code as string;
  const revoked = await setRole(admin, ownerId, 'revoked');
  assert.equal(revoked.status, 200);
  assert.deepEqual([revoked.json.account.role, revoked.json.account.events], ['revoked', 1]);
  assert.equal(raw().prepare('SELECT role_by AS roleBy FROM users WHERE id = ?').get(ownerId)?.roleBy, adminId);
  assert.equal((await createEvent(owner, { day: 2 })).status, 403);
  await send(code, owner, { type: 'addPlayer', player: { firstName: 'Still', lastName: 'Running' } });
  assert.equal(
    raw().prepare("SELECT json_array_length(state, '$.players') AS n FROM tournaments WHERE code = ?").get(code)?.n,
    1,
    'it still runs its own'
  );
  assert.equal((await setRole(admin, ownerId, 'community')).json.account.role, 'community');
  assert.equal((await createEvent(owner, { day: 2 })).status, 201);
  const notOne = await setRole(admin, adminId, 'revoked');
  assert.deepEqual([notOne.status, notOne.json.error], [404, 'Not an organizer']);
  assert.equal(raw().prepare('SELECT role FROM users WHERE id = ?').get(adminId)?.role, 'admin');
  assert.equal((await setRole(admin, await idOf(await signIn('Plain')), 'community')).status, 404, 'no back door');
  assert.equal((await setRole(admin, ownerId, 'admin')).status, 400);
});

test('an Admin revokes and restores a store, and hands it to a new Manager', async () => {
  const admin = await signIn('Admin', 'admin');
  const manager = await signIn('Manager', 'organizer');
  const [store] = await storesOf(manager);
  const helper = await signIn('Helper');
  const helperId = await idOf(helper);
  const revoked = await storeAct(admin, store!.id, { status: 'revoked' });
  assert.equal(revoked.json.store.status, 'revoked');
  assert.equal((await createEvent(manager, { store: store!.id })).status, 403, 'a revoked store starts nothing');
  assert.equal((await storeAct(admin, store!.id, { status: 'active' })).json.store.status, 'active');
  const handed = await storeAct(admin, store!.id, { manager: helperId });
  assert.deepEqual(handed.json.store.managers.map((one: { name: string }) => one.name).sort(), ['helper', 'manager']);
  assert.equal((await createEvent(helper, { store: store!.id })).status, 201);
  assert.equal((await storeAct(admin, 'nope', { status: 'revoked' })).status, 404);
  assert.equal((await storeAct(admin, store!.id, { manager: 'nobody' })).status, 404);
  assert.equal((await storeAct(admin, store!.id, {})).status, 400);
  const listed = await hit(adminStores.onRequestGet as Handler, '/api/admin/stores', {}, { cookie: admin });
  assert.deepEqual(
    listed.json.stores.map((one: { name: string; status: string }) => [one.name, one.status]),
    [['Manager Games', 'active']]
  );
});

test('an Admin finds accounts by POP ID, email or ID, exactly', async () => {
  const admin = await signIn('Admin', 'admin');
  const cookie = await player('Holder', '4242');
  const id = await idOf(cookie);
  raw().prepare("UPDATE users SET email = 'holder@example.com' WHERE id = ?").run(id);
  const byPopId = await lookUp(admin, 'popId=4242');
  assert.deepEqual(
    byPopId.json.accounts.map((account: { id: string }) => account.id),
    [id]
  );
  const [found] = byPopId.json.accounts;
  assert.deepEqual(
    [found.name, found.email, found.popId, found.role, typeof found.createdAt],
    ['Pat Player', 'holder@example.com', '4242', null, 'number']
  );
  assert.equal((await lookUp(admin, 'email=holder%40example.com')).json.accounts[0].id, id);
  assert.equal((await lookUp(admin, 'email=%20HoLdEr%40EXAMPLE.COM%20')).json.accounts[0].id, id);
  assert.equal((await lookUp(admin, `id=${id}`)).json.accounts[0].name, 'Pat Player');
  assert.deepEqual((await lookUp(admin, 'popId=424')).json.accounts, [], 'no partial matches');
  assert.equal((await lookUp(admin, '')).status, 400);
  assert.equal((await lookUp(admin, 'popId=%20')).status, 400);
});

/** A sanctioned event with `popId` and one other on its list, where `cookie`'s account reports as `popId`. */
async function playing(owner: string, cookie: string, popId: string) {
  const code = await newSwiss(owner);
  await settle(code, owner, { playerReporting: true });
  for (const id of [popId, '999']) {
    await send(code, owner, {
      type: 'addPlayer',
      player: { firstName: 'Player', lastName: id, id, birthDate: '02/27/1990' }
    });
  }
  const said = await playerSays(code, { popId, device: `phone-${popId}` }, { cookie });
  assert.equal(said.json.linked, true);
  return code;
}

/** Who holds each player's reporter row at `code`: an account id, or null for a device. */
const holders = (code: string) =>
  Object.fromEntries(
    (
      raw().prepare('SELECT player_id, user_id FROM report_devices WHERE code = ?').all(code) as {
        player_id: string;
        user_id: string | null;
      }[]
    ).map(row => [row.player_id, row.user_id])
  );

const historyCodes = async (cookie: string) =>
  ((await hit(history.onRequestGet as Handler, '/api/history', {}, { cookie })).json.entries as { code: string }[]).map(
    entry => entry.code
  );

test('a POP ID moved to another account takes its History, and both accounts let go of its players', async () => {
  const admin = await signIn('Admin', 'admin');
  const owner = await signIn('Organizer', 'organizer');
  const squatter = await player('Squatter', '900');
  const rightful = await player('Rightful', '555');
  const disputed = await playing(owner, squatter, '900');
  const own = await playing(owner, rightful, '555');
  const [squatterId, rightfulId] = [await idOf(squatter), await idOf(rightful)];
  assert.deepEqual([await historyCodes(squatter), await historyCodes(rightful)], [[disputed], [own]]);
  const moved = await move(admin, { popId: '900', accountId: rightfulId });
  assert.deepEqual([moved.status, moved.json], [200, { from: squatterId, to: rightfulId }]);
  const held = raw()
    .prepare('SELECT handle, pop_id AS popId FROM users WHERE pop_id IS NOT NULL ORDER BY handle')
    .all();
  assert.deepEqual(
    held.map(row => ({ ...row })),
    [{ handle: 'rightful', popId: '900' }]
  );
  assert.deepEqual(holders(disputed), {}, 'the old holder no longer reports as the player');
  assert.deepEqual(holders(own), {}, 'the new holder lets go of the player it was under its old POP ID');
  assert.deepEqual([await historyCodes(squatter), await historyCodes(rightful)], [[], [disputed]]);
  const again = await move(admin, { popId: '900', accountId: rightfulId });
  assert.deepEqual(again.json, { from: rightfulId, to: rightfulId }, 'moving it to its holder changes nothing');
  assert.equal(raw().prepare('SELECT pop_id FROM users WHERE id = ?').get(rightfulId)?.pop_id, '900');
});

test('a POP ID is taken off its holder with no account to go to, and a move to no such account changes nothing', async () => {
  const admin = await signIn('Admin', 'admin');
  const owner = await signIn('Organizer', 'organizer');
  const holder = await player('Holder', '900');
  const code = await playing(owner, holder, '900');
  const missing = await move(admin, { popId: '900', accountId: 'nobody' });
  assert.deepEqual([missing.status, missing.json.error], [404, 'No such account']);
  assert.equal(raw().prepare("SELECT pop_id FROM users WHERE handle = 'holder'").get()?.pop_id, '900');
  assert.deepEqual(holders(code), { 900: await idOf(holder) });
  const cleared = await move(admin, { popId: '900', accountId: null });
  assert.deepEqual([cleared.status, cleared.json], [200, { from: await idOf(holder), to: null }]);
  assert.equal(raw().prepare("SELECT pop_id FROM users WHERE handle = 'holder'").get()?.pop_id, null);
  assert.deepEqual(holders(code), {});
  assert.deepEqual(await historyCodes(holder), []);
  assert.deepEqual((await move(admin, { popId: '900', accountId: null })).json, { from: null, to: null });
});

test('a move names a POP ID and an account or none', async () => {
  const admin = await signIn('Admin', 'admin');
  assert.equal((await move(admin, { popId: 'P-900', accountId: null })).status, 400);
  assert.equal((await move(admin, { popId: '12345678901', accountId: null })).status, 400);
  assert.equal((await move(admin, { popId: '900' })).status, 400);
  assert.equal((await move(admin, { popId: '900', accountId: 7 })).status, 400);
});
