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
 * pools and their per-card values are resolved once, then a run is two random
 * numbers per slot.
 * @module shared/packEv/simulate
 */

import { cardValue, type EvInputs, resolveChances, selectPool } from './ev';
import type { PackCard, Printing } from './types';

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

interface PreparedOutcome {
  label: string;
  /** Running probability, so a draw is one comparison walk. */
  cumulative: number;
  pool: PackCard[];
  values: number[];
  printing: Printing | null;
  flatValue: number;
  bulkRate: number;
}

interface PreparedSlot {
  label: string;
  count: number;
  outcomes: PreparedOutcome[];
}

export interface PreparedPack {
  slots: PreparedSlot[];
}

function prepareOutcomes(slotOutcomes: EvInputs['slots'][number]['outcomes'], inputs: EvInputs): PreparedOutcome[] {
  const chances = resolveChances(slotOutcomes);
  let running = 0;
  return slotOutcomes.map((outcome, index) => {
    running += chances[index];
    const pool = outcome.pool ? selectPool(inputs.cards, outcome.pool) : [];
    const bulkRate = outcome.pool ? inputs.bulk[outcome.pool.bulk] : inputs.bulk[outcome.flat ?? 'commonUncommon'];
    const printing = outcome.pool?.printing ?? null;
    return {
      label: outcome.label,
      cumulative: running,
      pool,
      values: printing ? pool.map(card => cardValue(card, printing, bulkRate, inputs.threshold)) : [],
      printing,
      flatValue: outcome.flat ? inputs.bulk[outcome.flat] : 0,
      bulkRate
    };
  });
}

/** Resolve pools and per-card values once, for repeated openings. */
export function preparePack(inputs: EvInputs): PreparedPack {
  return {
    slots: inputs.slots.map(slot => ({
      label: slot.label,
      count: slot.count ?? 1,
      outcomes: prepareOutcomes(slot.outcomes, inputs)
    }))
  };
}

function pickOutcome(slot: PreparedSlot, roll: number): PreparedOutcome {
  for (const outcome of slot.outcomes) {
    if (roll < outcome.cumulative) {
      return outcome;
    }
  }
  return slot.outcomes[slot.outcomes.length - 1];
}

/** One pack, card by card. */
export function openPack(pack: PreparedPack, rng: () => number): Pull[] {
  const pulls: Pull[] = [];
  for (const slot of pack.slots) {
    for (let drawn = 0; drawn < slot.count; drawn += 1) {
      const outcome = pickOutcome(slot, rng());
      if (outcome.pool.length === 0) {
        pulls.push({
          slot: slot.label,
          outcome: outcome.label,
          card: null,
          printing: null,
          value: outcome.flatValue,
          notable: false
        });
        continue;
      }
      const index = Math.min(outcome.pool.length - 1, Math.floor(rng() * outcome.pool.length));
      const value = outcome.values[index];
      pulls.push({
        slot: slot.label,
        outcome: outcome.label,
        card: outcome.pool[index],
        printing: outcome.printing,
        value,
        notable: value > outcome.bulkRate
      });
    }
  }
  return pulls;
}

/** Total value of `packs` packs, without building a card list for any of them. */
export function openPacksValue(pack: PreparedPack, packs: number, rng: () => number): number {
  let total = 0;
  for (let opened = 0; opened < packs; opened += 1) {
    for (const slot of pack.slots) {
      for (let drawn = 0; drawn < slot.count; drawn += 1) {
        const outcome = pickOutcome(slot, rng());
        total +=
          outcome.pool.length === 0
            ? outcome.flatValue
            : outcome.values[Math.min(outcome.pool.length - 1, Math.floor(rng() * outcome.pool.length))];
      }
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
  rng: () => number
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
