/**
 * POST /api/auth/clerk — the end of a username and password sign-in. The
 * sign-in page checks the password with Clerk, signs back out of Clerk, and
 * posts Clerk's session token here as a form: `token`, `next`, and `link=1`
 * to add the sign-in to the signed-in account. From there it ends as Google's
 * or Discord's callback does (lib/auth/finish.ts).
 *
 * The post must carry this site's Origin. Another site posting a token of its
 * own would sign the visitor into an account that isn't theirs; it is sent
 * where any failed sign-in goes, having read nothing.
 */

import { redirectWithCookies, safeNext } from '../../lib/auth/cookies.js';
import { clerkKeys, clerkProfile } from '../../lib/auth/clerk.js';
import type { Context } from '../../lib/auth/env.js';
import { finishSignIn, type Started } from '../../lib/auth/finish.js';
import { jsonError } from '../../lib/api/responses.js';

const failed = () => redirectWithCookies('/settings?signin=failed', []);

async function readForm(request: Request): Promise<{ token: string; started: Started }> {
  const form = await request.formData().catch(() => new FormData());
  const value = (name: string) => {
    const entry = form.get(name);
    return typeof entry === 'string' ? entry : '';
  };
  return { token: value('token'), started: { next: safeNext(value('next') || null), linking: value('link') === '1' } };
}

export async function onRequestPost({ request, env }: Context): Promise<Response> {
  const db = env.TOURNAMENT_DB;
  if (!db || !clerkKeys(env)) {
    return jsonError('Sign-in is not available', 503);
  }
  const { origin } = new URL(request.url);
  if (request.headers.get('Origin') !== origin) {
    console.warn('Clerk sign-in refused: Origin is not this site');
    return failed();
  }
  const { token, started } = await readForm(request);
  try {
    const profile = await clerkProfile(env, origin, token);
    return profile ? await finishSignIn(db, request, profile, started) : failed();
  } catch (error) {
    console.error('Clerk sign-in failed', error);
    return failed();
  }
}
