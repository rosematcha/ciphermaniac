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

import { corsPreflight, IMAGE_FETCH_INIT, imageProxyResponse, textError } from '../lib/api/responses.js';

const MIRROR_BASE = 'https://r2.ciphermaniac.com/pokemon-sprites/gen9';
const FALLBACK_BASE = 'https://r2.limitlesstcg.net/pokemon/gen9';

// Sprite slugs are lowercase, hyphenated, with optional form suffixes:
// `dragapult`, `greninja-mega`, `raging-bolt`, `mr-mime-galar`.
// Anything else is rejected — without this the route is an open proxy.
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 40;

interface Context {
  request: Request;
}

export async function onRequest(context: Context): Promise<Response> {
  const { request } = context;
  const url = new URL(request.url);

  // /sprites/dragapult.png -> ['sprites', 'dragapult.png']
  const parts = url.pathname.split('/').filter(Boolean).slice(1);
  if (parts.length !== 1) {
    return textError(`Invalid path format. Expected: /sprites/{slug}.png, got: ${url.pathname}`, 400);
  }

  const slug = parts[0].replace(/\.png$/, '');
  if (!slug || slug.length > MAX_SLUG_LENGTH || !SLUG_PATTERN.test(slug)) {
    return textError('Invalid sprite slug.', 400);
  }

  let lastStatus = 404;
  for (const base of [MIRROR_BASE, FALLBACK_BASE]) {
    let response: Response;
    try {
      response = await fetch(`${base}/${slug}.png`, IMAGE_FETCH_INIT);
    } catch {
      // Origin unreachable — try the next source rather than 500ing.
      lastStatus = 502;
      continue;
    }

    if (!response.ok) {
      lastStatus = response.status;
      continue;
    }

    return imageProxyResponse(response);
  }

  return textError('Sprite not found', lastStatus);
}

export async function onRequestOptions(): Promise<Response> {
  return corsPreflight('GET, OPTIONS', { maxAge: 86400 });
}
