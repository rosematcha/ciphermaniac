/**
 * The September 10th arts.
 *
 * Five printings that do not exist, added to their card's printings strip for
 * one day a year. They live in `static/joke-arts/` under the reserved set code
 * {@link JOKE_SET}, which `components/cardImage/sources` resolves to a bundled
 * file instead of the CDN, and they are deliberately absent from the Tier List:
 * its arts come from the card-art-groups artifact, which is built from real
 * scans and never sees these.
 * @module src/lib/jokeMode
 */

/** Set code the bundled arts print under. No real expansion uses it. */
export const JOKE_SET = 'UVU';

/** URL modifier that turns the arts on out of season: `?j=1`. */
export const JOKE_PARAM = 'j';

/** Which card gets which bundled file, keyed by exact card name. */
const JOKE_ARTS: Readonly<Record<string, string>> = {
  "Boss's Orders": '001',
  Budew: '002',
  Crispin: '003',
  'Dragapult ex': '004',
  "Lillie's Determination": '005'
};

/**
 * Whether a set/number pair is one of the bundled arts.
 *
 * Narrower than a bare {@link JOKE_SET} check on purpose: the code is made up
 * today, but if an expansion ever claims it, only these five numbers are
 * diverted to the bundle and the rest of the set resolves normally.
 */
export function isJokeArt(set: string, number: string): boolean {
  return set.toUpperCase() === JOKE_SET && Object.values(JOKE_ARTS).includes(number);
}

/** The joke art's number for a card name, or null when that card has none. */
export function jokeArtNumber(cardName: string): string | null {
  // hasOwn, not a bare lookup: a card named "toString" would otherwise inherit
  // Object.prototype's method and be handed to the image URL builder.
  return Object.hasOwn(JOKE_ARTS, cardName) ? JOKE_ARTS[cardName] : null;
}

/**
 * Whether the date is September 10th, read in the visitor's own timezone —
 * a joke keyed to UTC would land at breakfast for some and never for others.
 * @param now - The moment to judge, defaulting to the current one
 */
export function isJokeDay(now: Date = new Date()): boolean {
  return now.getMonth() === 8 && now.getDate() === 10;
}

/**
 * Whether to show the arts: the day itself, or `?j=1` on any day.
 * @param param - The `j` search param, as SolidRouter hands it over
 * @param now - The moment to judge, defaulting to the current one
 */
export function isJokeMode(param: string | string[] | undefined, now: Date = new Date()): boolean {
  return param === '1' || isJokeDay(now);
}
