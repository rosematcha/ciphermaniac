/**
 * The Clerk sign-in client (src/lib/tournament/clerk.ts) against a stand-in
 * document and Clerk: the script comes from the key's own Frontend API and
 * only once, a load that fails is tried again, a sign-in or sign-up answers
 * Clerk's token and leaves no Clerk session, the token goes to
 * /api/auth/clerk as a form, and Clerk's refusals read as words.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { clerkProblem, clerkToken, postClerkToken, prepareClerk } from '../../src/lib/tournament/clerk.ts';

const KEY = `pk_test_${btoa('clerk.cm.test$')}`;

type Listener = () => void;

interface FakeElement {
  tag: string;
  dataset: Record<string, string>;
  listeners: Record<string, Listener>;
  children: FakeElement[];
  [key: string]: unknown;
}

interface Calls {
  scripts: FakeElement[];
  forms: FakeElement[];
  submitted: Record<string, string>[];
  created: { mode: string; params: Record<string, string> }[];
  removed: number;
}

/** How the stand-in Clerk answers; each test sets what it needs. */
interface Behaviour {
  scriptFails: boolean;
  status: string | null;
  token: string | null;
  removeFails: boolean;
  refuse: unknown;
}

let calls: Calls;
let behaviour: Behaviour;
const globals = globalThis as { document?: unknown; window?: unknown };
const before = { document: globals.document, window: globals.window };

function element(tag: string): FakeElement {
  const made: FakeElement = {
    tag,
    dataset: {},
    listeners: {},
    children: [],
    addEventListener(type: string, listener: Listener) {
      made.listeners[type] = listener;
    },
    append(child: FakeElement) {
      made.children.push(child);
    },
    submit() {
      calls.submitted.push(Object.fromEntries(made.children.map(input => [input.name, input.value])) as never);
    }
  };
  return made;
}

function session() {
  return {
    getToken: async () => behaviour.token,
    remove: async () => {
      calls.removed += 1;
      fakeClerk.session = null;
      if (behaviour.removeFails) {
        throw new Error('network');
      }
    }
  };
}

const attempt = (mode: string) => async (params: Record<string, string>) => {
  calls.created.push({ mode, params });
  if (behaviour.refuse) {
    throw behaviour.refuse;
  }
  return { status: behaviour.status, createdSessionId: 'sess_1' };
};

const fakeClerk = {
  session: null as ReturnType<typeof session> | null,
  load: async () => undefined,
  client: { signIn: { create: attempt('in') }, signUp: { create: attempt('up') } },
  setActive: async () => {
    fakeClerk.session = session();
  }
};
const fakeWindow: { Clerk?: typeof fakeClerk } = {};

const fakeDocument = {
  createElement: (tag: string) => element(tag),
  head: {
    append(script: FakeElement) {
      calls.scripts.push(script);
      queueMicrotask(() => {
        if (behaviour.scriptFails) {
          script.listeners.error?.();
          return;
        }
        fakeWindow.Clerk = fakeClerk;
        script.listeners.load?.();
      });
    }
  },
  body: {
    append(form: FakeElement) {
      calls.forms.push(form);
    }
  }
};

beforeEach(() => {
  calls = { scripts: [], forms: [], submitted: [], created: [], removed: 0 };
  behaviour = {
    scriptFails: false,
    status: 'complete',
    token: 'token-1',
    removeFails: false,
    refuse: null
  };
  fakeClerk.session = null;
  Object.assign(globals, { document: fakeDocument, window: fakeWindow });
});

afterEach(() => {
  Object.assign(globals, before);
});

// These run in order: the client keeps Clerk loaded for the page, as it would in a browser.

test('a key that names no instance loads nothing', async () => {
  await assert.rejects(
    clerkToken('pk_test_nothing', { mode: 'in', username: 'pat', password: 'pw' }),
    /names no instance/
  );
  assert.equal(calls.scripts.length, 0);
});

test('a script that fails to load is tried again on the next use', async () => {
  behaviour.scriptFails = true;
  await assert.rejects(prepareClerk(KEY), /did not load/);
  behaviour.scriptFails = false;
  await prepareClerk(KEY);
  assert.equal(calls.scripts.length, 2, 'loaded again after the failure');
  const [, script] = calls.scripts;
  assert.equal(script?.src, 'https://clerk.cm.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js');
  assert.equal(script?.dataset.clerkPublishableKey, KEY);
  assert.equal(script?.crossOrigin, 'anonymous');
});

test('Clerk loads once per page', async () => {
  await prepareClerk(KEY);
  await clerkToken(KEY, { mode: 'in', username: 'pat', password: 'pw' });
  assert.equal(calls.scripts.length, 0);
});

test('signing in answers Clerk’s token and leaves no Clerk session', async () => {
  const token = await clerkToken(KEY, { mode: 'in', username: 'pat_plays', password: 'secret' });
  assert.equal(token, 'token-1');
  assert.deepEqual(calls.created, [{ mode: 'in', params: { identifier: 'pat_plays', password: 'secret' } }]);
  assert.equal(fakeClerk.session, null);
  assert.equal(calls.removed, 1);
});

test('making an account asks Clerk for a sign-up with the username', async () => {
  await clerkToken(KEY, { mode: 'up', username: 'new_player', password: 'a long passphrase' });
  assert.deepEqual(calls.created, [{ mode: 'up', params: { username: 'new_player', password: 'a long passphrase' } }]);
});

test('a Clerk session left from before is ended first, and ending it may fail without losing the token', async () => {
  fakeClerk.session = session();
  behaviour.removeFails = true;
  assert.equal(await clerkToken(KEY, { mode: 'in', username: 'pat', password: 'pw' }), 'token-1');
  assert.equal(calls.removed, 2, 'the old session, then the new one');
});

test('a sign-in Clerk has not finished, or one with no token, signs no one in', async () => {
  behaviour.status = 'needs_second_factor';
  await assert.rejects(clerkToken(KEY, { mode: 'in', username: 'pat', password: 'pw' }), /needs_second_factor/);
  behaviour.status = 'complete';
  behaviour.token = null;
  await assert.rejects(clerkToken(KEY, { mode: 'in', username: 'pat', password: 'pw' }), /no session token/);
  assert.equal(fakeClerk.session, null, 'the session went anyway');
});

test('Clerk without a client refuses', async () => {
  const { client } = fakeClerk;
  (fakeClerk as { client?: unknown }).client = undefined;
  try {
    await assert.rejects(clerkToken(KEY, { mode: 'in', username: 'pat', password: 'pw' }), /no client/);
  } finally {
    fakeClerk.client = client;
  }
});

test('the token goes to /api/auth/clerk as a posted form, with the link flag only when linking', () => {
  postClerkToken('token-1', '/host');
  postClerkToken('token-2', '/settings', true);
  const [form] = calls.forms;
  assert.equal(form?.method, 'POST');
  assert.equal(form?.action, '/api/auth/clerk');
  assert.equal(form?.hidden, true);
  assert.ok(form?.children.every(input => input.type === 'hidden'));
  assert.deepEqual(calls.submitted, [
    { token: 'token-1', next: '/host' },
    { token: 'token-2', next: '/settings', link: '1' }
  ]);
});

test('Clerk’s refusals read as words: known codes as ours, others as Clerk’s, anything else as a retry', () => {
  assert.equal(clerkProblem({ errors: [{ code: 'form_password_incorrect' }] }), 'Wrong username or password.');
  assert.equal(clerkProblem({ errors: [{ code: 'form_identifier_exists' }] }), 'That username is taken.');
  assert.equal(clerkProblem({ errors: [{ code: 'form_password_length_too_short' }] }), 'Use at least 15 characters.');
  assert.equal(
    clerkProblem({ errors: [{ code: 'new_code', longMessage: 'Long words.', message: 'Short' }] }),
    'Long words.'
  );
  assert.equal(clerkProblem({ errors: [{ code: 'new_code', message: 'Short words.' }] }), 'Short words.');
  assert.equal(clerkProblem({ errors: [] }), 'Sign-in failed. Try again.');
  assert.equal(clerkProblem(new Error('network')), 'Sign-in failed. Try again.');
  assert.equal(clerkProblem(null), 'Sign-in failed. Try again.');
});
