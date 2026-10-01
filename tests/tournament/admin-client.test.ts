/**
 * The admin page's calls: each goes to its admin endpoint with its body, and
 * a lookup asks by POP ID, email or account ID from what was typed.
 */

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import {
  decideApplication,
  fetchApplications,
  fetchRoleHolders,
  findAccounts,
  lookupQuery,
  movePopId,
  proofUrl,
  setOrganizerAccess
} from '../../src/lib/tournament/admin.ts';

interface Sent {
  url: string;
  method: string;
  body: unknown;
}

const realFetch = globalThis.fetch;
let sent: Sent[] = [];

afterEach(() => {
  globalThis.fetch = realFetch;
  sent = [];
});

test('each admin call goes to its endpoint with its body', async () => {
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    sent.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined });
    return Response.json({ ok: true });
  }) as typeof fetch;
  await fetchApplications('pending');
  await fetchApplications('rejected');
  await decideApplication('a/1', 'approve', '');
  await decideApplication('a2', 'reject', 'Send the certificate');
  await fetchRoleHolders();
  await setOrganizerAccess('u1', 'revoked');
  await setOrganizerAccess('u1', 'organizer');
  await findAccounts(' 7200001 ');
  await movePopId('7200001', 'u2');
  await movePopId('7200001', null);
  assert.deepEqual(sent, [
    { url: '/api/admin/applications?status=pending', method: 'GET', body: undefined },
    { url: '/api/admin/applications?status=rejected', method: 'GET', body: undefined },
    { url: '/api/admin/applications/a%2F1', method: 'POST', body: { decision: 'approve', note: '' } },
    { url: '/api/admin/applications/a2', method: 'POST', body: { decision: 'reject', note: 'Send the certificate' } },
    { url: '/api/admin/organizers', method: 'GET', body: undefined },
    { url: '/api/admin/organizers/u1', method: 'POST', body: { role: 'revoked' } },
    { url: '/api/admin/organizers/u1', method: 'POST', body: { role: 'organizer' } },
    { url: '/api/admin/accounts?popId=7200001', method: 'GET', body: undefined },
    { url: '/api/admin/pop-ids', method: 'POST', body: { popId: '7200001', accountId: 'u2' } },
    { url: '/api/admin/pop-ids', method: 'POST', body: { popId: '7200001', accountId: null } }
  ]);
  assert.equal(proofUrl('a/1'), '/api/admin/applications/a%2F1/proof');
});

test('a lookup is a POP ID when it is up to ten digits, an email with an @, and an account ID otherwise', () => {
  assert.equal(lookupQuery('7200001'), 'popId=7200001');
  assert.equal(lookupQuery(' 1234567890 '), 'popId=1234567890');
  assert.equal(lookupQuery('12345678901'), 'id=12345678901');
  assert.equal(lookupQuery('mary+cm@example.com'), 'email=mary%2Bcm%40example.com');
  assert.equal(lookupQuery('Xk3_aQ9-pL0wZt7u'), 'id=Xk3_aQ9-pL0wZt7u');
});
