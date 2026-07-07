/**
 * Pure compute for the "card lens": split an archetype's decks by whether they
 * run a given card, then compare each subset's head-to-head win rates from
 * per-player match records. Kept free of Solid + DOM so it's unit-testable; the
 * panel layers canonicalization, opponent metadata, and rendering on top.
 */
import type { DeckCard, PlayerMatchRecord } from '../types';
import type { DeckRecord } from './data';
import { pointsWinRate } from './matchups';
import { buildCardId, canonicalizeDeckCard } from '../utils/deckCardId';
import { normalizeCardNumber } from '../../shared/cardUtils.js';

export interface DeckLite {
  /** Tournament-scoped player id (string in decks.json; joins to PlayerMatchRecord.playerId). */
  playerId: string;
  cards: DeckCard[];
}

/**
 * Reduce raw per-archetype decks to the `{ playerId, cards }` the lens needs,
 * rewriting each card to its canonical printing (so a cardId built from a
 * canonicalized report item matches). `db` may be null before the synonym DB
 * loads, in which case cards pass through unmapped.
 */
export function canonicalizeForLens(
  decks: DeckRecord[],
  db: Parameters<typeof canonicalizeDeckCard>[1] | null | undefined
): DeckLite[] {
  return decks.map(deck => ({
    playerId: deck.playerId,
    cards: db
      ? (deck.cards ?? []).map(card => canonicalizeDeckCard(card as DeckCard, db))
      : ((deck.cards ?? []) as unknown as DeckCard[])
  }));
}

export interface Tally {
  w: number;
  l: number;
  t: number;
  n: number;
}

function emptyTally(): Tally {
  return { w: 0, l: 0, t: 0, n: 0 };
}

/** Map a per-player outcome to a win/loss/tie bucket, or null for non-games (byes). */
function classify(outcome: PlayerMatchRecord['outcome']): 'w' | 'l' | 't' | null {
  if (outcome === 'win') {
    return 'w';
  }
  if (outcome === 'tie') {
    return 't';
  }
  if (outcome === 'loss' || outcome === 'double_loss') {
    return 'l';
  }
  return null; // bye / unpaired / unknown — not a real game
}

/** Win rate valuing a tie at a match-point third of a win, or null if no games. */
export function wrOf(rec: Tally): number | null {
  return rec.n > 0 ? pointsWinRate(rec.w, rec.t, rec.n) : null;
}

/** Total copies of `cardId` across a (canonicalized) deck's card list. */
export function countInDeck(cards: DeckCard[], cardId: string): number {
  let total = 0;
  for (const card of cards) {
    if (!card.set) {
      continue;
    }
    const num = normalizeCardNumber(card.number) || String(card.number ?? '');
    if (!num) {
      continue;
    }
    if (buildCardId(card.set, num) === cardId) {
      total += Number(card.count ?? card.copies ?? 0);
    }
  }
  return total;
}

export interface Partition {
  withIds: Set<number>;
  withoutIds: Set<number>;
  withCount: number;
  withoutCount: number;
}

/**
 * Copies of `cardId` per tournament-player id, computed once per (decks, cardId).
 * Callers memoize this so a `minCopies` change becomes a cheap threshold split
 * ({@link partitionByCopies}) instead of a full rescan of every deck's cards.
 */
export function copiesByPlayer(decks: DeckLite[], cardId: string): Map<number, number> {
  const copies = new Map<number, number>();
  for (const deck of decks) {
    const tp = Number(deck.playerId);
    if (!Number.isFinite(tp)) {
      continue;
    }
    copies.set(tp, countInDeck(deck.cards, cardId));
  }
  return copies;
}

/** Threshold-split a precomputed copies map into runs-≥minCopies vs not. */
export function partitionByCopies(copies: Map<number, number>, minCopies: number): Partition {
  const n = Math.max(1, minCopies);
  const withIds = new Set<number>();
  const withoutIds = new Set<number>();
  let withCount = 0;
  let withoutCount = 0;
  for (const [tp, count] of copies) {
    if (count >= n) {
      withIds.add(tp);
      withCount += 1;
    } else {
      withoutIds.add(tp);
      withoutCount += 1;
    }
  }
  return { withIds, withoutIds, withCount, withoutCount };
}

/** Split decks into runs-≥minCopies vs not, as sets of tournament-player ids. */
export function partitionByCard(decks: DeckLite[], cardId: string, minCopies: number): Partition {
  return partitionByCopies(copiesByPlayer(decks, cardId), minCopies);
}

export interface LensTallies {
  withBy: Map<string, Tally>;
  withoutBy: Map<string, Tally>;
  withOverall: Tally;
  withoutOverall: Tally;
}

/** Single pass over playerMatches: route each completed game to with/without by pilot id, then by opponent archetype. */
export function tallyLens(matches: PlayerMatchRecord[], part: Partition): LensTallies {
  const withBy = new Map<string, Tally>();
  const withoutBy = new Map<string, Tally>();
  const withOverall = emptyTally();
  const withoutOverall = emptyTally();
  for (const m of matches) {
    const tp = typeof m.playerId === 'number' ? m.playerId : Number(m.playerId);
    const inWith = part.withIds.has(tp);
    const inWithout = !inWith && part.withoutIds.has(tp);
    if (!inWith && !inWithout) {
      continue;
    }
    if (m.completed === false) {
      continue;
    }
    const opp = m.opponentArchetype;
    if (!opp || opp === 'Unknown') {
      continue;
    }
    const c = classify(m.outcome);
    if (!c) {
      continue;
    }
    const byOpp = inWith ? withBy : withoutBy;
    const overall = inWith ? withOverall : withoutOverall;
    let e = byOpp.get(opp);
    if (!e) {
      e = emptyTally();
      byOpp.set(opp, e);
    }
    e[c] += 1;
    e.n += 1;
    overall[c] += 1;
    overall.n += 1;
  }
  return { withBy, withoutBy, withOverall, withoutOverall };
}

export interface LensRow {
  opponent: string;
  withRec: Tally;
  withoutRec: Tally;
  withWR: number | null;
  withoutWR: number | null;
  /** withWR − withoutWR in percentage points, or null if either side has no games. */
  delta: number | null;
}

/** One row per opponent seen by either subset (unsorted, unfiltered — caller adds meta/sort/filter). */
export function buildLensRows(t: LensTallies): LensRow[] {
  const opponents = new Set<string>([...t.withBy.keys(), ...t.withoutBy.keys()]);
  const rows: LensRow[] = [];
  for (const opponent of opponents) {
    const withRec = t.withBy.get(opponent) ?? emptyTally();
    const withoutRec = t.withoutBy.get(opponent) ?? emptyTally();
    const withWR = wrOf(withRec);
    const withoutWR = wrOf(withoutRec);
    rows.push({
      opponent,
      withRec,
      withoutRec,
      withWR,
      withoutWR,
      delta: withWR !== null && withoutWR !== null ? withWR - withoutWR : null
    });
  }
  return rows;
}
