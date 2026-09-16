/**
 * Expected value of one booster pack, from the slot model plus market prices.
 *
 * The model is deliberately shallow: each slot resolves to exactly one outcome
 * with a published probability, and each outcome draws a uniform card from a
 * pool. That is what TCGplayer's pull-rate data actually measures (a rate per
 * slot per pack), and it keeps the same code honest for both halves of the
 * tool — the EV table averages the outcomes, the simulator samples them.
 *
 * Every price is floored at a bulk rate: a card that sells for a dime is not
 * worth a dime to you, it is worth whatever a buylist pays for a box of them.
 * @module shared/packEv/ev
 */

import type {
  BulkRates,
  CardContribution,
  OutcomeEv,
  PackCard,
  PackEv,
  PackSlot,
  PoolSpec,
  Printing,
  SlotEv,
  SlotOutcome
} from './types';

/** The fields EV needs. Takes a whole payload, or a hand-built fixture. */
export interface EvInputs {
  cards: PackCard[];
  slots: PackSlot[];
  bulk: BulkRates;
  threshold: number;
}

/**
 * What one card is worth to a seller.
 *
 * Market only counts once it clears the threshold. Below it, and for any
 * product TCGplayer has no market price for, the card is bulk — the buylist
 * rate for its class.
 */
export function cardValue(card: PackCard, printing: Printing, bulkRate: number, threshold: number): number {
  const price = card.prices[printing];
  if (typeof price !== 'number' || price <= threshold) {
    return bulkRate;
  }
  return price;
}

/** Cards an outcome can draw. `pattern` defaults to the base print. */
export function selectPool(cards: PackCard[], spec: PoolSpec): PackCard[] {
  const wanted = spec.pattern ?? 'base';
  const rarities = new Set(spec.rarities);
  return cards.filter(card => {
    if (!rarities.has(card.rarity)) {
      return false;
    }
    return (card.pattern ?? 'base') === wanted;
  });
}

/**
 * Probability of each outcome in a slot, in order.
 *
 * One outcome per slot leaves `chance` unset and absorbs whatever the named
 * rates don't claim. Config is hand-maintained from published pull rates, so
 * over-claiming is a config bug and throws rather than silently renormalizing:
 * a slot that sums past 1 would quietly inflate every EV downstream.
 */
export function resolveChances(outcomes: SlotOutcome[]): number[] {
  const named = outcomes.reduce((sum, outcome) => sum + (outcome.chance ?? 0), 0);
  if (named > 1 + Number.EPSILON) {
    throw new Error(`Slot outcome chances sum to ${named}, which is over 1`);
  }
  // Two unnamed outcomes would each take the whole remainder, so the slot would
  // resolve to more than one card and every number built on it would be wrong.
  if (outcomes.filter(outcome => outcome.chance === undefined).length > 1) {
    throw new Error('A slot may leave at most one outcome without a chance');
  }
  const remainder = Math.max(0, 1 - named);
  return outcomes.map(outcome => outcome.chance ?? remainder);
}

/** Mean value of a draw from an outcome, and the pool it drew from. */
function outcomeAverage(outcome: SlotOutcome, inputs: EvInputs): { poolSize: number; averageValue: number } {
  if (outcome.flat) {
    return { poolSize: 0, averageValue: inputs.bulk[outcome.flat] };
  }
  if (!outcome.pool) {
    return { poolSize: 0, averageValue: 0 };
  }
  const pool = selectPool(inputs.cards, outcome.pool);
  if (pool.length === 0) {
    return { poolSize: 0, averageValue: 0 };
  }
  const bulkRate = inputs.bulk[outcome.pool.bulk];
  const { printing } = outcome.pool;
  const total = pool.reduce((sum, card) => sum + cardValue(card, printing, bulkRate, inputs.threshold), 0);
  return { poolSize: pool.length, averageValue: total / pool.length };
}

function slotEv(slot: PackSlot, inputs: EvInputs): SlotEv {
  const count = slot.count ?? 1;
  const chances = resolveChances(slot.outcomes);
  const outcomes: OutcomeEv[] = slot.outcomes.map((outcome, index) => {
    const chance = chances[index];
    const { poolSize, averageValue } = outcomeAverage(outcome, inputs);
    return {
      label: outcome.label,
      chance,
      poolSize,
      averageValue,
      contribution: chance * averageValue * count
    };
  });
  return {
    label: slot.label,
    count,
    outcomes,
    contribution: outcomes.reduce((sum, outcome) => sum + outcome.contribution, 0)
  };
}

/** Expected dollar value of a pack's contents, slot by slot. */
export function computePackEv(inputs: EvInputs): PackEv {
  const slots = inputs.slots.map(slot => slotEv(slot, inputs));
  return {
    perPack: slots.reduce((sum, slot) => sum + slot.contribution, 0),
    slots
  };
}

/** One contribution row per card an outcome can draw that is worth more than bulk. */
function outcomeCardRows(outcome: SlotOutcome, chance: number, inputs: EvInputs): CardContribution[] {
  if (!outcome.pool) {
    return [];
  }
  const pool = selectPool(inputs.cards, outcome.pool);
  const bulkRate = inputs.bulk[outcome.pool.bulk];
  const { printing } = outcome.pool;
  const perCard = chance / pool.length;
  return pool
    .map(card => ({ card, printing, value: cardValue(card, printing, bulkRate, inputs.threshold) }))
    .filter(row => row.value > bulkRate)
    .map(row => ({ ...row, chance: perCard, contribution: perCard * row.value }));
}

/**
 * Per-card share of pack EV, biggest first.
 *
 * A card's chance is its outcome's rate spread evenly over the pool and
 * multiplied by the slot count. For multi-card slots that slightly overstates
 * the chance of *at least one* copy (the draws aren't independent), but it is
 * exactly right as an expected count, which is what the contribution column
 * needs. Bulk-floored cards are skipped: five hundred rows worth $0.035 each
 * are the point of the bulk line, not of this list.
 *
 * The same print can come from more than one slot — every set draws both
 * reverse holo slots from one pool — so rows merge on card and printing.
 * Listed per slot, a valuable reverse would take two places at half its worth.
 */
export function topCardContributions(inputs: EvInputs, limit: number): CardContribution[] {
  const merged = new Map<string, CardContribution>();
  for (const slot of inputs.slots) {
    const count = slot.count ?? 1;
    const chances = resolveChances(slot.outcomes);
    slot.outcomes.forEach((outcome, index) => {
      for (const row of outcomeCardRows(outcome, chances[index] * count, inputs)) {
        const key = `${row.card.id}:${row.printing}`;
        const existing = merged.get(key);
        merged.set(
          key,
          existing
            ? {
                ...existing,
                chance: existing.chance + row.chance,
                contribution: existing.contribution + row.contribution
              }
            : row
        );
      }
    });
  }
  return [...merged.values()].sort((a, b) => b.contribution - a.contribution).slice(0, limit);
}
