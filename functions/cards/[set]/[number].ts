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
 * client JS.
 */

import { loadCardSynonyms } from '../../lib/data/cardSynonyms';
import { normalizeCardNumber } from '../../../shared/cardUtils';
import type { SynonymDatabase } from '../../../shared/synonyms';

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

// Module-level cache survives within an isolate. `loadCardSynonyms` also
// caches (KV/R2), but pinning here avoids the R2 fetch + JSON parse on each
// request once the isolate is warm. Bound the TTL so a warm isolate doesn't
// keep serving yesterday's synonyms forever after the daily cron writes a
// fresh DB to R2.
const SYNONYM_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
let cachedDb: SynonymDatabase | null = null;
let cachedAt = 0;

export async function onRequest(context: Context): Promise<Response> {
  const { params, env, request } = context;
  const reqSet = (params.set ?? '').toUpperCase();
  const reqNumber = normalizeCardNumber(params.number ?? '');

  if (!reqSet || !reqNumber) {
    return context.next();
  }

  try {
    if (!cachedDb || Date.now() - cachedAt > SYNONYM_CACHE_TTL_MS) {
      cachedDb = await loadCardSynonyms(env);
      cachedAt = Date.now();
    }
    const db = cachedDb;
    if (!db?.synonyms) {
      return context.next();
    }

    for (const [variantUid, canonicalUid] of Object.entries(db.synonyms)) {
      if (typeof canonicalUid !== 'string') {
        continue;
      }
      const vParts = variantUid.split('::');
      if (vParts.length < 3) {
        continue;
      }
      if (vParts[1].toUpperCase() !== reqSet) {
        continue;
      }
      if (normalizeCardNumber(vParts[2]) !== reqNumber) {
        continue;
      }

      const cParts = canonicalUid.split('::');
      if (cParts.length < 3) {
        continue;
      }
      const cSet = cParts[1];
      const cNum = cParts[2];

      // Already canonical (e.g. variantUid happens to also be canonical) —
      // no redirect needed; let the SPA render normally.
      if (cSet.toUpperCase() === reqSet && normalizeCardNumber(cNum) === reqNumber) {
        break;
      }

      const dest = new URL(`/cards/${cSet}/${cNum}`, request.url);
      return Response.redirect(dest.toString(), 301);
    }
  } catch (err) {
    // If synonym lookup fails for any reason, fall through to the SPA shell.
    // The client-side resolver will still try to recover.
    console.error('cards edge redirect: synonym lookup failed', err);
  }

  return context.next();
}
