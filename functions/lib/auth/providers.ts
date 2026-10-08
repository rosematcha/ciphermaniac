/**
 * Which sign-in buttons the site should show: Google and Discord as far as
 * each is configured, username and password through Clerk, and the local dev
 * sign-in.
 */

import { clerkKeys } from './clerk.js';
import { type AuthEnv, configuredOAuth, devLoginEnabled, type ProviderId } from './oauth.js';

export function availableProviders(env: AuthEnv): ProviderId[] {
  const clerk = clerkKeys(env) ? (['clerk'] as const) : [];
  const dev = devLoginEnabled(env) ? (['dev'] as const) : [];
  return [...configuredOAuth(env), ...clerk, ...dev];
}
