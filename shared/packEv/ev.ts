/**
 * Expected value of one booster pack, from the slot model plus market prices.
 *
 * The model is deliberately shallow: each slot resolves to exactly one outcome
 * with a published probability, and each outcome draws a uniform card from a
 * pool. That is what TCGplayer's pull-rate data actually measures (a rate per
 * slot per pack), and it keeps the same code honest for both halves of the
 * tool — the EV table averages the outcomes, the simulator samples them.
 *
 * On top of the slots sit special packs (god and demigod packs): at their own
 * rate a pack keeps some slots and replaces the rest with fixed or drawn hits.
 *
 * Every price is floored at a bulk rate: a card that sells for a dime is not
 * worth a dime to you, it is worth whatever a buylist pays for a box of them.
 * @module shared/packEv/ev
 */

import type {
  BulkClass,
  BulkRates,
  CardContribution,
  CardRef,
  OutcomeEv,
  PackCard,
  PackEv,
  PackSlot,
  PoolSpec,
  Printing,
  SlotEv,
  SlotOutcome,
  SpecialDraw,
  SpecialPack
} from './types';

/** The fields EV needs. Takes a whole payload, or a hand-built fixture. */
export interface EvInputs {
  cards: PackCard[];
  slots: PackSlot[];
  specialPacks?: SpecialPack[];
  bulk: BulkRates;
  threshold: number;
}

/** Label of the synthetic slot special packs are reported under. */
export const SPECIAL_PACKS_LABEL = 'Special packs';

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

/**
 * What a card drawn from a pool is worth: `cardValue` at the pool's printing
 * and bulk class, except that a card with no market price yet counts at the
 * pool's stand-in when it names one.
 */
export function poolCardValue(card: PackCard, spec: PoolSpec, inputs: EvInputs): number {
  if (spec.unpriced !== undefined && typeof card.prices[spec.printing] !== 'number') {
    return spec.unpriced;
  }
  return cardValue(card, spec.printing, inputs.bulk[spec.bulk], inputs.threshold);
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

/** An outcome's named rate, from `chance` or from "1 in `odds`". */
function namedChance(outcome: { chance?: number; odds?: number }): number | undefined {
  if (outcome.chance !== undefined) {
    return outcome.chance;
  }
  return outcome.odds ? 1 / outcome.odds : undefined;
}

/**
 * Probability of each outcome in a slot, in order.
 *
 * One outcome per slot names no rate and absorbs whatever the named rates
 * don't claim. Config is hand-maintained from published pull rates, so
 * over-claiming is a config bug and throws rather than silently renormalizing:
 * a slot that sums past 1 would quietly inflate every EV downstream.
 */
export function resolveChances(outcomes: SlotOutcome[]): number[] {
  const named = outcomes.map(namedChance);
  const total = named.reduce<number>((sum, chance) => sum + (chance ?? 0), 0);
  if (total > 1 + Number.EPSILON) {
    throw new Error(`Slot outcome chances sum to ${total}, which is over 1`);
  }
  // Two unnamed outcomes would each take the whole remainder, so the slot would
  // resolve to more than one card and every number built on it would be wrong.
  if (named.filter(chance => chance === undefined).length > 1) {
    throw new Error('A slot may leave at most one outcome without a chance');
  }
  const remainder = Math.max(0, 1 - total);
  return named.map(chance => chance ?? remainder);
}

/** Mean value of a uniform draw from a pool, and the pool's size. */
function poolAverage(spec: PoolSpec, inputs: EvInputs): { poolSize: number; averageValue: number } {
  const pool = selectPool(inputs.cards, spec);
  if (pool.length === 0) {
    return { poolSize: 0, averageValue: 0 };
  }
  const total = pool.reduce((sum, card) => sum + poolCardValue(card, spec, inputs), 0);
  return { poolSize: pool.length, averageValue: total / pool.length };
}

function outcomeAverage(outcome: SlotOutcome, inputs: EvInputs): { poolSize: number; averageValue: number } {
  if (outcome.flat) {
    return { poolSize: 0, averageValue: inputs.bulk[outcome.flat] };
  }
  return outcome.pool ? poolAverage(outcome.pool, inputs) : { poolSize: 0, averageValue: 0 };
}

function slotEv(slot: PackSlot, inputs: EvInputs): SlotEv {
  const count = slot.count ?? 1;
  const chances = resolveChances(slot.outcomes);
  const outcomes: OutcomeEv[] = slot.outcomes.map((outcome, index) => {
    const chance = chances[index];
    const { poolSize, averageValue } = outcomeAverage(outcome, inputs);
    return { label: outcome.label, chance, poolSize, averageValue, contribution: chance * averageValue * count };
  });
  return {
    label: slot.label,
    count,
    outcomes,
    contribution: outcomes.reduce((sum, outcome) => sum + outcome.contribution, 0)
  };
}

const COMMON_RARITIES = new Set(['Common', 'Uncommon']);

/** How a named card in a special pack is printed and floored: by its rarity. */
export function refTerms(rarity: string): { printing: Printing; bulk: BulkClass } {
  if (COMMON_RARITIES.has(rarity)) {
    return { printing: 'normal', bulk: 'commonUncommon' };
  }
  if (rarity === 'Rare') {
    return { printing: 'holofoil', bulk: 'rare' };
  }
  return { printing: 'holofoil', bulk: rarity === 'Double Rare' ? 'doubleRare' : 'hit' };
}

/** The base print a reference names, or undefined when the set has none. */
export function resolveRef(cards: PackCard[], ref: CardRef): PackCard | undefined {
  return cards.find(card => !card.pattern && card.name === ref.name && card.rarity === ref.rarity);
}

function refValue(ref: CardRef, inputs: EvInputs): number {
  const card = resolveRef(inputs.cards, ref);
  const { printing, bulk } = refTerms(ref.rarity);
  return card ? cardValue(card, printing, inputs.bulk[bulk], inputs.threshold) : inputs.bulk[bulk];
}

function refsValue(refs: CardRef[], inputs: EvInputs): number {
  return refs.reduce((sum, ref) => sum + refValue(ref, inputs), 0);
}

/** Expected value of one special-pack draw. */
function drawValue(draw: SpecialDraw, inputs: EvInputs): number {
  if (draw.kind === 'cards') {
    return refsValue(draw.cards, inputs);
  }
  if (draw.kind === 'oneOf') {
    const total = draw.groups.reduce((sum, group) => sum + refsValue(group, inputs), 0);
    return draw.groups.length ? total / draw.groups.length : 0;
  }
  return draw.count * poolAverage(draw.pool, inputs).averageValue;
}

/** Expected value of a special pack: its kept slots plus its draws. */
function specialValue(special: SpecialPack, slots: SlotEv[], inputs: EvInputs): number {
  const kept = new Set(special.keepSlots);
  const keptValue = slots.filter(slot => kept.has(slot.label)).reduce((sum, slot) => sum + slot.contribution, 0);
  return keptValue + special.draws.reduce((sum, draw) => sum + drawValue(draw, inputs), 0);
}

/**
 * Expected value of a pack's contents, slot by slot.
 *
 * Special packs are reported as one more slot whose outcomes carry their
 * marginal worth: `chance × (special pack − ordinary pack)`. The ordinary slots
 * keep their full contributions, so the table still sums to the pack's EV
 * without scaling every row by a rate of one in a thousand.
 */
export function computePackEv(inputs: EvInputs): PackEv {
  const slots = inputs.slots.map(slot => slotEv(slot, inputs));
  const ordinary = slots.reduce((sum, slot) => sum + slot.contribution, 0);
  const specials = inputs.specialPacks ?? [];
  if (specials.length === 0) {
    return { perPack: ordinary, slots };
  }
  const outcomes: OutcomeEv[] = specials.map(special => {
    const chance = 1 / special.odds;
    const averageValue = specialValue(special, slots, inputs);
    return {
      label: special.label,
      chance,
      poolSize: 0,
      averageValue,
      contribution: chance * (averageValue - ordinary)
    };
  });
  const extra = outcomes.reduce((sum, outcome) => sum + outcome.contribution, 0);
  slots.push({ label: SPECIAL_PACKS_LABEL, count: 1, outcomes, contribution: extra });
  return { perPack: ordinary + extra, slots };
}

/** One contribution row per pool card worth more than bulk, at `chance` for the whole pool. */
function poolCardRows(spec: PoolSpec, chance: number, inputs: EvInputs): CardContribution[] {
  const pool = selectPool(inputs.cards, spec);
  const bulkRate = inputs.bulk[spec.bulk];
  const { printing } = spec;
  const perCard = chance / pool.length;
  return pool
    .map(card => ({ card, printing, value: poolCardValue(card, spec, inputs) }))
    .filter(row => row.value > bulkRate)
    .map(row => ({ ...row, chance: perCard, contribution: perCard * row.value }));
}

/** Rows for named cards, each at `chance`. */
function refRows(refs: CardRef[], chance: number, inputs: EvInputs): CardContribution[] {
  return refs.flatMap(ref => {
    const card = resolveRef(inputs.cards, ref);
    const { printing, bulk } = refTerms(ref.rarity);
    const value = card ? cardValue(card, printing, inputs.bulk[bulk], inputs.threshold) : 0;
    return card && value > inputs.bulk[bulk] ? [{ card, printing, chance, value, contribution: chance * value }] : [];
  });
}

function specialRows(special: SpecialPack, inputs: EvInputs): CardContribution[] {
  const chance = 1 / special.odds;
  return special.draws.flatMap(draw => {
    if (draw.kind === 'cards') {
      return refRows(draw.cards, chance, inputs);
    }
    if (draw.kind === 'oneOf') {
      return draw.groups.flatMap(group => refRows(group, chance / draw.groups.length, inputs));
    }
    return poolCardRows(draw.pool, chance * draw.count, inputs);
  });
}

function slotRows(slot: PackSlot, inputs: EvInputs): CardContribution[] {
  const count = slot.count ?? 1;
  const chances = resolveChances(slot.outcomes);
  return slot.outcomes.flatMap((outcome, index) =>
    outcome.pool ? poolCardRows(outcome.pool, chances[index] * count, inputs) : []
  );
}

/**
 * Per-card share of pack EV, biggest first.
 *
 * A card's chance is its outcome's rate spread evenly over the pool and
 * multiplied by the slot count. For multi-card slots that slightly overstates
 * the chance of *at least one* copy (the draws aren't independent), but it is
 * exactly right as an expected count, which is what the contribution column
 * needs. Bulk-floored cards are skipped: five hundred rows worth $0.035 each
 * are the point of the bulk line, not of this list. Special packs add their
 * cards at the special pack's rate; the ordinary draws a special pack displaces
 * are one in a thousand of each row and are not subtracted.
 *
 * The same print can come from more than one place — both reverse holo slots
 * draw one pool, and a god pack repeats SIRs the SIR outcome already lists —
 * so rows merge on card and printing.
 */
export function topCardContributions(inputs: EvInputs, limit: number): CardContribution[] {
  const rows = [
    ...inputs.slots.flatMap(slot => slotRows(slot, inputs)),
    ...(inputs.specialPacks ?? []).flatMap(special => specialRows(special, inputs))
  ];
  const merged = new Map<string, CardContribution>();
  for (const row of rows) {
    const key = `${row.card.id}:${row.printing}`;
    const existing = merged.get(key);
    merged.set(
      key,
      existing
        ? { ...existing, chance: existing.chance + row.chance, contribution: existing.contribution + row.contribution }
        : row
    );
  }
  return [...merged.values()].sort((a, b) => b.contribution - a.contribution).slice(0, limit);
}
