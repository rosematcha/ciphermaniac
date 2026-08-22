/**
 * Where a card's art comes from, and in what order to try.
 *
 * Pure URL construction, split out of CardImage so the source decision can be
 * tested without a browser — an adversarial review pointed out the component
 * had no tests at all, and the `skipR2` opt-out shipped with a gap because of
 * it.
 *
 * Why not hotlink the LimitlessTCG CDN: it sits behind Cloudflare
 * bot-management, which sets a `__cf_bm` cookie scoped to the public suffix
 * `digitaloceanspaces.com`. Browsers reject that cookie, and without the
 * session it establishes, concurrent image loads get 403-challenged — so a page
 * full of card art shows placeholders. The same-origin proxy sidesteps it (the
 * browser talks to us; we fetch the CDN) and its responses are edge-cached.
 * There is deliberately no direct-CDN fallback tier: those requests are doomed
 * in real browsers.
 * @module src/components/cardImage/sources
 */

import { hasPtcgioImages, ptcgioImageUrls, ptcgioSrcset } from '../../utils/ptcgio';
import { R2_ORIGIN } from '../../lib/constants';

export type CardImageSize = 'xs' | 'sm' | 'lg';

/** Rendered width of each tier, for srcset descriptors. */
export const TIER_WIDTH: Record<CardImageSize, number> = { xs: 136, sm: 274, lg: 460 };

/** Bucket prefix for the WebP re-encodes. Exported for the readiness probe. */
export const R2_CARD_IMAGES = `${R2_ORIGIN}/card-images`;
const THUMBNAILS_PROXY = '/thumbnails';

function r2TierUrl(setU: string, num: string, size: CardImageSize): string {
  return `${R2_CARD_IMAGES}/${setU}/${setU}_${num}_R_EN_${size.toUpperCase()}.webp`;
}

/** Same-origin proxy URL. The Function normalizes the number server-side. */
function thumbTierUrl(setU: string, num: string, size: CardImageSize): string {
  return `${THUMBNAILS_PROXY}/${size}/${setU}/${num}`;
}

/**
 * srcset over every tier up to (and including) the preferred size, using the
 * padded number form. Only used for the first attempt — if anything 404s we
 * fall back to the plain single-src retry chain, which stays authoritative.
 */
export function buildSrcset(
  set: string,
  number: string | number,
  preferredSize: CardImageSize,
  useR2: boolean
): string {
  const setU = String(set).toUpperCase();
  const stripped = String(number).replace(/^0+/, '') || '0';
  const parts = stripped.match(/^(\d+)([A-Za-z]*)$/);
  // Variant suffixes are lowercase in the CDN filenames (SLG_068a) even though
  // UIDs store them uppercase — and the CDN is case-sensitive.
  const num = parts ? `${parts[1].padStart(3, '0')}${(parts[2] ?? '').toLowerCase()}` : stripped;
  // Vintage sets live on pokemontcg.io (see utils/ptcgio.ts) — neither R2 nor
  // the Limitless proxy has their scans.
  if (hasPtcgioImages(setU)) {
    return ptcgioSrcset(setU, num) ?? '';
  }
  const tiers: CardImageSize[] = preferredSize === 'lg' ? ['xs', 'sm', 'lg'] : ['xs', 'sm'];
  // R2 WebP when ready, else the same-origin proxy — never hotlink the CDN in
  // srcset, since that's the path the browser bot-blocks.
  const urlFor = useR2 ? r2TierUrl : thumbTierUrl;
  return tiers.map(t => `${urlFor(setU, num, t)} ${TIER_WIDTH[t]}w`).join(', ');
}

export function buildAttempts(
  set: string,
  number: string | number,
  preferredSize: CardImageSize,
  useR2: boolean
): string[] {
  const setU = String(set).toUpperCase();
  const numStr = String(number);
  const stripped = numStr.replace(/^0+/, '') || '0';
  const parts = stripped.match(/^(\d+)([A-Za-z]*)$/);
  // Limitless's CDN uses 3-digit zero-padded numbers (PRE_037, not PRE_37) and
  // lowercase variant suffixes (SLG_068a) — it is case-sensitive.
  const padded = parts ? `${parts[1].padStart(3, '0')}${(parts[2] ?? '').toLowerCase()}` : stripped;

  // Size fallback chain: lg → sm → xs.
  const sizeChain: CardImageSize[] =
    preferredSize === 'lg' ? ['lg', 'sm', 'xs'] : preferredSize === 'sm' ? ['sm', 'xs'] : ['xs'];

  const seen = new Set<string>();
  const urls: string[] = [];
  const push = (url: string) => {
    if (!seen.has(url)) {
      seen.add(url);
      urls.push(url);
    }
  };

  // 0. Vintage sets (DP era and older, POP, XY promos): Limitless's CDN has no
  //    scans, so R2 and the proxy would only 404 — go straight to
  //    pokemontcg.io. Hotlinking is safe there: no bot-management cookie.
  if (hasPtcgioImages(setU)) {
    for (const url of ptcgioImageUrls(setU, padded, preferredSize)) {
      push(url);
    }
    return urls;
  }

  // 1. R2 WebP (preferred tier) when the pipeline has run — lightest, our domain.
  if (useR2) {
    push(r2TierUrl(setU, padded, preferredSize));
  }
  // 2. Same-origin proxy for each tier. This is the reliable browser-facing
  //    source: it dodges the CDN's browser-rejected bot cookie, and the proxy
  //    normalizes the number itself, so one URL per tier suffices. No direct-CDN
  //    tail after this — those hotlinks are bot-blocked in real browsers, so the
  //    chain ends here and falls to the placeholder.
  for (const size of sizeChain) {
    push(thumbTierUrl(setU, padded, size));
  }
  return urls;
}
