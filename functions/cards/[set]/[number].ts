/**
 * Edge redirect for non-canonical card URLs.
 *
 * Matches /cards/:set/:number. If (set, number) is a known reprint variant
 * in the synonym DB, 301-redirects to the canonical /cards/{SET}/{NUMBER}.
 * Otherwise calls `next()` so the SPA shell serves and the Solid router
 * takes over.
 *
 * The SPA also resolves canonical URLs client-side (see
 * `src/lib/data.ts:resolveCanonicalSetNumber`), so this is belt-and-suspenders:
 * direct links, crawlers, and shared URLs get a real 301 without depending on
 * client JS. Both sides route through the SAME resolver
 * (`shared/data/canonicalCardRoute`) — when they had independent index builds
 * they could disagree on a contested key and 301 at each other.
 */

import {
  buildCanonicalRouteIndex,
  type CanonicalRouteIndex,
  cardRouteKey,
  resolveCanonicalRoute,
  routeIndexFromJson
} from '../../../shared/data/canonicalCardRoute';
import { loadCardSynonyms } from '../../../shared/data/cardSynonyms';
import { coalescedRead } from '../../../shared/coalesce';
import type { SynonymDatabase } from '../../../shared/data/cardIdentity';

interface Env {
  REPORTS?: R2Bucket;
}

interface Context {
  request: Request;
  env: Env;
  params: { set: string; number: string };
  next: () => Promise<Response>;
}

// Route index built once per synonym DB load instead of re-scanning
// db.synonyms with per-entry split/uppercase/normalize on every card view.
// Keyed by DB object identity (WeakMap) so a fresh DB from `loadCardSynonyms`
// — which itself caches per isolate with a TTL — transparently gets a fresh
// index. Mirrors the SPA's cache in src/lib/data.ts.
const routeIndexCache = new WeakMap<object, CanonicalRouteIndex>();

function getRouteIndex(db: SynonymDatabase): CanonicalRouteIndex {
  const cached = routeIndexCache.get(db);
  if (cached) {
    return cached;
  }
  const index = buildCanonicalRouteIndex(db);
  routeIndexCache.set(db, index);
  return index;
}

// The producer publishes the solved index (a few thousand entries) beside the synonym database.
// Reading it skips parsing the whole database and solving the route graph, which cost a cold isolate
// about 18 ms of CPU. Whether a table was found is pinned per bucket for the synonym database's hour,
// and concurrent cold requests share one lookup, fallback included.
const ROUTES_KEY = 'assets/card-routes.json';
const ROUTES_TTL_MS = 60 * 60 * 1000;
const publishedRoutes = new WeakMap<R2Bucket, { index: CanonicalRouteIndex | null; expiresAt: number }>();
// As long as a synonym read may be joined, since a cold lookup can fall back to one.
const readIndex = coalescedRead<CanonicalRouteIndex | null>(5000);

async function fetchPublishedRoutes(bucket: R2Bucket): Promise<CanonicalRouteIndex | null> {
  try {
    const object = await bucket.get(ROUTES_KEY);
    return object ? routeIndexFromJson(JSON.parse(await object.text())) : null;
  } catch (error) {
    console.error('cards edge redirect: route table unreadable', error);
    return null;
  }
}

function pinnedRoutes(bucket: R2Bucket): { index: CanonicalRouteIndex | null } | null {
  const pinned = publishedRoutes.get(bucket);
  return pinned && Date.now() < pinned.expiresAt ? pinned : null;
}

/** The published table, or the index solved from the synonym database until one is published. */
async function readOrSolve(env: Env, bucket: R2Bucket): Promise<CanonicalRouteIndex | null> {
  let pinned = pinnedRoutes(bucket);
  if (!pinned) {
    pinned = { index: await fetchPublishedRoutes(bucket) };
    publishedRoutes.set(bucket, { ...pinned, expiresAt: Date.now() + ROUTES_TTL_MS });
  }
  if (pinned.index) {
    return pinned.index;
  }
  const db = await loadCardSynonyms(env);
  return db?.synonyms ? getRouteIndex(db) : null;
}

async function loadRouteIndex(env: Env): Promise<CanonicalRouteIndex | null> {
  const bucket = env.REPORTS;
  if (!bucket) {
    return null;
  }
  return pinnedRoutes(bucket)?.index ?? readIndex(bucket, ROUTES_KEY, () => readOrSolve(env, bucket));
}

export async function onRequest(context: Context): Promise<Response> {
  const { params, env, request } = context;

  if (!cardRouteKey(params.set, params.number)) {
    return context.next();
  }

  try {
    const index = await loadRouteIndex(env);
    if (!index) {
      return context.next();
    }

    const canonical = resolveCanonicalRoute(index, params.set, params.number);
    if (canonical) {
      const dest = new URL(`/cards/${canonical.set}/${canonical.number}`, request.url);
      return Response.redirect(dest.toString(), 301);
    }
  } catch (err) {
    // If synonym lookup fails for any reason, fall through to the SPA shell.
    // The client-side resolver will still try to recover.
    console.error('cards edge redirect: synonym lookup failed', err);
  }

  return context.next();
}
