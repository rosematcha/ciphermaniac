/**
 * The browser side of tournaments: the API client sends what the functions
 * expect and surfaces their error text, and the TOM file link reads a file
 * only when TOM has saved it, writes results back, and remembers the file.
 */

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import {
  ApiError,
  call,
  createFromTdf,
  createSwiss,
  deleteTournament,
  fetchDecklists,
  fetchHistory,
  fetchManage,
  fetchMyDecklist,
  fetchProfile,
  fetchPublished,
  fetchSession,
  fetchStaff,
  fetchView,
  identifyPlayer,
  joinStaff,
  leaveEvent,
  linkUrl,
  listTournaments,
  pairNextRound,
  preloadPublished,
  removeStaff,
  reportAsPlayer,
  rotateStaffToken,
  saveHandle,
  saveProfile,
  saveSettings,
  sendCommand,
  setDeck,
  setProfileName,
  setPublicProfile,
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

test('API and published polling time out, reject stalled reads, and can poll again', async context => {
  for (const read of [() => fetchView('ABC', 3), () => fetchManage('ABC', 3), () => fetchPublished('ABC')]) {
    const controller = new AbortController();
    const timeout = context.mock.method(AbortSignal, 'timeout', (milliseconds: number) => {
      assert.equal(milliseconds, 15_000);
      return controller.signal;
    });
    globalThis.fetch = ((_url: string, init: RequestInit = {}) => {
      assert.equal(init.signal, controller.signal);
      return new Promise<Response>((_resolve, reject) => {
        controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
      });
    }) as typeof fetch;
    const pending = read();
    controller.abort(new DOMException('Timed out', 'TimeoutError'));
    await assert.rejects(pending, { name: 'TimeoutError' });
    timeout.mock.restore();
    answer(200, { version: 4 });
    assert.deepEqual(await read(), { version: 4 });
  }
});

test('API calls preserve an explicit caller abort signal', async () => {
  const controller = new AbortController();
  globalThis.fetch = (async (_url: string, init: RequestInit = {}) => {
    assert.equal(init.signal, controller.signal);
    return Response.json({ ok: true });
  }) as typeof fetch;
  await call('/api/me', { signal: controller.signal });
});

test('every call goes to its endpoint with its body', async () => {
  answer(200, { ok: true });
  const profile = { popId: '1', firstName: 'A', lastName: 'B', birthDate: '02/27/2000' };
  const t = emptyTournament({ name: 'X' });
  await fetchSession();
  await saveProfile(profile);
  await listTournaments();
  await createSwiss({ name: 'Cup' });
  await createFromTdf(t, 'store-1');
  await fetchView('ABC', 3);
  await fetchManage('ABC');
  await fetchManage('ABC', 4);
  await sendCommand('ABC', { type: 'pairRound', pod: 'mixed' });
  await syncTournament('ABC', t, 'rev');
  await setDeck('ABC', '1', 'Gardevoir ex');
  await saveSettings('ABC', { decklists: 'open' });
  await joinStaff('ABC', 'tok');
  await rotateStaffToken('ABC');
  await fetchDecklists('ABC');
  await submitDecklist('ABC', { deck: 'deck', profile, archetype: null, token: 'kept' });
  await fetchMyDecklist('ABC', profile, 'tok');
  await fetchMyDecklist('ABC', { popId: '', firstName: 'Ann', lastName: 'Lee' }, 'tok');
  await fetchStaff('ABC');
  await removeStaff('ABC', 'u-1');
  const clockless = (url: string) => url.replace(/localTime=[^&]*&?/, '').replace(/\?$/, '');
  assert.deepEqual(
    sent.map(s => `${s.method} ${clockless(s.url)}`),
    [
      'GET /api/me',
      'PUT /api/me',
      'GET /api/tournaments',
      'POST /api/tournaments',
      'POST /api/tournaments',
      'GET /api/tournaments/ABC?since=3',
      'GET /api/tournaments/ABC/manage',
      'GET /api/tournaments/ABC/manage?since=4',
      'POST /api/tournaments/ABC/commands',
      'PUT /api/tournaments/ABC/sync',
      'PUT /api/tournaments/ABC/decks',
      'PUT /api/tournaments/ABC/settings',
      'POST /api/tournaments/ABC/staff',
      'POST /api/tournaments/ABC/staff',
      'GET /api/tournaments/ABC/decklists',
      'PUT /api/tournaments/ABC/decklists',
      'GET /api/tournaments/ABC/decklists?popId=1&firstName=A&lastName=B&token=tok',
      'GET /api/tournaments/ABC/decklists?popId=&firstName=Ann&lastName=Lee&token=tok',
      'GET /api/tournaments/ABC/staff',
      'DELETE /api/tournaments/ABC/staff?user=u-1'
    ]
  );
  const poll = new URL(sent[7]?.url ?? '', 'https://cm.test').searchParams.get('localTime') ?? '';
  assert.match(poll, /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/, 'a poll can settle reports, so it carries the clock');
  const decklist = sent[15]?.body as { localTime: string };
  assert.match(decklist.localTime, /^\d{2}\/\d{2}\/\d{4} /, 'a list can add its submitter, so it carries the clock');
  const command = sent[8]?.body as { localTime: string };
  assert.match(command.localTime, /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/, 'stamped with the venue clock');
  assert.deepEqual(sent[3]?.body, { mode: 'swiss', name: 'Cup' });
});

test('a player identifies and reports through one endpoint, stamped with the venue clock', async () => {
  answer(200, { key: '4' });
  await identifyPlayer('ABC', { lastName: 'Oak' });
  const match = { pod: 'masters' as const, round: 2, table: 5 };
  await reportAsPlayer('ABC', { popId: '12' }, { result: 'win', match }, 'seat-token');
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
  const reported = sent[1]?.body as {
    popId: string;
    result: string;
    match: unknown;
    localTime: string;
    reportToken: string;
  };
  assert.deepEqual([reported.popId, reported.result, reported.reportToken], ['12', 'win', 'seat-token']);
  assert.deepEqual(reported.match, match, 'names the match the page showed');
  const devices = sent.map(s => (s.body as { device?: string }).device);
  assert.ok(devices.every(Boolean), 'each carries a device ID (a fresh one each here, with no storage to keep it)');
  assert.match(reported.localTime, /^\d{2}\/\d{2}\/\d{4} /);
});

test('a TOM event’s next round is asked for over the copy synced, stamped with the venue clock', async () => {
  answer(200, { tournament: emptyTournament({ name: 'X' }) });
  const { tournament } = await pairNextRound('ABC', 'masters', 'rev');
  assert.equal(tournament.info.name, 'X');
  assert.deepEqual(
    sent.map(s => `${s.method} ${s.url}`),
    ['POST /api/tournaments/ABC/pairing']
  );
  const asked = sent[0]?.body as { pod: string; base: string; localTime: string };
  assert.deepEqual([asked.pod, asked.base], ['masters', 'rev']);
  assert.match(asked.localTime, /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/);
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

test('a published view asked for ahead of its page is read once, and only for that event', async () => {
  answer(200, { code: 'ABC', version: 3 });
  preloadPublished('ABC');
  assert.deepEqual(await fetchPublished('ABC'), { code: 'ABC', version: 3 });
  assert.equal(sent.length, 1, 'the page takes the read already under way');
  await fetchPublished('ABC');
  assert.equal(sent.length, 2, 'and reads afresh from then on');
  preloadPublished('ABC');
  await fetchPublished('XYZ');
  assert.match(sent.at(-1)?.url ?? '', /XYZ\.json$/, 'another event is not answered with this one');
  globalThis.fetch = (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch;
  preloadPublished('ABC');
  assert.equal(await fetchPublished('ABC'), null, 'a read that failed ahead of the page is an unreadable file');
});

test('History is the account’s own, and a finished event’s copy may come from the browser’s cache', async () => {
  answer(200, { entries: [] });
  assert.deepEqual(await fetchHistory(), { entries: [] });
  assert.equal(sent[0]?.url, '/api/history');
  const caches: (RequestCache | undefined)[] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit = {}) => {
    caches.push(init.cache);
    return Response.json({ code: 'ABC' });
  }) as typeof fetch;
  await fetchPublished('ABC', 'default');
  await fetchPublished('ABC');
  assert.deepEqual(caches, ['default', 'no-cache']);
});

test('a 204 answers null', async () => {
  answer(204, null);
  assert.equal(await fetchView('ABC', 3), null);
  assert.equal(await signOut(), null);
  assert.equal(await deleteTournament('ABC'), null);
  assert.equal(await withdrawDecklist('ABC', { popId: '12', firstName: 'A', lastName: 'B' }, 'kept'), null);
  assert.equal(
    sent.at(-1)?.url,
    '/api/tournaments/ABC/decklists?popId=12&firstName=A&lastName=B&token=kept',
    'withdrawn by who sent it, with the token of the device that sent it'
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

test('a public profile is read by its username, and turned on and off and named on the account', async () => {
  answer(200, { name: 'Mary', handle: 'mary', avatar: null, entries: [] });
  await fetchProfile('rose.matcha');
  await setPublicProfile(true);
  await setPublicProfile(false);
  await setProfileName('handle');
  assert.deepEqual(sent, [
    { url: '/api/profiles/rose.matcha', method: 'GET', body: undefined },
    { url: '/api/me', method: 'PATCH', body: { publicProfile: true } },
    { url: '/api/me', method: 'PATCH', body: { publicProfile: false } },
    { url: '/api/me', method: 'PATCH', body: { profileName: 'handle' } }
  ]);
});

test('an account undoes its Claim at an event', async () => {
  answer(204, null);
  assert.equal(await leaveEvent('ABC'), null);
  assert.deepEqual(sent, [{ url: '/api/tournaments/ABC/claim', method: 'DELETE', body: undefined }]);
});

test('the username uses the account endpoint', async () => {
  answer(200, { user: { handle: 'rosematcha' } });
  await saveHandle('rosematcha');
  assert.deepEqual(sent, [{ url: '/api/me', method: 'PATCH', body: { handle: 'rosematcha' } }]);
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
