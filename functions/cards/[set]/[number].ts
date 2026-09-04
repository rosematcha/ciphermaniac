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
  resolveCanonicalRoute
} from '../../../shared/data/canonicalCardRoute';
import { loadCardSynonyms } from '../../../shared/data/cardSynonyms';
import type { SynonymDatabase } from '../../../shared/data/cardIdentity';

interface Env {
  CARD_TYPES_KV?: KVNamespace;
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

export async function onRequest(context: Context): Promise<Response> {
  const { params, env, request } = context;

  try {
    const db = await loadCardSynonyms(env);
    if (!db?.synonyms) {
      return context.next();
    }

    const canonical = resolveCanonicalRoute(getRouteIndex(db), params.set, params.number);
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
