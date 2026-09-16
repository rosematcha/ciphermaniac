/**
 * Derivations and wording for /tools/pack-ev.
 *
 * The page's job is to put two numbers next to each other — what a pack holds
 * and what a pack costs — so everything here is about making that comparison
 * readable: odds in the "1 in 146" idiom the pull-rate articles use, money to
 * the cent, and the return as a percentage of what you paid.
 * @module src/pages/packEv/model
 */

import type { PackEvSetPayload, SealedProduct, SlotEv } from '../../../shared/packEv/types';

/** Dollars, always to the cent — these are prices, not estimates. */
export function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

/**
 * A buylist rate, which is quoted in tenths of a cent.
 *
 * `money` would round the common rate of $0.035 to four cents — a 14% error on
 * the number the whole bulk line rests on, printed next to its own source.
 */
export function rate(value: number): string {
  return `$${value.toFixed(3).replace(/0$/, '')}`;
}

/**
 * Odds in the idiom the pull-rate articles use.
 *
 * "1 in 146" beats "0.68%" for the rare end, and at the common end it inverts:
 * "1 in 1" would be a silly way to write the card that is in every pack.
 */
export function oddsLabel(chance: number): string {
  if (chance >= 1) {
    return 'Every pack';
  }
  if (chance <= 0) {
    return '—';
  }
  if (chance >= 0.2) {
    return `${Math.round(chance * 100)}% of packs`;
  }
  return `1 in ${Math.round(1 / chance)}`;
}

/**
 * A share of runs, as a percentage.
 *
 * Keeps a decimal under 10% — the difference between "beat the box price 4% of
 * the time" and "0.4%" is the whole answer, and both round to the same integer.
 */
export function shareLabel(fraction: number): string {
  const percent = fraction * 100;
  return `${percent < 10 ? percent.toFixed(1) : Math.round(percent)}%`;
}

/** What you get back per dollar spent, as a whole-number percentage. */
export function returnPercent(value: number, cost: number | null): number | null {
  if (cost === null || cost <= 0) {
    return null;
  }
  return Math.round((value / cost) * 100);
}

export interface SealedRow {
  product: SealedProduct;
  costPerPack: number | null;
  /** EV of everything inside, i.e. pack EV times the pack count. */
  contentsValue: number;
  returnPercent: number | null;
}

/**
 * One row per sealed product, cheapest per pack first.
 *
 * Products TCGplayer has no market price for keep their row — "no market
 * price" is a fact about a product worth seeing, and dropping the row would
 * silently shorten the list.
 */
export function sealedRows(payload: Pick<PackEvSetPayload, 'ev' | 'sealed'>): SealedRow[] {
  const rows = payload.sealed.map(product => ({
    product,
    costPerPack: product.price === null ? null : product.price / product.packs,
    contentsValue: payload.ev.perPack * product.packs,
    returnPercent: returnPercent(payload.ev.perPack * product.packs, product.price)
  }));
  return rows.sort((a, b) => (a.costPerPack ?? Infinity) - (b.costPerPack ?? Infinity));
}

/** The product the set is normally bought by — the box, or the ETB where there is none. */
export function primaryProduct(payload: Pick<PackEvSetPayload, 'sealed'>): SealedProduct | null {
  return payload.sealed.find(product => product.primary) ?? payload.sealed[0] ?? null;
}

export interface SlotRow {
  key: string;
  /** Set only on the first row of a slot, so the column reads as a group. */
  slot: string | null;
  /** How many of this slot a pack holds, on that same first row. */
  count: number | null;
  outcome: string;
  chance: number;
  averageValue: number;
  contribution: number;
}

/**
 * Slot outcomes as flat rows, biggest contributor first within each slot.
 *
 * Slots keep their pack order (commons, then the rare slot, then the reverses)
 * because that is the order you physically flip through, but inside a slot the
 * money leads: the interesting line in the second reverse slot is the
 * Illustration Rare, not the 90% of packs that give you a reverse holo.
 */
export function slotRows(slots: SlotEv[]): SlotRow[] {
  const rows: SlotRow[] = [];
  for (const slot of slots) {
    const ordered = [...slot.outcomes].sort((a, b) => b.contribution - a.contribution);
    ordered.forEach((outcome, index) => {
      rows.push({
        key: `${slot.label}:${outcome.label}`,
        slot: index === 0 ? slot.label : null,
        count: index === 0 ? slot.count : null,
        outcome: outcome.label,
        chance: outcome.chance,
        averageValue: outcome.averageValue,
        contribution: outcome.contribution
      });
    });
  }
  return rows;
}

/** `2026-09-16` → `16 Sep 2026`, for the "prices from" line. */
export function priceDate(generatedAt: string): string {
  const parsed = new Date(generatedAt);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  return parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
