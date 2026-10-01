/** What every tournament and account function needs from its environment. */

import type { D1Like, ProofBucket, PublishBucket } from '../types.js';
import type { AuthEnv } from './oauth.js';

export interface TournamentEnv extends AuthEnv {
  TOURNAMENT_DB?: D1Like;
  /** The data bucket r2.ciphermaniac.com serves; event views are published to it. */
  REPORTS?: PublishBucket;
  /** What the scheduled sweep that ends idle events sends as its bearer token (functions/api/tournaments/idle.ts). */
  IDLE_SWEEP_TOKEN?: string;
  /** The private bucket organizer Applications' proofs are kept in; never served but to an admin. */
  PROOFS?: ProofBucket;
}

export interface Context<Params extends string = never> {
  request: Request;
  env: TournamentEnv;
  params: { [key in Params]: string | string[] };
  /** Keeps the function alive for work that outlasts the answer; tests call the handlers without it. */
  waitUntil?: (promise: Promise<unknown>) => void;
}

/** A route parameter as one string; Pages hands catch-alls over as arrays. */
export function param(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value.join('/') : (value ?? '');
}

/**
 * Whether a state-changing request came from this site. The session cookie is
 * SameSite=Lax, which already keeps it off another site's POST; checking the
 * Origin as well covers browsers that treat Lax loosely.
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  return origin === null || origin === new URL(request.url).origin;
}
