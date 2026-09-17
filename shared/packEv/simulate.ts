/**
 * Pack opening, sampled from the same slot model the EV table averages.
 *
 * EV is one number and the median rip is nothing like it: a set's value piles
 * up in a handful of cards you will almost certainly not see in 36 packs. So
 * the tool opens packs as well as averaging them.
 *
 * Everything is driven off a prepared model so the hot loop does no filtering:
 * pools, per-card values and special packs are resolved once, then a run is two
 * random numbers per slot (plus one per pack in a set that has special packs).
 * @module shared/packEv/simulate
 */

import { cardValue, type EvInputs, poolCardValue, refTerms, resolveChances, resolveRef, selectPool } from './ev';
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

/** What a draw can produce, before a roll picks one. */
type Candidate = Pick<Pull, 'card' | 'value' | 'notable'>;

/** A card some pack can put among the hits, at the most any printing of it is worth. */
export interface PossibleHit {
  card: PackCard;
  value: number;
}

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

interface PreparedDraw {
  draw: (rng: Rng) => Pull[];
  /** Everything the draw can produce, so the hits a pack can hold are listable without opening any. */
  candidates: Candidate[];
}

interface PreparedSpecial extends PreparedDraw {
  cumulative: number;
  kept: PreparedSlot[];
}

export interface PreparedPack {
  slots: PreparedSlot[];
  specials: PreparedSpecial[];
}

function preparePool(spec: PoolSpec, inputs: EvInputs): PreparedPool {
  const pool = selectPool(inputs.cards, spec);
  const bulkRate = inputs.bulk[spec.bulk];
  const values = pool.map(card => poolCardValue(card, spec, inputs));
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

function poolCandidate(pool: PreparedPool, index: number): Candidate & { card: PackCard } {
  const value = pool.values[index];
  return { card: pool.pool[index], value, notable: value > pool.bulkRate };
}

function poolCandidates(pool: PreparedPool): Candidate[] {
  return pool.pool.map((_, index) => poolCandidate(pool, index));
}

function drawFromPool(pool: PreparedPool, rng: Rng): Candidate & { card: PackCard } {
  return poolCandidate(pool, Math.min(pool.pool.length - 1, Math.floor(rng() * pool.pool.length)));
}

/** A named card as a pull; a reference the set doesn't carry pulls as bulk. */
function refPull(ref: CardRef, label: string, inputs: EvInputs): Pull {
  const card = resolveRef(inputs.cards, ref) ?? null;
  const { printing, bulk } = refTerms(ref.rarity);
  const bulkRate = inputs.bulk[bulk];
  const value = card ? cardValue(card, printing, bulkRate, inputs.threshold) : bulkRate;
  return { slot: label, outcome: ref.rarity, card, printing, value, notable: value > bulkRate };
}

function prepareDraw(draw: SpecialDraw, label: string, inputs: EvInputs): PreparedDraw {
  if (draw.kind === 'cards') {
    const pulls = draw.cards.map(ref => refPull(ref, label, inputs));
    return { draw: () => [...pulls], candidates: pulls };
  }
  if (draw.kind === 'oneOf') {
    const groups = draw.groups.map(group => group.map(ref => refPull(ref, label, inputs)));
    return {
      draw: rng => [...groups[Math.min(groups.length - 1, Math.floor(rng() * groups.length))]],
      candidates: groups.flat()
    };
  }
  const pool = preparePool(draw.pool, inputs);
  const outcome = draw.pool.rarities.join(' / ');
  return {
    draw: rng =>
      Array.from({ length: draw.count }, () => ({
        slot: label,
        outcome,
        printing: pool.printing,
        ...drawFromPool(pool, rng)
      })),
    candidates: poolCandidates(pool)
  };
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
      draw: (rng: Rng) => draws.flatMap(prepared => prepared.draw(rng)),
      candidates: draws.flatMap(prepared => prepared.candidates)
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

/**
 * Every card any pack can put among the hits, once each: the opener warms
 * their art before a rip lands them. A card is its product, so its printings
 * collapse into one entry at the best of their values — they share the art.
 */
export function possibleHits(pack: PreparedPack): PossibleHit[] {
  const candidates = [
    ...pack.slots.flatMap(slot => slot.outcomes.flatMap(outcome => poolCandidates(outcome))),
    ...pack.specials.flatMap(special => special.candidates)
  ];
  const best = new Map<number, PossibleHit>();
  for (const { card, value, notable } of candidates) {
    if (card && notable && value > (best.get(card.id)?.value ?? -Infinity)) {
      best.set(card.id, { card, value });
    }
  }
  return [...best.values()];
}
