/**
 * The browser side of tournaments: the API client sends what the functions
 * expect and surfaces their error text, and the TOM file link reads a file
 * only when TOM has saved it, writes results back, and remembers the file.
 */

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import {
  ApiError,
  createFromTdf,
  createSwiss,
  deleteTournament,
  fetchDecklists,
  fetchManage,
  fetchMyDecklist,
  fetchPublished,
  fetchSession,
  fetchView,
  identifyPlayer,
  joinStaff,
  linkUrl,
  listTournaments,
  reportAsPlayer,
  rotateStaffToken,
  saveAccountName,
  saveProfile,
  saveSettings,
  sendCommand,
  setDeck,
  signInUrl,
  signOut,
  submitDecklist,
  syncTournament,
  withdrawDecklist
} from '../../src/lib/tournament/api.ts';
import {
  canLinkFiles,
  ensurePermission,
  forgetHandle,
  pickTdf,
  readIfChanged,
  recallHandle,
  rememberHandle,
  type TdfHandle,
  writeFile
} from '../../src/lib/tournament/tomLink.ts';
import { emptyTournament } from '../../shared/tournament/create.ts';

interface Sent {
  url: string;
  method: string;
  body: unknown;
}

const realFetch = globalThis.fetch;
let sent: Sent[] = [];

function answer(status: number, body: unknown) {
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    sent.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined });
    return status === 204 ? new Response(null, { status }) : Response.json(body, { status });
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  sent = [];
});

test('every call goes to its endpoint with its body', async () => {
  answer(200, { ok: true });
  const profile = { popId: '1', firstName: 'A', lastName: 'B', birthDate: '02/27/2000' };
  const t = emptyTournament({ name: 'X' }, true);
  await fetchSession();
  await saveProfile(profile);
  await listTournaments();
  await createSwiss({ name: 'Cup', combined: false });
  await createFromTdf(t);
  await fetchView('ABC', 3);
  await fetchManage('ABC');
  await sendCommand('ABC', { type: 'pairRound', pod: 'mixed' });
  await syncTournament('ABC', t);
  await setDeck('ABC', '1', 'Gardevoir ex');
  await saveSettings('ABC', { decklistsOpen: true });
  await joinStaff('ABC', 'tok');
  await rotateStaffToken('ABC');
  await fetchDecklists('ABC');
  await submitDecklist('ABC', 'deck', profile, null);
  await fetchMyDecklist('ABC', profile, 'tok');
  await fetchMyDecklist('ABC', { popId: '', firstName: 'Ann', lastName: 'Lee' }, 'tok');
  assert.deepEqual(
    sent.map(s => `${s.method} ${s.url}`),
    [
      'GET /api/me',
      'PUT /api/me',
      'GET /api/tournaments',
      'POST /api/tournaments',
      'POST /api/tournaments',
      'GET /api/tournaments/ABC?since=3',
      'GET /api/tournaments/ABC/manage',
      'POST /api/tournaments/ABC/commands',
      'PUT /api/tournaments/ABC/sync',
      'PUT /api/tournaments/ABC/decks',
      'PUT /api/tournaments/ABC/settings',
      'POST /api/tournaments/ABC/staff',
      'POST /api/tournaments/ABC/staff',
      'GET /api/tournaments/ABC/decklists',
      'PUT /api/tournaments/ABC/decklists',
      'GET /api/tournaments/ABC/decklists?popId=1&firstName=A&lastName=B&token=tok',
      'GET /api/tournaments/ABC/decklists?popId=&firstName=Ann&lastName=Lee&token=tok'
    ]
  );
  const decklist = sent[14]?.body as { localTime: string };
  assert.match(decklist.localTime, /^\d{2}\/\d{2}\/\d{4} /, 'a list can add its submitter, so it carries the clock');
  const command = sent[7]?.body as { localTime: string };
  assert.match(command.localTime, /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/, 'stamped with the venue clock');
  assert.deepEqual(sent[3]?.body, { mode: 'swiss', name: 'Cup', combined: false });
});

test('a player identifies and reports through one endpoint, stamped with the venue clock', async () => {
  answer(200, { key: '4' });
  await identifyPlayer('ABC', { lastName: 'Oak' });
  await reportAsPlayer('ABC', { popId: '12' }, 'win');
  assert.deepEqual(
    sent.map(s => `${s.method} ${s.url}`),
    ['POST /api/tournaments/ABC/report', 'POST /api/tournaments/ABC/report']
  );
  const identified = sent[0]?.body as { lastName: string; localTime: string };
  assert.equal(identified.lastName, 'Oak');
  assert.match(
    identified.localTime,
    /^\d{2}\/\d{2}\/\d{4} /,
    'identifying can settle a result, so it carries the clock too'
  );
  const reported = sent[1]?.body as { popId: string; result: string; localTime: string };
  assert.deepEqual([reported.popId, reported.result], ['12', 'win']);
  assert.match(reported.localTime, /^\d{2}\/\d{2}\/\d{4} /);
});

test('an error that says more than a message keeps the rest', async () => {
  answer(404, { error: 'More than one player has that last name', ambiguous: true });
  await assert.rejects(identifyPlayer('ABC', { lastName: 'Oak' }), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.body?.ambiguous, true);
    return true;
  });
});

test('reads the published view from the data origin, and a missing one as null', async () => {
  answer(200, { code: 'ABC', version: 3 });
  assert.deepEqual(await fetchPublished('ABC'), { code: 'ABC', version: 3 });
  assert.match(sent[0]?.url ?? '', /\/tournaments\/v1\/ABC\.json$/);
  answer(404, { error: 'missing' });
  assert.equal(await fetchPublished('ABC'), null);
});

test('a 204 answers null', async () => {
  answer(204, null);
  assert.equal(await fetchView('ABC', 3), null);
  assert.equal(await signOut(), null);
  assert.equal(await deleteTournament('ABC'), null);
  assert.equal(await withdrawDecklist('ABC', { popId: '12', firstName: 'A', lastName: 'B' }), null);
  assert.equal(
    sent.at(-1)?.url,
    '/api/tournaments/ABC/decklists?popId=12&firstName=A&lastName=B',
    'withdrawn by who sent it'
  );
});

test('a failure carries the server’s message and status', async () => {
  answer(403, { error: 'Only this event’s staff can do that' });
  await assert.rejects(fetchManage('ABC'), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.message, 'Only this event’s staff can do that');
    assert.equal(error.status, 403);
    return true;
  });
  globalThis.fetch = (async () => new Response('not json', { status: 500 })) as unknown as typeof fetch;
  await assert.rejects(fetchManage('ABC'), /Request failed \(500\)/);
});

test('sign-in links carry where to return and the dev name', () => {
  assert.equal(signInUrl('google', '/host'), '/api/auth/login/google?next=%2Fhost');
  assert.equal(signInUrl('dev', '/t/ABC', 'Pat'), '/api/auth/login/dev?next=%2Ft%2FABC&name=Pat');
  assert.equal(linkUrl('discord'), '/api/auth/login/discord?next=%2Fsettings&link=1');
});

test('account name uses the account endpoint', async () => {
  answer(200, { user: { name: 'Reese' } });
  await saveAccountName('Reese');
  assert.deepEqual(sent, [{ url: '/api/me', method: 'PATCH', body: { name: 'Reese' } }]);
});

// ---------- the TOM file link ----------

function fakeHandle(initial: string): TdfHandle & { text: string; modified: number } {
  const handle = {
    name: 'event.tdf',
    text: initial,
    modified: 1,
    getFile: async () => ({ lastModified: handle.modified, text: async () => handle.text }) as unknown as File,
    createWritable: async () => {
      let buffer = '';
      return {
        write: async (data: string) => {
          buffer += data;
        },
        close: async () => {
          handle.text = buffer;
          handle.modified += 1;
        }
      };
    },
    queryPermission: async () => 'prompt' as PermissionState,
    requestPermission: async () => 'granted' as PermissionState
  };
  return handle;
}

test('reads the file only when TOM has saved it, and writes it back', async () => {
  const handle = fakeHandle('<tournament/>');
  const first = await readIfChanged(handle, 0);
  assert.deepEqual(first, { text: '<tournament/>', lastModified: 1 });
  assert.equal(await readIfChanged(handle, 1), null);
  await writeFile(handle, '<tournament stage="4"/>');
  assert.deepEqual(await readIfChanged(handle, 1), { text: '<tournament stage="4"/>', lastModified: 2 });
});

test('asks for permission only when allowed to', async () => {
  const handle = fakeHandle('');
  assert.equal(await ensurePermission(handle, 'read', false), false);
  assert.equal(await ensurePermission(handle, 'readwrite', true), true);
  const plain = { ...handle, queryPermission: undefined, requestPermission: undefined };
  assert.equal(await ensurePermission(plain, 'read', false), true);
});

test('without the File System Access API, linking is unavailable', async () => {
  assert.equal(canLinkFiles(), false);
  (globalThis as { window?: unknown }).window = {};
  try {
    assert.equal(canLinkFiles(), false);
    await assert.rejects(pickTdf(), /cannot link files/);
    const handle = fakeHandle('');
    (globalThis as { window?: unknown }).window = { showOpenFilePicker: async () => [handle] };
    assert.equal(canLinkFiles(), true);
    assert.equal(await pickTdf(), handle);
    (globalThis as { window?: unknown }).window = { showOpenFilePicker: async () => [] };
    await assert.rejects(pickTdf(), /No file picked/);
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
});

/** Just enough IndexedDB for one object store keyed by string. */
function fakeIndexedDb() {
  const data = new Map<string, unknown>();
  const request = <T>(result: () => T) => {
    const req: { result?: T; error: null; onsuccess?: () => void; onerror?: () => void } = { error: null };
    queueMicrotask(() => {
      req.result = result();
      req.onsuccess?.();
    });
    return req;
  };
  const store = {
    put: (value: unknown, key: string) => request(() => data.set(key, value) && key),
    get: (key: string) => request(() => data.get(key)),
    delete: (key: string) => request(() => data.delete(key) && undefined)
  };
  const db = { transaction: () => ({ objectStore: () => store }), createObjectStore: () => store };
  return {
    open: () => {
      const req: { result: typeof db; onupgradeneeded?: () => void; onsuccess?: () => void; onerror?: () => void } = {
        result: db
      };
      queueMicrotask(() => {
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    }
  };
}

test('remembers a linked file per event, and forgets it', async () => {
  (globalThis as { indexedDB?: unknown }).indexedDB = fakeIndexedDb();
  try {
    const handle = fakeHandle('');
    assert.equal(await recallHandle('ABC'), null);
    await rememberHandle('ABC', handle);
    assert.equal(await recallHandle('ABC'), handle);
    await forgetHandle('ABC');
    assert.equal(await recallHandle('ABC'), null);
  } finally {
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
  }
  assert.equal(await recallHandle('ABC'), null, 'no IndexedDB reads as nothing remembered');
});
