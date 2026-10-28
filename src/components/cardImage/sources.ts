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
import { isJokeArt } from '../../lib/jokeMode';
import { isJapanOnlySet, japaneseSetOf, jpCardImageKey, type JpImageTier } from '../../../shared/data/japanOnlyCards';

export type CardImageSize = 'xs' | 'sm' | 'lg';

/**
 * Where the first attempt comes from.
 *
 * `r2`: our WebP re-encodes. `proxy`: the same-origin `/thumbnails` Function.
 * `hotlink`: Limitless's CDN directly, for surfaces that show hundreds of cards
 * nobody plays (the pack opener's bulk pile) — neither our storage nor our
 * Function quota should carry those. Hotlinking was once bot-blocked in real
 * browsers (see the note above), so every mode keeps the proxy chain behind it:
 * a hotlink that gets challenged falls through to the proxy rather than to the
 * placeholder.
 */
export type ArtSource = 'r2' | 'proxy' | 'hotlink';

const LIMITLESS_CDN = 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci';

function cdnTierUrl(setU: string, num: string, size: CardImageSize): string {
  return `${LIMITLESS_CDN}/${setU}/${setU}_${num}_R_EN_${size.toUpperCase()}.png`;
}

/** Rendered width of each tier, for srcset descriptors. */
export const TIER_WIDTH: Record<CardImageSize, number> = { xs: 136, sm: 274, lg: 460 };

/** Bucket prefix for the WebP re-encodes. Exported for the readiness probe. */
export const R2_CARD_IMAGES = `${R2_ORIGIN}/card-images`;
const THUMBNAILS_PROXY = '/thumbnails';

/**
 * The September 10th arts ship with the bundle rather than the CDN: they are
 * printings that do not exist, so no upstream has a scan. One file, no tiers.
 */
function jokeArtUrl(set: string, number: string | number): string | null {
  const num = String(number);
  return isJokeArt(set, num) ? `/joke-arts/${num}.webp` : null;
}

function r2TierUrl(setU: string, num: string, size: CardImageSize): string {
  return `${R2_CARD_IMAGES}/${setU}/${setU}_${num}_R_EN_${size.toUpperCase()}.webp`;
}

/** Same-origin proxy URL. The Function normalizes the number server-side. */
function thumbTierUrl(setU: string, num: string, size: CardImageSize): string {
  return `${THUMBNAILS_PROXY}/${size}/${setU}/${num}`;
}

const SIZE_CHAINS: Record<CardImageSize, CardImageSize[]> = {
  lg: ['lg', 'sm', 'xs'],
  sm: ['sm', 'xs'],
  xs: ['xs']
};

// Limitless filenames use three-digit numbers and lowercase variant suffixes.
function paddedNumber(number: string | number): string {
  const stripped = String(number).replace(/^0+/, '') || '0';
  const parts = stripped.match(/^(\d+)([A-Za-z]*)$/);
  return parts ? `${parts[1].padStart(3, '0')}${(parts[2] ?? '').toLowerCase()}` : stripped;
}

const TIER_URLS = { r2: r2TierUrl, hotlink: cdnTierUrl, proxy: thumbTierUrl };

/**
 * Cards with no English print yet (`JP-M6`) show our R2 copy of their
 * fan-translated image from pokemonproxies.com, which the City League source
 * mirrors. It is the only English art these cards have, so it is tried first
 * whatever the caller's source; it isn't gated on the `_ready` probe, which
 * speaks for a different pipeline. A print the fan site never covered (a
 * secret rare, a set it skipped) falls through to Limitless's Japanese scan
 * through the proxy.
 */
function jpR2TierUrl(setU: string, number: string | number, size: CardImageSize): string {
  return `${R2_ORIGIN}/${jpCardImageKey(japaneseSetOf(setU), String(number), size.toUpperCase() as JpImageTier)}`;
}

function jpAttempts(setU: string, number: string | number, preferredSize: CardImageSize): string[] {
  const num = paddedNumber(number);
  return [
    jpR2TierUrl(setU, num, preferredSize),
    ...SIZE_CHAINS[preferredSize].map(size => thumbTierUrl(setU, num, size))
  ];
}

function jpSrcset(setU: string, number: string | number, preferredSize: CardImageSize): string {
  const tiers = [...SIZE_CHAINS[preferredSize]].reverse();
  return tiers.map(t => `${jpR2TierUrl(setU, number, t)} ${TIER_WIDTH[t]}w`).join(', ');
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
  source: ArtSource
): string {
  const setU = String(set).toUpperCase();
  const joke = jokeArtUrl(setU, number);
  if (joke) {
    return `${joke} ${TIER_WIDTH.lg}w`;
  }
  if (isJapanOnlySet(setU)) {
    return jpSrcset(setU, number, preferredSize);
  }
  const num = paddedNumber(number);
  // Vintage sets come from pokemontcg.io (see utils/ptcgio.ts) unless the R2
  // mirror, which re-encodes them into the Limitless tiers, is in play.
  if (hasPtcgioImages(setU) && source !== 'r2') {
    return ptcgioSrcset(setU, num) ?? '';
  }
  const tiers = [...SIZE_CHAINS[preferredSize]].reverse();
  // R2 WebP when ready, the CDN when the caller asked to hotlink, else the
  // same-origin proxy. A failed srcset pick drops to the attempt chain, which
  // still ends at the proxy.
  const urlFor = TIER_URLS[source];
  return tiers.map(t => `${urlFor(setU, num, t)} ${TIER_WIDTH[t]}w`).join(', ');
}

export function buildAttempts(
  set: string,
  number: string | number,
  preferredSize: CardImageSize,
  source: ArtSource
): string[] {
  const setU = String(set).toUpperCase();
  const joke = jokeArtUrl(setU, number);
  if (joke) {
    return [joke];
  }
  if (isJapanOnlySet(setU)) {
    return jpAttempts(setU, number, preferredSize);
  }
  const padded = paddedNumber(number);
  // 0. Vintage sets (DP era and older, POP, XY promos): Limitless's CDN has no
  //    scans, so its proxy tiers would only 404. The R2 mirror re-encodes them
  //    from pokemontcg.io, so its WebP leads when R2 is in play; pokemontcg.io
  //    itself backs it for prints the mirror has not seen.
  if (hasPtcgioImages(setU)) {
    const ptcgio = ptcgioImageUrls(setU, padded, preferredSize);
    return source === 'r2' ? [r2TierUrl(setU, padded, preferredSize), ...ptcgio] : ptcgio;
  }

  const urls = SIZE_CHAINS[preferredSize].map(size => thumbTierUrl(setU, padded, size));
  // 1. R2 WebP (preferred tier) when the pipeline has run — lightest, our domain.
  //    Or the CDN itself, when the caller hotlinks: no storage, no Function.
  if (source !== 'proxy') {
    urls.unshift(TIER_URLS[source](setU, padded, preferredSize));
  }
  return urls;
}
