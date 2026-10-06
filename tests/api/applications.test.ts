/**
 * Applications for a store, from the applicant's side, against the real
 * schema in SQLite and a bucket in memory. What must hold: only a signed-in
 * account with a complete profile applies, whatever its role; a proof is a
 * PNG, JPEG, WebP or PDF by its bytes, up to 8 MB, each a file of its own,
 * and an account keeps one not yet sent; an Application says what store it
 * is for and that the applicant is certified, with a proof and a note
 * optional, one pending at a time, with the profile as it stood; while it is
 * pending its proof stays as sent; withdrawing takes the Application and its
 * proof.
 */

import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';

import * as applications from '../../functions/api/applications/index.ts';
import * as mine from '../../functions/api/applications/mine.ts';
import * as proof from '../../functions/api/applications/proof.ts';
import * as me from '../../functions/api/me.ts';
import type { TournamentEnv } from '../../functions/lib/auth/env.ts';
import { PROOF_MAX_BYTES } from '../../shared/accounts/applications.ts';
import { apiCalls, type Handler, ORIGIN } from '../__utils__/apiCalls.ts';
import { memoryProofs, stalledDeletes } from '../__utils__/proofBucket.ts';
import { storeApplication } from '../__utils__/storeApplication.ts';
import { racing, sqliteD1 } from '../__utils__/sqliteD1.ts';

let env: TournamentEnv;
let proofs: ReturnType<typeof memoryProofs>;
const { hit, signIn } = apiCalls(() => env);

beforeEach(() => {
  proofs = memoryProofs();
  env = { TOURNAMENT_DB: sqliteD1('tournaments.sql'), DEV_LOGIN: 'true', PROOFS: proofs };
  proof._resetRateLimitStore();
  applications._resetRateLimitStore();
});

/** The test database itself, for what no applicant's request sets. */
const raw = () => (env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>).raw;

const PROFILE = { popId: '1234567', firstName: 'Pat', lastName: 'Player', birthDate: '02/27/2001' };

/** An account signed in with its profile saved, as only such an account may apply. */
async function applicant(name = 'Applicant', profile: Partial<typeof PROFILE> = {}) {
  const cookie = await signIn(name);
  const saved = await hit(
    me.onRequestPut as Handler,
    '/api/me',
    {},
    {
      method: 'PUT',
      cookie,
      body: { ...PROFILE, ...profile }
    }
  );
  assert.equal(saved.status, 200);
  return cookie;
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const PDF = new TextEncoder().encode('%PDF-1.7\n%');

/** Sends `body` as the raw upload, the way the page's fetch of a File does. */
async function upload(cookie: string | null, body: BodyInit, headers: Record<string, string> = {}) {
  const request = new Request(`${ORIGIN}/api/applications/proof`, {
    method: 'PUT',
    headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}), ...headers },
    body,
    duplex: 'half'
  } as RequestInit);
  const response = await proof.onRequestPut({ request, env, params: {} } as never);
  const text = await response.text();
  return { status: response.status, json: text ? (JSON.parse(text) as any) : null };
}

/** Sends an Application; for Combat Power's league unless `body` says what store it is for. */
const apply = (cookie: string, body: Record<string, unknown>) =>
  hit(
    applications.onRequestPost as Handler,
    '/api/applications',
    {},
    {
      method: 'POST',
      cookie,
      body: { store: storeApplication(), ...body }
    }
  );

const state = async (cookie: string) =>
  (await hit(mine.onRequestGet as Handler, '/api/applications/mine', {}, { cookie })).json;

const withdraw = (cookie: string) =>
  hit(mine.onRequestDelete as Handler, '/api/applications/mine', {}, { method: 'DELETE', cookie });

const removeProof = (cookie: string) =>
  hit(proof.onRequestDelete as Handler, '/api/applications/proof', {}, { method: 'DELETE', cookie });

/** The account's id, read through /api/me as the page would. */
async function idOf(cookie: string): Promise<string> {
  return (await hit(me.onRequestGet as Handler, '/api/me', {}, { cookie })).json.user.id as string;
}

test('a signed-in account with a complete profile may apply; the state says so before it does', async () => {
  const cookie = await applicant();
  assert.deepEqual(await state(cookie), { application: null, proof: null, eligible: { profile: true } });
  const sent = await apply(cookie, { explanation: '  I run the league at my store.  ', proof: false });
  assert.equal(sent.status, 201);
  assert.equal(sent.json.application.status, 'pending');
  assert.equal(sent.json.application.explanation, 'I run the league at my store.');
  assert.equal(sent.json.application.proofType, null);
  assert.deepEqual(sent.json.application.store, storeApplication(), 'the store it asks for, as sent');
  const after = await state(cookie);
  assert.deepEqual(after.application, sent.json.application);
  assert.equal(after.proof, null);
});

test('signed out, or from another site, nothing is read or sent', async () => {
  const cookie = await applicant();
  assert.equal((await hit(mine.onRequestGet as Handler, '/api/applications/mine', {})).status, 401);
  assert.equal(
    (await hit(applications.onRequestPost as Handler, '/api/applications', {}, { method: 'POST', body: {} })).status,
    401
  );
  assert.equal((await upload(null, PNG)).status, 401);
  const foreign = await hit(
    applications.onRequestPost as Handler,
    '/api/applications',
    {},
    { method: 'POST', cookie, origin: 'https://elsewhere.test', body: { explanation: 'Hi', proof: false } }
  );
  assert.equal(foreign.status, 403);
  assert.equal((await upload(cookie, PNG, { origin: 'https://elsewhere.test' })).status, 403);
  assert.equal(raw().prepare('SELECT COUNT(*) AS n FROM applications').get()?.n, 0);
});

test('an account without a complete profile is sent to finish it, and uploads nothing', async () => {
  const cookie = await signIn('Newcomer');
  assert.deepEqual((await state(cookie)).eligible, { profile: false });
  const sent = await apply(cookie, { explanation: 'Please', proof: false });
  assert.deepEqual([sent.status, sent.json], [400, { error: 'Complete your profile first', profile: true }]);
  const uploaded = await upload(cookie, PNG);
  assert.deepEqual([uploaded.status, uploaded.json.profile], [400, true]);
  assert.equal(proofs.objects.size, 0);
});

test('a proof is kept by what its bytes say it is, never by the type sent with it', async () => {
  const cookie = await applicant();
  const id = await idOf(cookie);
  const png = await upload(cookie, PNG, { 'content-type': 'application/pdf' });
  assert.deepEqual([png.status, png.json], [200, { proof: { type: 'image/png', size: PNG.byteLength } }]);
  const [key] = [...proofs.objects.keys()];
  assert.ok(key?.startsWith(`proofs/${id}/`));
  assert.equal(proofs.objects.get(key)?.contentType, 'image/png');
  const svg = await upload(cookie, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', {
    'content-type': 'image/png'
  });
  assert.deepEqual([svg.status, svg.json.error], [400, 'Use a PNG, JPEG, WebP or PDF']);
  const empty = await upload(cookie, new Uint8Array(0));
  assert.deepEqual([empty.status, empty.json.error], [400, 'The file is empty']);
  assert.deepEqual([...proofs.objects.keys()], [key], 'a refused upload leaves the one kept alone');
});

test('a proof over 8 MB is refused, by its declared length or by what arrives', async () => {
  const cookie = await applicant();
  const declared = await upload(cookie, PDF, { 'content-length': String(PROOF_MAX_BYTES + 1) });
  assert.deepEqual([declared.status, declared.json.error], [413, 'Up to 8 MB']);
  const over = new Uint8Array(PROOF_MAX_BYTES + 1);
  over.set(PDF);
  assert.equal((await upload(cookie, over)).status, 413);
  const exact = new Uint8Array(PROOF_MAX_BYTES);
  exact.set(PDF);
  const fits = await upload(cookie, exact);
  assert.deepEqual(fits.json, { proof: { type: 'application/pdf', size: PROOF_MAX_BYTES } });
});

test('an account keeps one proof not yet sent: uploading again replaces it, and removing deletes it', async () => {
  const cookie = await applicant();
  await upload(cookie, PNG);
  await upload(cookie, PDF);
  assert.deepEqual(
    [...proofs.objects.values()].map(kept => kept.contentType),
    ['application/pdf'],
    'the replaced file is deleted'
  );
  assert.deepEqual((await state(cookie)).proof, { type: 'application/pdf', size: PDF.byteLength });
  assert.equal((await removeProof(cookie)).status, 204);
  assert.equal(proofs.objects.size, 0);
  assert.equal((await state(cookie)).proof, null);
  assert.equal((await removeProof(cookie)).status, 204, 'with none kept there is nothing to delete');
});

test('two uploads at once keep the one that lands last, and leave no other file behind', async () => {
  const cookie = await applicant();
  const both = await Promise.all([upload(cookie, PNG), upload(cookie, PDF)]);
  assert.deepEqual(
    both.map(sent => sent.status),
    [200, 200]
  );
  const kept = raw().prepare('SELECT key, type FROM proof_uploads').all();
  assert.equal(kept.length, 1);
  assert.deepEqual([...proofs.objects.keys()], [kept[0]?.key]);
  assert.equal((await state(cookie)).proof.type, kept[0]?.type);
});

test('an Application says what store and that the applicant is certified; a proof and a note are optional', async () => {
  const cookie = await applicant();
  const refused = async (store: unknown, error: string) => {
    const sent = await apply(cookie, { store, proof: false });
    assert.deepEqual([sent.status, sent.json.error], [400, error], JSON.stringify(store));
  };
  await refused(undefined, 'Enter the store’s league ID');
  await refused({ ...storeApplication(), leagueId: 'abc' }, 'Enter the store’s league ID');
  await refused({ ...storeApplication(), details: { name: '' } }, 'Check the store’s details');
  await refused({ ...storeApplication(), timeZone: 'Mars/Olympus' }, 'Pick the store’s time zone');
  await refused({ ...storeApplication(), relationship: 'fan' }, 'Say why you are applying for the store');
  await refused({ ...storeApplication(), certified: false }, 'Confirm you are a certified organizer, or work with one');
  await refused({ ...storeApplication(), nights: [{ id: 'x', weekday: 9, time: '25:00' }] }, 'Check the league nights');
  const unparsed = await hit(
    applications.onRequestPost as Handler,
    '/api/applications',
    {},
    {
      method: 'POST',
      cookie,
      body: 'not an application'
    }
  );
  assert.equal(unparsed.status, 400);
  const tooLong = await apply(cookie, { explanation: 'x'.repeat(2001), proof: false });
  assert.deepEqual([tooLong.status, tooLong.json.error], [400, 'Up to 2000 characters']);
  const noFile = await apply(cookie, { proof: true });
  assert.deepEqual([noFile.status, noFile.json.error], [400, 'Upload the proof first']);
  // Ten tries an hour from one address; the rest of this test is not about that.
  applications._resetRateLimitStore();
  const byUrl = storeApplication('https://www.pokemon.com/us/play-pokemon/pokemon-events/leagues/6238620/');
  const bare = await apply(cookie, { store: byUrl, proof: false });
  assert.equal(bare.status, 201, 'no proof and no note');
  assert.equal(bare.json.application.store.leagueId, '6238620', 'the league page reads as its ID');
  await withdraw(cookie);
  await upload(cookie, PDF);
  const sent = await apply(cookie, { explanation: '', proof: true });
  assert.equal(sent.status, 201);
  assert.equal(sent.json.application.proofType, 'application/pdf');
  const id = await idOf(cookie);
  const row = raw().prepare('SELECT proof_key AS key, proof_type AS type, proof_size AS size FROM applications').get();
  assert.deepEqual({ ...row, key: null }, { key: null, type: 'application/pdf', size: PDF.byteLength });
  assert.ok(String(row?.key).startsWith(`proofs/${id}/`));
  assert.ok(proofs.objects.has(String(row?.key)), 'the proof stays for the admin to see');
});

test('sent with an explanation alone, a proof uploaded and left out is deleted', async () => {
  const cookie = await applicant();
  await upload(cookie, PNG);
  const sent = await apply(cookie, { explanation: 'My certificate lapsed last month.', proof: false });
  assert.equal(sent.status, 201);
  assert.equal(proofs.objects.size, 0);
  assert.equal(raw().prepare('SELECT proof_key FROM applications').get()?.proof_key, null);
});

test('one Application is pending at a time, and its proof stays as sent while it is', async () => {
  const cookie = await applicant();
  await upload(cookie, PNG);
  assert.equal((await apply(cookie, { explanation: '', proof: true })).status, 201);
  const again = await apply(cookie, { explanation: 'Another', proof: false });
  assert.deepEqual([again.status, again.json.error], [409, 'Your application is pending']);
  const replaced = await upload(cookie, PDF);
  assert.deepEqual([replaced.status, replaced.json.error], [409, 'Your application is pending']);
  assert.equal((await removeProof(cookie)).status, 409);
  assert.equal([...proofs.objects.values()][0]?.contentType, 'image/png');
  assert.equal((await state(cookie)).proof, null, 'the slot holds the pending one, not an upload for the next');
});

test('two sends at once leave one Application pending', async () => {
  const cookie = await applicant();
  const both = await Promise.all([
    apply(cookie, { explanation: 'First', proof: false }),
    apply(cookie, { explanation: 'Second', proof: false })
  ]);
  assert.deepEqual(both.map(sent => sent.status).sort(), [201, 409]);
  assert.equal(raw().prepare("SELECT COUNT(*) AS n FROM applications WHERE status = 'pending'").get()?.n, 1);
});

test('a send that read no Application pending still loses to one that landed since', async () => {
  const cookie = await applicant();
  const first = await apply(cookie, { explanation: 'First', proof: false });
  const db = env.TOURNAMENT_DB as NonNullable<TournamentEnv['TOURNAMENT_DB']>;
  // The first is withdrawn and sent again by another tab, between this send's read and its write.
  raw().prepare('DELETE FROM applications').run();
  env.TOURNAMENT_DB = {
    ...db,
    prepare: sql => {
      if (sql.startsWith('INSERT OR IGNORE INTO applications')) {
        raw()
          .prepare(
            'INSERT INTO applications (id, user_id, status, pop_id, first_name, last_name, created_at) ' +
              "SELECT 'rival', id, 'pending', pop_id, first_name, last_name, 1 FROM users WHERE handle = 'applicant'"
          )
          .run();
      }
      return db.prepare(sql);
    }
  };
  const second = await apply(cookie, { explanation: 'Second', proof: false });
  env.TOURNAMENT_DB = db;
  assert.equal(first.status, 201);
  assert.deepEqual([second.status, second.json.error], [409, 'Your application is pending']);
  assert.equal(raw().prepare('SELECT id FROM applications').get()?.id, 'rival');
});

test('an Application keeps the profile as it stood when the account applied', async () => {
  const cookie = await applicant();
  await apply(cookie, { explanation: 'Hello', proof: false });
  await hit(
    me.onRequestPut as Handler,
    '/api/me',
    {},
    {
      method: 'PUT',
      cookie,
      body: { ...PROFILE, popId: '7654321', lastName: 'Renamed' }
    }
  );
  const row = raw()
    .prepare('SELECT pop_id AS popId, first_name AS firstName, last_name AS lastName FROM applications')
    .get();
  assert.deepEqual({ ...row }, { popId: '1234567', firstName: 'Pat', lastName: 'Player' });
});

/** Sends the Application with `meanwhile` run while its body is still arriving, after the send has read the account. */
async function applyWhile(cookie: string, body: Record<string, unknown>, meanwhile: () => void) {
  const slow = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        meanwhile();
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ store: storeApplication(), ...body })));
        controller.close();
      }
    },
    { highWaterMark: 0 }
  );
  const request = new Request(`${ORIGIN}/api/applications`, {
    method: 'POST',
    headers: { origin: ORIGIN, cookie, 'content-type': 'application/json' },
    body: slow,
    duplex: 'half'
  } as RequestInit);
  const response = await applications.onRequestPost({ request, env, params: {} } as never);
  return { status: response.status, json: (await response.json()) as any };
}

test('a send holds to the account as it is when the Application lands, not as it was read', async () => {
  const cookie = await applicant();
  const setUser = (sql: string) => () => raw().prepare(`UPDATE users SET ${sql} WHERE handle = 'applicant'`).run();
  // An Admin takes the POP ID off the account while its Application is still arriving.
  const cleared = await applyWhile(cookie, { explanation: 'Hello', proof: false }, setUser('pop_id = NULL'));
  assert.deepEqual([cleared.status, cleared.json], [400, { error: 'Complete your profile first', profile: true }]);
  setUser("pop_id = '1234567'")();
  assert.equal(raw().prepare('SELECT COUNT(*) AS n FROM applications').get()?.n, 0);
  // Renamed meanwhile, the account applies under the name it has now.
  const renamed = await applyWhile(cookie, { explanation: 'Hello', proof: false }, setUser("last_name = 'Renamed'"));
  assert.equal(renamed.status, 201);
  const row = raw().prepare('SELECT pop_id AS popId, last_name AS lastName FROM applications').get();
  assert.deepEqual({ ...row }, { popId: '1234567', lastName: 'Renamed' });
});

test('a send that keeps losing to changes to the account gives up, and one whose account is gone stores nothing', async () => {
  const cookie = await applicant();
  const db = env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>;
  let renames = 0;
  const rename = () => {
    renames += 1;
    raw().prepare("UPDATE users SET last_name = ? WHERE handle = 'applicant'").run(`Renamed${renames}`);
  };
  env.TOURNAMENT_DB = racing(db, 'INSERT OR IGNORE INTO applications', rename, 3);
  const busy = await apply(cookie, { explanation: 'Hello', proof: false });
  assert.deepEqual([busy.status, busy.json.error, renames], [409, 'Busy; try again', 3]);
  env.TOURNAMENT_DB = racing(db, 'INSERT OR IGNORE INTO applications', () => {
    raw().prepare("DELETE FROM users WHERE handle = 'applicant'").run();
  });
  assert.equal((await apply(cookie, { explanation: 'Hello', proof: false })).status, 401);
  assert.equal(raw().prepare('SELECT COUNT(*) AS n FROM applications').get()?.n, 0);
});

/** Uploads `bytes` with `meanwhile` run while the file is still arriving, after the upload has read the account. */
function uploadWhile(cookie: string, bytes: Uint8Array, meanwhile: () => void) {
  const slow = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        meanwhile();
        controller.enqueue(bytes);
        controller.close();
      }
    },
    { highWaterMark: 0 }
  );
  return upload(cookie, slow, { 'content-type': 'application/octet-stream' });
}

test('an upload holds to the account as it is when the file lands, and a refused one leaves no file', async () => {
  const cookie = await applicant();
  const setUser = (sql: string) => () => raw().prepare(`UPDATE users SET ${sql} WHERE handle = 'applicant'`).run();
  const nothingKept = () => {
    assert.equal(raw().prepare('SELECT COUNT(*) AS n FROM proof_uploads').get()?.n, 0);
    assert.equal(proofs.objects.size, 0);
  };
  const cleared = await uploadWhile(cookie, PNG, setUser('pop_id = NULL'));
  assert.deepEqual([cleared.status, cleared.json], [400, { error: 'Complete your profile first', profile: true }]);
  nothingKept();
  setUser("pop_id = '1234567'")();
  // Renamed meanwhile, the account may still apply, so the upload is kept.
  const renamed = await uploadWhile(cookie, PNG, setUser("last_name = 'Renamed'"));
  assert.deepEqual([renamed.status, renamed.json], [200, { proof: { type: 'image/png', size: PNG.byteLength } }]);
  assert.equal(proofs.objects.size, 1);
});

test('an upload that keeps losing to changes to the account gives up, and one whose account is gone keeps nothing', async () => {
  const cookie = await applicant();
  const db = env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>;
  let renames = 0;
  const rename = () => {
    renames += 1;
    raw().prepare("UPDATE users SET last_name = ? WHERE handle = 'applicant'").run(`Renamed${renames}`);
  };
  env.TOURNAMENT_DB = racing(db, 'INSERT INTO proof_uploads', rename, 3);
  const busy = await upload(cookie, PNG);
  assert.deepEqual([busy.status, busy.json.error, renames], [409, 'Busy; try again', 3]);
  env.TOURNAMENT_DB = racing(db, 'INSERT INTO proof_uploads', () => {
    raw().prepare("DELETE FROM users WHERE handle = 'applicant'").run();
  });
  assert.equal((await upload(cookie, PNG)).status, 401);
  assert.equal(raw().prepare('SELECT COUNT(*) AS n FROM proof_uploads').get()?.n, 0);
  assert.equal(proofs.objects.size, 0);
});

test('withdrawing takes the pending Application and its proof; with none pending there is nothing to take', async () => {
  const cookie = await applicant();
  assert.deepEqual([(await withdraw(cookie)).status], [404]);
  await upload(cookie, PNG);
  await apply(cookie, { explanation: '', proof: true });
  assert.equal((await withdraw(cookie)).status, 204);
  assert.equal(raw().prepare('SELECT COUNT(*) AS n FROM applications').get()?.n, 0);
  assert.equal(proofs.objects.size, 0);
  assert.deepEqual(await state(cookie), { application: null, proof: null, eligible: { profile: true } });
});

test('the delete after a withdrawal takes that Application’s proof alone, however late it lands', async () => {
  const cookie = await applicant();
  await upload(cookie, PNG);
  await apply(cookie, { explanation: '', proof: true });
  const stalled = stalledDeletes(proofs);
  env.PROOFS = stalled.bucket;
  const kept: Promise<unknown>[] = [];
  const withdrawn = await mine.onRequestDelete({
    request: new Request(`${ORIGIN}/api/applications/mine`, { method: 'DELETE', headers: { origin: ORIGIN, cookie } }),
    env,
    params: {},
    waitUntil: (work: Promise<unknown>) => kept.push(work)
  } as never);
  assert.equal(withdrawn.status, 204);
  // The account applies again with another file before R2 has deleted the first.
  await upload(cookie, PDF);
  assert.equal((await apply(cookie, { explanation: '', proof: true })).status, 201);
  stalled.release();
  await Promise.all(kept);
  const key = raw().prepare('SELECT proof_key FROM applications').get()?.proof_key as string;
  assert.equal(proofs.objects.get(key)?.contentType, 'application/pdf');
  assert.equal(proofs.objects.size, 1, 'the first proof is gone');
});

test('a decided Application stays: it cannot be withdrawn, and a rejected account applies again', async () => {
  const cookie = await applicant();
  const first = await apply(cookie, { explanation: 'Hello', proof: false });
  raw()
    .prepare("UPDATE applications SET status = 'rejected', decided_at = 5, note = 'Send your certificate' WHERE id = ?")
    .run(first.json.application.id);
  assert.equal((await withdraw(cookie)).status, 404);
  const seen = (await state(cookie)).application;
  assert.deepEqual([seen.status, seen.note, seen.decidedAt], ['rejected', 'Send your certificate', 5]);
  await upload(cookie, PNG);
  const again = await apply(cookie, { explanation: '', proof: true });
  assert.equal(again.status, 201);
  assert.equal((await state(cookie)).application.id, again.json.application.id, 'the newest is the one shown');
});

test('any account with a complete profile applies, whatever its role or the stores it is in', async () => {
  for (const [i, role] of ['community', 'revoked', 'admin'].entries()) {
    const cookie = await applicant(`Has ${role}`, { popId: String(i + 1) });
    raw().prepare('UPDATE users SET role = ? WHERE handle = ?').run(role, `has-${role}`);
    assert.deepEqual((await state(cookie)).eligible, { profile: true });
    assert.equal((await apply(cookie, { store: storeApplication(`77${i}0`), proof: false })).status, 201);
  }
  const manager = await signIn('Store Manager', 'organizer');
  await hit(
    me.onRequestPut as Handler,
    '/api/me',
    {},
    { method: 'PUT', cookie: manager, body: { ...PROFILE, popId: '9' } }
  );
  assert.equal(
    (await apply(manager, { store: storeApplication('7790'), proof: false })).status,
    201,
    'a second store for someone who runs one'
  );
});

test('without the bucket, uploads are not available, and the state shows no proof', async () => {
  const cookie = await applicant();
  delete env.PROOFS;
  assert.equal((await upload(cookie, PNG)).status, 503);
  assert.equal((await removeProof(cookie)).status, 503);
  assert.equal((await state(cookie)).proof, null);
  assert.equal((await apply(cookie, { explanation: '', proof: true })).status, 400);
  assert.equal((await apply(cookie, { explanation: 'Words only', proof: false })).status, 201);
  delete env.TOURNAMENT_DB;
  assert.equal((await hit(mine.onRequestGet as Handler, '/api/applications/mine', {}, { cookie })).status, 503);
});

test('a withdrawal does not wait on the bucket where the runtime keeps the function alive, and a failed delete fails nothing', async () => {
  const cookie = await applicant();
  await upload(cookie, PNG);
  await apply(cookie, { explanation: '', proof: true });
  const failed = mock.method(console, 'error', () => undefined);
  env.PROOFS = { ...proofs, delete: () => Promise.reject(new Error('R2 is down')) };
  const kept: Promise<unknown>[] = [];
  const request = new Request(`${ORIGIN}/api/applications/mine`, { method: 'DELETE', headers: { cookie } });
  const response = await mine.onRequestDelete({
    request,
    env,
    params: {},
    waitUntil: (work: Promise<unknown>) => kept.push(work)
  } as never);
  assert.equal(response.status, 204);
  assert.equal(kept.length, 1);
  await Promise.all(kept);
  assert.equal(failed.mock.callCount(), 1);
  failed.mock.restore();
});

test('uploads and sends are limited per address', async () => {
  const cookie = await applicant();
  for (let i = 0; i < 20; i += 1) {
    assert.equal((await upload(cookie, PNG)).status, 200, `upload ${i + 1}`);
  }
  assert.equal((await upload(cookie, PNG)).status, 429);
  for (let i = 0; i < 10; i += 1) {
    await apply(cookie, { explanation: '', proof: false });
  }
  assert.equal((await apply(cookie, { explanation: 'Hi', proof: false })).status, 429);
});
