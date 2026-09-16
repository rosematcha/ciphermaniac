/**
 * Pack opening, sampled from the same slot model the EV table averages.
 *
 * EV is one number and the median rip is nothing like it: a set's value piles
 * up in a handful of cards you will almost certainly not see in 36 packs. So
 * the tool opens packs as well as averaging them, and reports the spread
 * (median, 10th/90th percentile, how often a box beats its own price) from a
 * Monte Carlo run over this code.
 *
 * Everything is driven off a prepared model so the hot loop does no filtering:
 * pools, per-card values and special packs are resolved once, then a run is two
 * random numbers per slot (plus one per pack in a set that has special packs).
 * @module shared/packEv/simulate
 */

import { cardValue, type EvInputs, refTerms, resolveChances, resolveRef, selectPool } from './ev';
import type { CardRef, PackCard, PackSlot, PoolSpec, Printing, SpecialDraw } from './types';

/** One card out of one pack. `card` is null for the basic energy slot. */
export interface Pull {
  slot: string;
  outcome: string;
  card: PackCard | null;
  printing: Printing | null;
  value: number;
  /** True when the card cleared the value threshold, i.e. it isn't bulk. */
  notable: boolean;
}

type Rng = () => number;

/** A pool with its per-card values resolved, ready to draw from. */
interface PreparedPool {
  pool: PackCard[];
  values: number[];
  printing: Printing | null;
  bulkRate: number;
}

interface PreparedOutcome extends PreparedPool {
  label: string;
  /** Running probability, so a draw is one comparison walk. */
  cumulative: number;
  flatValue: number;
}

interface PreparedSlot {
  label: string;
  count: number;
  outcomes: PreparedOutcome[];
}

interface PreparedSpecial {
  cumulative: number;
  kept: PreparedSlot[];
  draw: (rng: Rng) => Pull[];
}

export interface PreparedPack {
  slots: PreparedSlot[];
  specials: PreparedSpecial[];
}

function preparePool(spec: PoolSpec, inputs: EvInputs): PreparedPool {
  const pool = selectPool(inputs.cards, spec);
  const bulkRate = inputs.bulk[spec.bulk];
  const values = pool.map(card => cardValue(card, spec.printing, bulkRate, inputs.threshold));
  return { pool, values, printing: spec.printing, bulkRate };
}

function prepareSlot(slot: PackSlot, inputs: EvInputs): PreparedSlot {
  const chances = resolveChances(slot.outcomes);
  let running = 0;
  const outcomes = slot.outcomes.map((outcome, index) => {
    running += chances[index];
    const flatRate = inputs.bulk[outcome.flat ?? 'commonUncommon'];
    const prepared = outcome.pool
      ? preparePool(outcome.pool, inputs)
      : { pool: [], values: [], printing: null, bulkRate: flatRate };
    return { ...prepared, label: outcome.label, cumulative: running, flatValue: outcome.flat ? flatRate : 0 };
  });
  return { label: slot.label, count: slot.count ?? 1, outcomes };
}

function drawFromPool(pool: PreparedPool, rng: Rng): { card: PackCard; value: number; notable: boolean } {
  const index = Math.min(pool.pool.length - 1, Math.floor(rng() * pool.pool.length));
  const value = pool.values[index];
  return { card: pool.pool[index], value, notable: value > pool.bulkRate };
}

/** A named card as a pull; a reference the set doesn't carry pulls as bulk. */
function refPull(ref: CardRef, label: string, inputs: EvInputs): Pull {
  const card = resolveRef(inputs.cards, ref) ?? null;
  const { printing, bulk } = refTerms(ref.rarity);
  const bulkRate = inputs.bulk[bulk];
  const value = card ? cardValue(card, printing, bulkRate, inputs.threshold) : bulkRate;
  return { slot: label, outcome: ref.rarity, card, printing, value, notable: value > bulkRate };
}

function prepareDraw(draw: SpecialDraw, label: string, inputs: EvInputs): (rng: Rng) => Pull[] {
  if (draw.kind === 'cards') {
    const pulls = draw.cards.map(ref => refPull(ref, label, inputs));
    return () => [...pulls];
  }
  if (draw.kind === 'oneOf') {
    const groups = draw.groups.map(group => group.map(ref => refPull(ref, label, inputs)));
    return rng => [...groups[Math.min(groups.length - 1, Math.floor(rng() * groups.length))]];
  }
  const pool = preparePool(draw.pool, inputs);
  const outcome = draw.pool.rarities.join(' / ');
  return rng =>
    Array.from({ length: draw.count }, () => ({
      slot: label,
      outcome,
      printing: pool.printing,
      ...drawFromPool(pool, rng)
    }));
}

/** Resolve pools, per-card values and special packs once, for repeated openings. */
export function preparePack(inputs: EvInputs): PreparedPack {
  const slots = inputs.slots.map(slot => prepareSlot(slot, inputs));
  let running = 0;
  const specials = (inputs.specialPacks ?? []).map(special => {
    running += 1 / special.odds;
    const kept = new Set(special.keepSlots);
    const draws = special.draws.map(draw => prepareDraw(draw, special.label, inputs));
    return {
      cumulative: running,
      kept: slots.filter(slot => kept.has(slot.label)),
      draw: (rng: Rng) => draws.flatMap(drawOne => drawOne(rng))
    };
  });
  return { slots, specials };
}

function pickOutcome(slot: PreparedSlot, roll: number): PreparedOutcome {
  for (const outcome of slot.outcomes) {
    if (roll < outcome.cumulative) {
      return outcome;
    }
  }
  return slot.outcomes[slot.outcomes.length - 1];
}

function drawSlot(slot: PreparedSlot, rng: Rng): Pull {
  const outcome = pickOutcome(slot, rng());
  if (outcome.pool.length === 0) {
    return {
      slot: slot.label,
      outcome: outcome.label,
      card: null,
      printing: null,
      value: outcome.flatValue,
      notable: false
    };
  }
  return { slot: slot.label, outcome: outcome.label, printing: outcome.printing, ...drawFromPool(outcome, rng) };
}

function drawSlots(slots: PreparedSlot[], rng: Rng): Pull[] {
  const pulls: Pull[] = [];
  for (const slot of slots) {
    for (let drawn = 0; drawn < slot.count; drawn += 1) {
      pulls.push(drawSlot(slot, rng));
    }
  }
  return pulls;
}

/**
 * Which special pack this is, if any. Only sets with special packs spend a
 * roll on it, so an ordinary set's openings consume exactly one roll per
 * outcome and one per card.
 */
function pickSpecial(pack: PreparedPack, rng: Rng): PreparedSpecial | null {
  if (pack.specials.length === 0) {
    return null;
  }
  const roll = rng();
  return pack.specials.find(special => roll < special.cumulative) ?? null;
}

/** One pack, card by card. */
export function openPack(pack: PreparedPack, rng: Rng): Pull[] {
  const special = pickSpecial(pack, rng);
  if (special) {
    return [...drawSlots(special.kept, rng), ...special.draw(rng)];
  }
  return drawSlots(pack.slots, rng);
}

/** Total value of `packs` packs. */
export function openPacksValue(pack: PreparedPack, packs: number, rng: Rng): number {
  let total = 0;
  for (let opened = 0; opened < packs; opened += 1) {
    for (const pull of openPack(pack, rng)) {
      total += pull.value;
    }
  }
  return total;
}

export interface OpeningSpread {
  runs: number;
  packs: number;
  mean: number;
  median: number;
  /** 10th and 90th percentile of total value across runs. */
  low: number;
  high: number;
  /** Share of runs whose contents beat `cost`, 0..1. Null when cost is unknown. */
  beatsCost: number | null;
}

function percentile(sorted: number[], fraction: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))));
  return sorted[index];
}

/**
 * Open `packs` packs `runs` times and describe the spread of outcomes.
 *
 * Runs are independent draws with replacement — a real box is sampled without
 * replacement from a print run, but the print run is millions of packs deep, so
 * the difference is far smaller than the pull rates' own error bars.
 */
export function simulateSpread(
  pack: PreparedPack,
  options: { packs: number; runs: number; cost: number | null },
  rng: Rng
): OpeningSpread {
  const totals: number[] = [];
  for (let run = 0; run < options.runs; run += 1) {
    totals.push(openPacksValue(pack, options.packs, rng));
  }
  totals.sort((a, b) => a - b);
  const mean = totals.reduce((sum, value) => sum + value, 0) / totals.length;
  const { cost } = options;
  return {
    runs: options.runs,
    packs: options.packs,
    mean,
    median: percentile(totals, 0.5),
    low: percentile(totals, 0.1),
    high: percentile(totals, 0.9),
    beatsCost: cost === null ? null : totals.filter(total => total > cost).length / totals.length
  };
}
