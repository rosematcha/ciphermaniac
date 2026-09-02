/**
 * Per-card finish rate for a window of online tournaments — the artifact
 * production publishes as `cardSuccess.json` alongside `master.json`.
 *
 * Schema:
 *   `{ tag, minPlayers, deckTotal, successTotal, cards: { "<UID>": { decks, success } } }`
 *
 * Why it exists: play rate says how many people sleeved a card, never whether
 * it won them anything. The Social Graphics "Fraudulent" view needs the second
 * half of that — a card can be everywhere on ladder and still be a trap — and
 * the only finish data for the online window lives in a 36 MB `decks.json` no
 * browser should download. This reduces it to ~50 KB.
 *
 * Semantics:
 * - Success is a tag from the frozen {@link SUCCESS_TAG_POLICY}, not a raw
 *   placement. Online fields run from four players to a few hundred, so "top 8"
 *   means nothing across them; a percent rule normalizes by field size.
 * - A deck is ELIGIBLE only when its field was large enough for the tag to be
 *   earnable at all. Counting a 6-player event's decks as failures against a
 *   tag they could never earn would read as the format punishing whatever they
 *   played.
 * - A canonical card is counted once per deck, matching the conversion index:
 *   a deck listing two printings that collapse to one UID counts once.
 * - Only cards with a canonicalizable set AND number are counted; bare-name
 *   cards (basic energy) are skipped, as in `conversion.ts`.
 *
 * IMPORTANT: This module is isomorphic — it works in both browser and
 * Node.js/Workers. Do not add any environment-specific dependencies here.
 * @module shared/data/reports/cardSuccess
 */

import { cardUid, getCanonicalCardFromData, type SynonymDatabase } from '../cardIdentity';
import { SUCCESS_TAG_POLICY } from '../contracts';
import type { CanonicalizeOptions } from './cardReport';

/** A single deck card row consumed by {@link buildCardSuccessIndex}. */
export interface SuccessDeckCard {
  name?: string;
  set?: string | null;
  number?: string | number | null;
}

/** A single deck consumed by {@link buildCardSuccessIndex}. */
export interface SuccessDeck {
  /** Success tags the producer already computed for this finish. */
  successTags?: readonly string[] | null;
  /** Players in the tournament this deck was played at. */
  tournamentPlayers?: number | null;
  cards?: readonly SuccessDeckCard[] | null;
}

/** Eligible-deck / successful-deck counts for one card. */
export interface SuccessCounts {
  /** Eligible decks that ran the card. */
  decks: number;
  /** Of those, how many earned the success tag. */
  success: number;
}

/** The `cardSuccess.json` payload. */
export interface CardSuccessIndex {
  /** The success tag counted, so a reader never has to assume which. */
  tag: string;
  /** Field size at which that tag becomes earnable. */
  minPlayers: number;
  /** Eligible decks across the window. */
  deckTotal: number;
  /** Of those, how many earned the tag — the field rate a card is read against. */
  successTotal: number;
  /** Canonical UID to its counts, in first-seen order. */
  cards: Record<string, SuccessCounts>;
}

/**
 * Which tag counts as success, and the field size it needs.
 *
 * `top25` is the most robust rule the policy offers for online play: it is a
 * percent rule, so it scales with the field instead of assuming a top 8 exists,
 * and its 12-player floor keeps four-player pods out of the denominator.
 */
export const SUCCESS_TAG = 'top25';

/** The policy's floor for {@link SUCCESS_TAG}, read rather than restated. */
export function successMinPlayers(tag: string = SUCCESS_TAG): number {
  const percentRule = SUCCESS_TAG_POLICY.percentRules.find(rule => rule.tag === tag);
  if (percentRule) {
    return percentRule.minPlayers;
  }
  const placementRule = SUCCESS_TAG_POLICY.placementRules.find(rule => rule.tag === tag);
  return placementRule ? placementRule.minPlayers : 0;
}

/**
 * Build the per-card finish index for a window of online tournaments.
 * @param decks - Every gathered deck in the window
 * @param synonymDb - Synonym database for canonical UID resolution (or null)
 * @param options - Canonicalization overrides
 * @param tag - Success tag to count (defaults to {@link SUCCESS_TAG})
 * @returns The index, or `null` when no deck was eligible
 */
export function buildCardSuccessIndex(
  decks: readonly SuccessDeck[] | null | undefined,
  synonymDb: SynonymDatabase | null = null,
  options: CanonicalizeOptions = {},
  tag: string = SUCCESS_TAG
): CardSuccessIndex | null {
  if (!decks || decks.length === 0) {
    return null;
  }
  const resolveUid = options.resolveUid ?? null;
  const minPlayers = successMinPlayers(tag);
  const cards: Record<string, SuccessCounts> = {};
  let deckTotal = 0;
  let successTotal = 0;

  for (const deck of decks) {
    const players = deck?.tournamentPlayers;
    if (typeof players !== 'number' || players < minPlayers) {
      continue;
    }
    deckTotal += 1;
    const succeeded = Boolean(deck?.successTags?.includes(tag));
    if (succeeded) {
      successTotal += 1;
    }
    const seen = new Set<string>();
    for (const card of deck?.cards ?? []) {
      const uid = canonicalUid(card, synonymDb, resolveUid);
      if (!uid || seen.has(uid)) {
        continue;
      }
      seen.add(uid);
      const entry = (cards[uid] ??= { decks: 0, success: 0 });
      entry.decks += 1;
      if (succeeded) {
        entry.success += 1;
      }
    }
  }

  return deckTotal > 0 ? { tag, minPlayers, deckTotal, successTotal, cards } : null;
}

/** One card row's canonical UID, or null when it cannot be keyed. */
function canonicalUid(
  card: SuccessDeckCard | null | undefined,
  synonymDb: SynonymDatabase | null,
  resolveUid: ((uid: string) => string) | null
): string | null {
  const setCode = card?.set;
  const number = card?.number;
  if (!setCode || number === null || number === undefined || number === '') {
    return null;
  }
  const rawUid = cardUid(card?.name ?? '', setCode, number);
  if (!rawUid) {
    return null;
  }
  return resolveUid ? resolveUid(rawUid) : getCanonicalCardFromData(synonymDb, rawUid);
}
