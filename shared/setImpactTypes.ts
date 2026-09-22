/**
 * How much each set has shaped the game, measured across every major.
 *
 * `scripts/build-set-impact.ts` writes this shape to `static/set-impact.json`
 * and the /tools/set-impact page reads it. The type lives here so producer and
 * consumer can't drift.
 * @module shared/setImpactTypes
 */

/**
 * Which set a card's play is credited to.
 *
 * - `legal`: the oldest set with a legal printing at the event, so a staple is
 *   credited to whichever set is keeping it in Standard.
 * - `new`: the same, but only when that printing brought the card into
 *   Standard. A reprint of a card that was already legal credits nobody.
 */
export type SetImpactAttribution = 'legal' | 'new';

/**
 * - `linear`: every deck counts once.
 * - `weighted`: each deck counts ln(field / placement), which averages to 1
 *   over a field, so a card that places like the field scores as it does in
 *   `linear`, and one that wins scores higher.
 */
export type SetImpactMetric = 'linear' | 'weighted';

export interface SetImpactRotation {
  /** Regulation mark removed by this rotation. */
  mark: string;
  /** Tournament date the mark stopped being legal (ISO). */
  date: string;
  /** True for rotations Pokemon hasn't announced yet. */
  predicted: boolean;
}

export interface SetImpactEvent {
  date: string;
  name: string;
  players: number;
}

export interface SetImpactCard {
  name: string;
  /** The printing that earned the credit. */
  set: string;
  number: string;
  /** False when this printing reprinted a card already in Standard. */
  isNew: boolean;
  /** Mean share of decks running the card, over the set's legal events. */
  linear: number;
  weighted: number;
}

export interface SetImpactSet {
  code: string;
  name: string;
  legalFrom: string;
  /** When the set leaves Standard, from its dominant regulation mark. */
  rotatesOn: string | null;
  rotationPredicted: boolean;
  /** Years from legalFrom to rotatesOn. Null when the rotation is unknown. */
  legalYears: number | null;
  /** Indexes into `events` of the majors held while the set was legal. */
  events: number[];
  /**
   * Per legal event, the summed share of decks running each credited card:
   * the number of distinct cards from this set in the average deck.
   */
  series: Record<SetImpactAttribution, Record<SetImpactMetric, number[]>>;
  /** Every card credited to the set at least once, most played first. */
  cards: SetImpactCard[];
}

export interface SetImpactPayload {
  generatedAt: string;
  rotations: SetImpactRotation[];
  /** Every major, oldest first. */
  events: SetImpactEvent[];
  /** Oldest first. */
  sets: SetImpactSet[];
}
