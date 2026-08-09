/**
 * Proxy for gen9 Pokémon sprite icons.
 * Route: /sprites/:slug.png
 * Example: /sprites/dragapult.png -> r2.ciphermaniac.com/pokemon-sprites/gen9/dragapult.png
 *
 * Exists so the Deck Box Label Maker can rasterize sprites into a canvas and
 * still call toDataURL() — a cross-origin <img> taints the canvas and kills the
 * PNG export. Same reasoning as /thumbnails for card art.
 *
 * Primary source is our own R2 mirror (scripts/mirror-archetype-sprites.ts),
 * which only covers archetype icons; the label maker offers the full species
 * list, so anything the mirror lacks falls through to Limitless. Both are
 * edge-cached, so the fallback costs one origin fetch per sprite per PoP.
 */

import { corsPreflight } from '../lib/api/responses.js';

const MIRROR_BASE = 'https://r2.ciphermaniac.com/pokemon-sprites/gen9';
const FALLBACK_BASE = 'https://r2.limitlesstcg.net/pokemon/gen9';

const CACHE_TTL = 86400; // edge fetch TTL
// A given gen's sprite never changes once published.
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

// Sprite slugs are lowercase, hyphenated, with optional form suffixes:
// `dragapult`, `greninja-mega`, `raging-bolt`, `mr-mime-galar`.
// Anything else is rejected — without this the route is an open proxy.
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 40;

interface Context {
  request: Request;
}

type CfRequestInit = RequestInit & { cf?: unknown };

function plainError(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }
  });
}

export async function onRequest(context: Context): Promise<Response> {
  const { request } = context;
  const url = new URL(request.url);

  // /sprites/dragapult.png -> ['sprites', 'dragapult.png']
  const parts = url.pathname.split('/').filter(Boolean).slice(1);
  if (parts.length !== 1) {
    return plainError(`Invalid path format. Expected: /sprites/{slug}.png, got: ${url.pathname}`, 400);
  }

  const slug = parts[0].replace(/\.png$/, '');
  if (!slug || slug.length > MAX_SLUG_LENGTH || !SLUG_PATTERN.test(slug)) {
    return plainError('Invalid sprite slug.', 400);
  }

  let lastStatus = 404;
  for (const base of [MIRROR_BASE, FALLBACK_BASE]) {
    const requestInit: CfRequestInit = {
      cf: { cacheTtl: CACHE_TTL, cacheEverything: true }
    };

    let response: Response;
    try {
      response = await fetch(`${base}/${slug}.png`, requestInit);
    } catch {
      // Origin unreachable — try the next source rather than 500ing.
      lastStatus = 502;
      continue;
    }

    if (!response.ok) {
      lastStatus = response.status;
      continue;
    }

    const headers = new Headers(response.headers);
    // Drop Limitless/Cloudflare's `__cf_bm` cookie: its Domain is a public
    // suffix, so browsers reject it, and any response carrying Set-Cookie is
    // uncacheable at the edge — which would invoke this Function per sprite
    // per view. See functions/thumbnails/[[path]].ts for the full story.
    headers.delete('Set-Cookie');
    headers.delete('Vary');
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    headers.set('Cache-Control', IMMUTABLE_CACHE_CONTROL);
    headers.set('Content-Type', 'image/png');

    return new Response(response.body, { status: response.status, headers });
  }

  return plainError('Sprite not found', lastStatus);
}

export async function onRequestOptions(): Promise<Response> {
  return corsPreflight('GET, OPTIONS', { maxAge: 86400 });
}
