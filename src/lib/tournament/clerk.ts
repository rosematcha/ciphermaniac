/**
 * Username and password sign-in through Clerk, from the page's side. Clerk's
 * script comes from the instance's own Frontend API, and only once someone
 * submits the form, so no page carries it otherwise. Clerk checks the
 * password; its session lasts only long enough to take a token, which is
 * posted to /api/auth/clerk as a form, where the account and its session are
 * ours (functions/api/auth/clerk.ts).
 */

import { frontendApi, PASSWORD_MIN } from '../../../shared/accounts/clerk';

export type ClerkMode = 'in' | 'up';

interface Attempt {
  status: string | null;
  createdSessionId: string | null;
}

/** The few parts of Clerk's browser SDK this uses. */
interface ClerkJs {
  load: () => Promise<void>;
  client?: {
    signIn: { create: (params: { identifier: string; password: string }) => Promise<Attempt> };
    signUp: { create: (params: { username: string; password: string }) => Promise<Attempt> };
  };
  /** `remove` signs this session out; `signOut` would also navigate away, racing the post. */
  session?: { getToken: () => Promise<string | null>; remove: () => Promise<unknown> } | null;
  setActive: (params: { session: string }) => Promise<void>;
}

declare global {
  interface Window {
    Clerk?: ClerkJs;
  }
}

/** Clerk's major version; the instance serves its latest release within it. */
const CLERK_MAJOR = 6;

let loading: Promise<ClerkJs> | null = null;

function injectScript(publishableKey: string): Promise<ClerkJs> {
  const origin = frontendApi(publishableKey);
  if (!origin) {
    return Promise.reject(new Error('Clerk publishable key names no instance'));
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${origin}/npm/@clerk/clerk-js@${CLERK_MAJOR}/dist/clerk.browser.js`;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.dataset.clerkPublishableKey = publishableKey;
    script.addEventListener('load', () =>
      window.Clerk ? resolve(window.Clerk) : reject(new Error('Clerk did not load'))
    );
    script.addEventListener('error', () => reject(new Error('Clerk did not load')));
    document.head.append(script);
  });
}

/** Clerk, loaded once per page; a failed load is tried again next time. */
function loadClerk(publishableKey: string): Promise<ClerkJs> {
  loading ??= injectScript(publishableKey)
    .then(async clerk => {
      await clerk.load();
      return clerk;
    })
    .catch((error: unknown) => {
      loading = null;
      throw error;
    });
  return loading;
}

/** Starts loading Clerk before it is needed, so the first submit waits on less. */
export function prepareClerk(publishableKey: string): Promise<void> {
  return loadClerk(publishableKey).then(() => undefined);
}

/** Signs Clerk's session out, if there is one; a failure here costs nothing the token needs. */
async function endSession(clerk: ClerkJs): Promise<void> {
  await clerk.session?.remove().catch(() => undefined);
}

export interface Credentials {
  mode: ClerkMode;
  username: string;
  password: string;
}

/** Signs in or up with Clerk and answers the session token, leaving no Clerk session behind. */
export async function clerkToken(publishableKey: string, credentials: Credentials): Promise<string> {
  const clerk = await loadClerk(publishableKey);
  if (!clerk.client) {
    throw new Error('Clerk has no client');
  }
  // One left from a sign-in that never finished would refuse another.
  await endSession(clerk);
  const { mode, username, password } = credentials;
  const attempt =
    mode === 'in'
      ? await clerk.client.signIn.create({ identifier: username, password })
      : await clerk.client.signUp.create({ username, password });
  if (attempt.status !== 'complete' || !attempt.createdSessionId) {
    throw new Error(`Clerk sign-${mode} is ${attempt.status ?? 'unfinished'}`);
  }
  await clerk.setActive({ session: attempt.createdSessionId });
  const token = await clerk.session?.getToken();
  await endSession(clerk);
  if (!token) {
    throw new Error('Clerk gave no session token');
  }
  return token;
}

/**
 * Hands the token to /api/auth/clerk as a real form post, so the browser
 * follows the answer as it does a provider's callback.
 */
export function postClerkToken(token: string, next: string, link = false): void {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = '/api/auth/clerk';
  form.hidden = true;
  const fields: [string, string][] = [
    ['token', token],
    ['next', next]
  ];
  if (link) {
    fields.push(['link', '1']);
  }
  for (const [name, value] of fields) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.append(input);
  }
  document.body.append(form);
  form.submit();
}

interface ClerkApiError {
  code?: string;
  longMessage?: string;
  message?: string;
}

/** The first error Clerk gave, when it gave one. */
function firstError(error: unknown): ClerkApiError | null {
  const errors = (error as { errors?: unknown } | null)?.errors;
  return Array.isArray(errors) && errors.length > 0 ? (errors[0] as ClerkApiError) : null;
}

// Placeholder copy until it is written.
const PROBLEMS = new Map<string, string>([
  ['form_identifier_not_found', 'Wrong username or password.'],
  ['form_password_incorrect', 'Wrong username or password.'],
  ['form_identifier_exists', 'That username is taken.'],
  ['form_password_pwned', 'That password has appeared in a data breach. Choose another.'],
  ['form_password_length_too_short', `Use at least ${PASSWORD_MIN} characters.`],
  ['user_locked', 'Too many tries. Try again later.'],
  ['too_many_requests', 'Too many tries. Try again later.']
]);

/** What to tell the person when Clerk refused. */
export function clerkProblem(error: unknown): string {
  const first = firstError(error);
  const known = first?.code ? PROBLEMS.get(first.code) : undefined;
  return known ?? first?.longMessage ?? first?.message ?? 'Sign-in failed. Try again.';
}
