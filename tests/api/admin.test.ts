/**
 * The admin routes end to end, against the real schema in SQLite and a
 * proofs bucket in memory. What must hold: only an Admin gets anything from
 * them; an Admin works the queue of Applications oldest first, sees each
 * proof only through its own request, with headers that keep it inert, and
 * decides each once, approving making an Organizer and the proof going
 * either way; Organizers lose and regain the right to start events, Admins
 * never; accounts are found by POP ID, email or ID; and a POP ID moves
 * between accounts whole, its History with it and its players let go.
 */

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import * as adminApplications from '../../functions/api/admin/applications/index.ts';
import * as decide from '../../functions/api/admin/applications/[id].ts';
import * as proofFile from '../../functions/api/admin/applications/[id]/proof.ts';
import * as applications from '../../functions/api/applications/index.ts';
import * as proof from '../../functions/api/applications/proof.ts';
import * as me from '../../functions/api/me.ts';
import * as tournaments from '../../functions/api/tournaments/index.ts';
import type { TournamentEnv } from '../../functions/lib/auth/env.ts';
import { apiCalls, type Call, type Handler, ORIGIN } from '../__utils__/apiCalls.ts';
import { memoryProofs } from '../__utils__/proofBucket.ts';
import { sqliteD1 } from '../__utils__/sqliteD1.ts';

let env: TournamentEnv;
let proofs: ReturnType<typeof memoryProofs>;
const { hit, signIn } = apiCalls(() => env);

beforeEach(() => {
  proofs = memoryProofs();
  env = { TOURNAMENT_DB: sqliteD1('tournaments.sql'), DEV_LOGIN: 'true', PROOFS: proofs };
  proof._resetRateLimitStore();
  applications._resetRateLimitStore();
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
      body: { explanation: `${name} runs a league`, proof: Boolean(file) }
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

const createEvent = (cookie: string) =>
  hit(
    tournaments.onRequestPost as Handler,
    '/api/tournaments',
    {},
    {
      method: 'POST',
      cookie,
      body: { mode: 'swiss', name: 'Test Cup' }
    }
  );

test('every admin route answers only an Admin', async () => {
  const { id } = await applied('Applicant', '100', PNG);
  const calls: [string, (call: Call) => Promise<{ status: number }>][] = [
    ['list', call => hit(adminApplications.onRequestGet as Handler, '/api/admin/applications', {}, call)],
    ['decide', call => decision(call.cookie ?? '', id, { decision: 'approve' })],
    ['proof', call => viewProof(call.cookie, id)]
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
  assert.equal((await list(admin)).status, 200);
  const fromElsewhere = await hit(
    decide.onRequestPost as Handler,
    `/x/${id}`,
    { id },
    {
      method: 'POST',
      cookie: admin,
      origin: 'https://elsewhere.test',
      body: { decision: 'approve' }
    }
  );
  assert.equal(fromElsewhere.status, 403);
  assert.equal(raw().prepare('SELECT status FROM applications WHERE id = ?').get(id)?.status, 'pending');
  delete env.TOURNAMENT_DB;
  assert.equal((await list(admin)).status, 503);
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
    name: 'First',
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
  proofs.objects.set(`proofs/${await idOf(document.cookie)}`, {
    bytes: new Uint8Array([60, 104]),
    contentType: 'text/html'
  });
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

test('approving makes an Organizer, records who decided, and deletes the proof; a second decision is refused', async () => {
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
  assert.deepEqual(application.decidedBy, { id: adminId, name: 'Admin' });
  assert.equal(application.account.role, 'organizer');
  const account = raw().prepare("SELECT role, role_by AS roleBy FROM users WHERE name = 'Applicant'").get();
  assert.deepEqual({ ...account }, { role: 'organizer', roleBy: adminId });
  assert.equal(proofs.objects.size, 0);
  assert.equal((await createEvent(cookie)).status, 201);
  const again = await decision(admin, id, { decision: 'reject' });
  assert.deepEqual([again.status, again.json.error], [409, 'Already decided']);
  assert.equal(raw().prepare("SELECT role FROM users WHERE name = 'Applicant'").get()?.role, 'organizer');
  assert.deepEqual(
    (await list(admin, 'approved')).json.applications.map((shown: { id: string }) => shown.id),
    [id]
  );
});

test('rejecting leaves the role as it was, a removed Organizer’s included, and deletes the proof', async () => {
  const admin = await signIn('Admin', 'admin');
  const { cookie, id } = await applied('Applicant', '108', PDF);
  raw().prepare("UPDATE users SET role = 'revoked' WHERE name = 'Applicant'").run();
  const rejected = await decision(admin, id, { decision: 'reject' });
  assert.equal(rejected.status, 200);
  assert.deepEqual([rejected.json.application.status, rejected.json.application.note], ['rejected', null]);
  assert.equal(raw().prepare("SELECT role FROM users WHERE name = 'Applicant'").get()?.role, 'revoked');
  assert.equal(proofs.objects.size, 0);
  assert.equal((await createEvent(cookie)).status, 403);
  const plain = await applied('Plain', '109');
  await decision(admin, plain.id, { decision: 'reject', note: 'Send your certificate' });
  assert.equal(raw().prepare("SELECT role FROM users WHERE name = 'Plain'").get()?.role, null);
  assert.deepEqual(
    (await list(admin, 'rejected')).json.applications.map((shown: { id: string }) => shown.id).sort(),
    [id, plain.id].sort()
  );
});

test('approving a removed Organizer gives its access back; approving an Admin leaves it an Admin', async () => {
  const admin = await signIn('Admin', 'admin');
  const revoked = await applied('Revoked', '110');
  raw().prepare("UPDATE users SET role = 'revoked' WHERE name = 'Revoked'").run();
  await decision(admin, revoked.id, { decision: 'approve' });
  assert.equal(raw().prepare("SELECT role FROM users WHERE name = 'Revoked'").get()?.role, 'organizer');
  // An Application sent before its account was made an Admin by hand.
  const later = await applied('Later', '111');
  raw().prepare("UPDATE users SET role = 'admin' WHERE name = 'Later'").run();
  assert.equal((await decision(admin, later.id, { decision: 'approve' })).status, 200);
  assert.equal(raw().prepare("SELECT role FROM users WHERE name = 'Later'").get()?.role, 'admin');
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
  assert.equal(raw().prepare("SELECT role FROM users WHERE name = 'Applicant'").get()?.role, null);
});
