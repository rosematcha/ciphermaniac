import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeEach, mock, test } from 'node:test';

import * as age from '../../functions/api/auth/age.ts';
import * as idle from '../../functions/api/tournaments/idle.ts';
import type { TournamentEnv } from '../../functions/lib/auth/env.ts';
import type { Profile } from '../../functions/lib/auth/oauth.ts';
import { upsertUser } from '../../functions/lib/auth/session.ts';
import { holdSignup } from '../../functions/lib/auth/signup.ts';
import { apiCalls, type Handler } from '../__utils__/apiCalls.ts';
import { memoryProofs } from '../__utils__/proofBucket.ts';
import { racing, sqliteD1 } from '../__utils__/sqliteD1.ts';

let env: TournamentEnv;
let proofs: ReturnType<typeof memoryProofs>;
const { hit } = apiCalls(() => env);
const db = () => env.TOURNAMENT_DB as ReturnType<typeof sqliteD1>;
const profile: Profile = {
  provider: 'google',
  subject: 'legacy-child',
  name: 'Child',
  email: 'child@example.com',
  emailVerified: true,
  avatar: 'child-avatar'
};
const minorBirth = `${new Date().getUTCFullYear() - 10}-01-01`;
const count = (table: string) => db().raw.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n;
const sql = (name: string) => readFileSync(new URL(`../../config/d1/${name}`, import.meta.url), 'utf8');

beforeEach(() => {
  proofs = memoryProofs();
  env = { TOURNAMENT_DB: sqliteD1('tournaments.sql'), PROOFS: proofs, IDLE_SWEEP_TOKEN: 'sweep' };
});

async function legacyAccount() {
  db().raw.exec(
    'INSERT INTO users (id, handle, email, avatar, pop_id, first_name, last_name, birth_date, public_profile, role, created_at) ' +
      "VALUES ('legacy', 'child-handle', 'child@example.com', 'avatar', '123', 'Child', 'Name', '02/27/2016', 1, 'community', 1);" +
      "INSERT INTO identities VALUES ('google', 'legacy-child', 'legacy'), ('discord', 'other-provider', 'legacy');" +
      "INSERT INTO sessions VALUES ('session', 'legacy', 9999999999999);" +
      "INSERT INTO duplicate_emails_backup VALUES ('legacy', 'previous@example.com', '2026');" +
      "INSERT INTO handle_changes VALUES ('legacy', 1, 'old-child-name', 'child-handle', 'rename');" +
      "INSERT INTO report_devices VALUES ('CODE', '123', 'token', 'device', 1, 'legacy');" +
      "INSERT INTO staff VALUES ('CODE', 'legacy', 1);" +
      'INSERT INTO applications (id, user_id, status, pop_id, first_name, last_name, explanation, proof_key, created_at, store) ' +
      "VALUES ('application', 'legacy', 'pending', '123', 'Child', 'Name', 'private note', 'proofs/legacy/application', 1, '{}');" +
      "INSERT INTO proof_uploads VALUES ('legacy', 'proofs/legacy/upload', 'image/png', 1);" +
      'INSERT INTO decklists (code, user_id, pop_id, first_name, last_name, birth_date, deck, submitted_at, account) VALUES ' +
      "('CODE', 'pop:123', '123', 'Child', 'Name', '02/27/2016', 'cards', 1, 'legacy')," +
      "('CODE', 'pop:456', '456', 'Other', 'Player', '02/27/1990', 'cards', 1, 'other');" +
      'INSERT INTO stores (id, league_id, status, name, address, time_zone, created_at, updated_at) ' +
      "VALUES ('store', 'league', 'active', 'Store', 'Place', 'UTC', 1, 1);" +
      "INSERT INTO store_members VALUES ('store', 'legacy', 'manager', 1);"
  );
  for (const key of ['proofs/legacy/application', 'proofs/legacy/upload']) {
    await proofs.put(key, new Uint8Array([1]), { httpMetadata: { contentType: 'image/png' } });
  }
}

async function rejection(cookieProfile = profile) {
  const token = await holdSignup(db(), cookieProfile, '/host');
  return hit(
    age.onRequestPost as Handler,
    '/api/auth/age',
    {},
    {
      method: 'POST',
      cookie: `cm_signup=${token}`,
      body: { birthDate: minorBirth }
    }
  );
}

test('legacy rejection forgets account PII, submissions and proofs while preserving the last Manager', async () => {
  await legacyAccount();
  await holdSignup(db(), { ...profile, provider: 'discord', subject: 'other-provider' }, '/host');
  await holdSignup(db(), { ...profile, subject: 'second-pending-identity', email: ' CHILD@example.com ' }, '/host');
  const result = await rejection();
  assert.equal(result.status, 403);
  const user = db().raw.prepare('SELECT * FROM users WHERE id = ?').get('legacy');
  assert.ok(user);
  for (const field of ['email', 'avatar', 'pop_id', 'first_name', 'last_name', 'birth_date', 'age_checked_at']) {
    assert.equal(user[field], null, field);
  }
  assert.notEqual(user.handle, 'child-handle');
  assert.equal(user.public_profile, 0);
  assert.equal(user.role, 'revoked');
  for (const table of [
    'identities',
    'sessions',
    'duplicate_emails_backup',
    'handle_changes',
    'applications',
    'proof_uploads',
    'proof_deletions',
    'report_devices',
    'staff',
    'pending_signups'
  ]) {
    assert.equal(count(table), 0, table);
  }
  assert.equal(count('decklists'), 1, 'another player’s submission survives');
  assert.equal(proofs.objects.size, 0);
  assert.equal(db().raw.prepare("SELECT role FROM store_members WHERE user_id = 'legacy'").get()?.role, 'manager');
});

test('verified-email fallback cleans a legacy account but an unverified email cannot erase it', async () => {
  await legacyAccount();
  assert.equal((await rejection({ ...profile, subject: 'unknown', emailVerified: false })).status, 403);
  assert.equal(count('applications'), 1);
  assert.equal((await rejection({ ...profile, subject: 'new-provider-identity' })).status, 403);
  assert.equal(count('applications'), 0);
  assert.equal(db().raw.prepare("SELECT email FROM users WHERE id = 'legacy'").get()?.email, null);
});

test('a concurrent adult verification protects legacy personal data and proofs from rejection', async () => {
  await legacyAccount();
  const inner = db();
  env.TOURNAMENT_DB = racing(inner, 'INSERT OR IGNORE INTO proof_deletions', () => {
    inner.raw.prepare('UPDATE users SET age_checked_at = ? WHERE id = ?').run(Date.now(), 'legacy');
  });
  assert.equal((await rejection()).status, 403);
  assert.equal(count('applications'), 1);
  assert.equal(count('identities'), 2);
  assert.equal(proofs.objects.size, 2);
  assert.equal(count('proof_deletions'), 0);
  assert.equal(inner.raw.prepare("SELECT handle FROM users WHERE id = 'legacy'").get()?.handle, 'child-handle');
});

test('private-file deletion failures persist for the authenticated idle sweep to retry', async () => {
  await legacyAccount();
  env.PROOFS = {
    ...proofs,
    delete: async () => {
      throw new Error('R2 unavailable');
    }
  };
  const log = mock.method(console, 'error', () => undefined);
  try {
    assert.equal((await rejection()).status, 403);
    assert.equal(count('applications'), 0);
    assert.equal(count('proof_deletions'), 2);
    env.PROOFS = proofs;
    const swept = await idle.onRequestPost({
      request: new Request('https://cm.test/api/tournaments/idle', {
        method: 'POST',
        headers: { authorization: 'Bearer sweep' }
      }),
      env,
      params: {}
    } as never);
    assert.equal(swept.status, 200);
    assert.equal(count('proof_deletions'), 0);
    assert.equal(proofs.objects.size, 0);
  } finally {
    log.mock.restore();
  }
});

test('rejection clears other pending tokens for a new minor identity', async () => {
  await holdSignup(db(), profile, '/host');
  assert.equal((await rejection()).status, 403);
  assert.equal(count('pending_signups'), 0);
  assert.equal(count('users'), 0);
});

test('account race resolution still records the adult age verification', async () => {
  await legacyAccount();
  const inner = db();
  inner.raw.exec("DELETE FROM identities WHERE provider = 'google'");
  env.TOURNAMENT_DB = racing(inner, 'INSERT INTO identities', () => {
    inner.raw.exec("INSERT INTO identities VALUES ('google', 'legacy-child', 'legacy')");
  });
  assert.equal(await upsertUser(db(), profile, '02/27/1990'), 'legacy');
  assert.equal(inner.raw.prepare("SELECT birth_date FROM users WHERE id = 'legacy'").get()?.birth_date, '02/27/1990');
  assert.ok(inner.raw.prepare("SELECT age_checked_at FROM users WHERE id = 'legacy'").get()?.age_checked_at);
});

test('deployment preflight rejects incomplete schemas and the deletion migration is repeatable', () => {
  const preflight = sql('check-tournaments.sql');
  assert.doesNotThrow(() => db().raw.exec(preflight));
  db().raw.exec('DROP TABLE proof_deletions');
  assert.throws(() => db().raw.exec(preflight), /proof_deletions/);
  db().raw.exec(sql('migrations/tournaments/0013-proof-deletions.sql'));
  db().raw.exec(sql('migrations/tournaments/0013-proof-deletions.sql'));
  assert.doesNotThrow(() => db().raw.exec(preflight));
});
