/**
 * Applying to run events from the browser: the calls go to the applicant
 * endpoints, and an account's stage reads from its role and its latest Application the way the pages
 * show it.
 */

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import type { MyApplication } from '../../shared/accounts/types.ts';
import { applicantStage, dayOf, fetchApplication, withdrawApplication } from '../../src/lib/tournament/applications.ts';
import { sendStoreApplication } from '../../src/lib/tournament/stores.ts';
import { storeApplication } from '../__utils__/storeApplication.ts';

interface Sent {
  url: string;
  method: string;
  body: BodyInit | null | undefined;
  headers: HeadersInit | undefined;
}

const realFetch = globalThis.fetch;
let sent: Sent[] = [];

function answer(status: number, body: unknown) {
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    sent.push({ url, method: init.method ?? 'GET', body: init.body, headers: init.headers });
    return status === 204 ? new Response(null, { status }) : Response.json(body, { status });
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  sent = [];
});

test('each applicant call goes to its endpoint, the Application as JSON', async () => {
  answer(200, { ok: true });
  await fetchApplication();
  await sendStoreApplication(storeApplication(), 'I run a league');
  answer(204, null);
  assert.equal(await withdrawApplication(), null);
  assert.deepEqual(
    sent.map(s => `${s.method} ${s.url}`),
    ['GET /api/applications/mine', 'POST /api/applications', 'DELETE /api/applications/mine']
  );
  assert.deepEqual(JSON.parse(String(sent[1]?.body)), {
    store: storeApplication(),
    explanation: 'I run a league'
  });
  assert.deepEqual(sent[1]?.headers, { 'Content-Type': 'application/json' });
});

const application = (status: MyApplication['status']): MyApplication => ({
  id: 'a1',
  status,
  explanation: '',
  createdAt: 0,
  decidedAt: null,
  note: null,
  store: null
});

test('an Admin is one whatever it applied for; an approved Application is a store', () => {
  assert.equal(applicantStage('admin', application('pending')), 'admin');
  assert.equal(applicantStage(null, application('approved')), 'store');
  assert.equal(applicantStage('community', application('approved')), 'store');
  assert.equal(applicantStage('community', null), 'community');
  assert.equal(applicantStage('revoked', null), 'revoked');
  assert.equal(applicantStage(null, null), 'none');
});

test('a pending or rejected Application is newer than the role it was sent under', () => {
  assert.equal(applicantStage(null, application('pending')), 'pending');
  assert.equal(applicantStage('revoked', application('pending')), 'pending');
  assert.equal(applicantStage(null, application('rejected')), 'rejected');
  assert.equal(applicantStage('revoked', application('rejected')), 'rejected');
});

test('a store approved outranks a Community organizer role taken away', () => {
  assert.equal(applicantStage('revoked', application('approved')), 'store');
});

test('a day reads with its year', () => {
  assert.match(dayOf(Date.UTC(2026, 9, 1, 12)), /2026/);
});
