/**
 * Identity of cards that exist only in Japanese so far.
 *
 * City League lists carry cards from Japanese sets that have no English print
 * yet. They keep their Japanese set code and number, under a `JP-` prefix:
 * Japanese and English set codes collide (Limitless files the Eevee ex starter
 * set as `MEE`, the same code as Mega Evolution Energies), so a bare code would
 * merge two different cards. The prefix also lets any consumer, the browser
 * included, recognise one of these cards from its set code alone.
 *
 * The code after the prefix is uppercased like every other set code in our
 * data. Limitless spells a few Japanese codes with a lowercase suffix (`M6a`),
 * and its scans live under that spelling, so {@link limitlessJpSetCandidates}
 * recovers it.
 * @module shared/data/japanOnlyCards
 */

const PREFIX = 'JP-';

/** Our set code for a Japanese print: `M6` → `JP-M6`. */
export function japanOnlySetCode(jpSet: string): string {
  return `${PREFIX}${jpSet.trim().toUpperCase()}`;
}

/** Whether a set code names a Japanese-only print. */
export function isJapanOnlySet(set: string | null | undefined): boolean {
  return typeof set === 'string' && set.toUpperCase().startsWith(PREFIX);
}

/** The Japanese set code behind one of our codes: `JP-M6A` → `M6A`. */
export function japaneseSetOf(set: string): string {
  return set.slice(PREFIX.length).toUpperCase();
}

/**
 * Spellings of a Japanese set code to try on Limitless, as given first. A code
 * ending in a digit and one letter (`M6A`, `M2A`) is also tried with that
 * letter lowercased, which is how Limitless names those sets.
 */
export function limitlessJpSetCandidates(jpSet: string): string[] {
  const lowered = jpSet.replace(
    /(\d)([A-Z])$/,
    (_, digit: string, letter: string) => `${digit}${letter.toLowerCase()}`
  );
  return lowered === jpSet ? [jpSet] : [jpSet, lowered];
}

export type JpImageTier = 'XS' | 'SM' | 'LG';

/**
 * R2 key of our copy of a card's fan-translated image (from
 * pokemonproxies.com), one WebP per tier: `jp-card-images/M6/M6_062_SM.webp`.
 * Outside `card-images/`, whose pipeline prunes anything it did not convert.
 * @param jpSet - Japanese set code, without the `JP-` prefix
 * @param number - Collector number, padded or not
 * @param tier - Size tier
 */
export function jpCardImageKey(jpSet: string, number: string, tier: JpImageTier): string {
  const set = jpSet.toUpperCase();
  const digits = number.replace(/^0+(?=\d)/, '');
  return `jp-card-images/${set}/${set}_${digits.padStart(3, '0')}_${tier}.webp`;
}

/** Whether any of the cards is a Japanese-only print. */
export function hasJapanOnlyCard(cards: Iterable<{ set?: string | null }> | null | undefined): boolean {
  for (const card of cards ?? []) {
    if (isJapanOnlySet(card.set)) {
      return true;
    }
  }
  return false;
}
