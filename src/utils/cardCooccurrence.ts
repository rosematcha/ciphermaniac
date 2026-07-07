/**
 * Card co-occurrence analysis over a filtered deck subset.
 *
 * Two derived views power the "filter toward a build" features:
 *  - findSubstituteQuestions: mutually-exclusive choices (decks run one OR the
 *    other, rarely both) → the "prefer this or that" questionnaire.
 *  - findComplements: cards that strongly travel WITH the current picks →
 *    "often played together" suggestions.
 *
 * Pure module. Card ids are built the same way the filter aggregator and rules
 * build them (`buildCardId`), so a chosen option maps cleanly back to a rule.
 */

import type { Deck, DeckCard } from '../types';
import { buildCardKeyFromCard, deriveDeckId, getDeckCards } from './clientSideFiltering';

export interface CardRef {
  cardId: string;
  name: string;
  set?: string;
  number?: string | number;
  category?: string;
}

export interface CardPresence {
  ref: CardRef;
  deckIds: Set<string>;
  count: number;
}

export interface CooccurrenceContext {
  totalDecks: number;
  presence: Map<string, CardPresence>;
}

export interface ReportItemLike {
  cardId?: string;
  name: string;
  set?: string;
  number?: string | number;
  category?: string;
}

export interface SubstituteQuestion {
  /** Stable id: option cardIds sorted and joined by "|". */
  id: string;
  options: CardRef[];
  /** Fraction of decks that run at least one option. */
  coverage: number;
  /** Headline pairwise lift (lower = stronger substitutes). */
  lift: number;
  /** Composite ranking score; higher is asked sooner. */
  strength: number;
}

export interface ComplementSuggestion {
  ref: CardRef;
  /** The picked card this complements. */
  withCardId: string;
  /** Distinctiveness: P(candidate | picks) ÷ P(candidate | whole archetype). */
  lift: number;
  /** P(candidate | picks) — "87% of these decks also run …". */
  coPct: number;
  /** P(candidate | whole archetype), when a baseline is provided. */
  basePct?: number;
}

function cardCopies(card: DeckCard): number {
  return Number(card?.count ?? card?.copies ?? 0);
}

function intersectionSize(a: Set<string>, b: Set<string>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let n = 0;
  for (const x of small) {
    if (large.has(x)) {
      n += 1;
    }
  }
  return n;
}

/**
 * Build the presence index: which decks run each card. Cards are labelled from
 * the (canonical) report items when available, falling back to the deck card.
 */
export function buildCooccurrence(decks: Deck[], reportItems: ReportItemLike[]): CooccurrenceContext {
  const refFromReport = new Map<string, CardRef>();
  for (const item of reportItems ?? []) {
    const id = item.cardId ?? buildCardKeyFromCard(item);
    if (!id) {
      continue;
    }
    refFromReport.set(id, {
      cardId: id,
      name: item.name,
      set: item.set,
      number: item.number,
      category: item.category
    });
  }

  const presence = new Map<string, CardPresence>();
  (decks ?? []).forEach((deck, index) => {
    const id = deriveDeckId(deck, index);
    const seen = new Set<string>();
    for (const card of getDeckCards(deck)) {
      if (cardCopies(card) <= 0) {
        continue;
      }
      const cid = buildCardKeyFromCard(card);
      if (!cid || seen.has(cid)) {
        continue;
      }
      seen.add(cid);
      let entry = presence.get(cid);
      if (!entry) {
        const ref =
          refFromReport.get(cid) ??
          ({
            cardId: cid,
            name: card.name ?? 'Unknown Card',
            set: card.set,
            number: card.number,
            category: card.category
          } as CardRef);
        entry = { ref, deckIds: new Set(), count: 0 };
        presence.set(cid, entry);
      }
      entry.deckIds.add(id);
    }
  });
  for (const entry of presence.values()) {
    entry.count = entry.deckIds.size;
  }

  return { totalDecks: (decks ?? []).length, presence };
}

export interface SubstituteOptions {
  /**
   * Each option must appear in at least this fraction of decks. Real either/or
   * tech choices (e.g. Boomerang Energy vs Powerglass) commonly sit in the
   * 20-35% band, so the floor is deliberately low; the lift/overlap guards are
   * what keep genuinely independent cards from being offered as a "choice".
   */
  minIndividual?: number;
  /** Skip near-universal staples — they aren't a choice. */
  maxIndividual?: number;
  /** Pair must co-occur this far below independence (lift). */
  maxLift?: number;
  /** Pair must rarely share a deck (P(A∩B)). */
  maxOverlap?: number;
  maxQuestions?: number;
  /** Don't ask anything on a tiny, noisy subset. */
  minDecks?: number;
  /** Consider only the N most common candidates (keeps it O(N²)). */
  topN?: number;
  /** Cards already pinned by a rule — never re-ask. */
  excludeCardIds?: Iterable<string>;
}

interface PairStat {
  a: CardPresence;
  b: CardPresence;
  overlap: number;
  lift: number;
  coverage: number;
  strength: number;
}

/**
 * Detect mutually-exclusive card choices to ask the user about.
 */
export function findSubstituteQuestions(ctx: CooccurrenceContext, opts: SubstituteOptions = {}): SubstituteQuestion[] {
  const {
    minIndividual = 0.2,
    maxIndividual = 0.85,
    maxLift = 0.6,
    maxOverlap = 0.15,
    maxQuestions = 6,
    minDecks = 8,
    topN = 40,
    excludeCardIds
  } = opts;

  const total = ctx.totalDecks;
  if (total < minDecks) {
    return [];
  }
  const exclude = excludeCardIds instanceof Set ? excludeCardIds : new Set(excludeCardIds ?? []);

  const candidates = [...ctx.presence.values()]
    .filter(entry => {
      const freq = entry.count / total;
      return freq >= minIndividual && freq <= maxIndividual && !exclude.has(entry.ref.cardId);
    })
    .sort((x, y) => y.count - x.count)
    .slice(0, topN);

  const pairs: PairStat[] = [];
  const adjacency = new Map<string, Set<string>>();
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const a = candidates[i];
      const b = candidates[j];
      // Candidates are pre-filtered to freq >= minIndividual (> 0), so counts
      // are always positive; no zero-probability guard is needed here.
      const pA = a.count / total;
      const pB = b.count / total;
      const overlap = intersectionSize(a.deckIds, b.deckIds);
      const pAB = overlap / total;
      const lift = pAB === 0 ? 0 : pAB / (pA * pB);
      if (lift > maxLift || pAB > maxOverlap) {
        continue;
      }
      const coverage = (a.count + b.count - overlap) / total;
      const balance = 1 - Math.abs(pA - pB) / (pA + pB);
      const strength = coverage * (1 - lift) * balance;
      pairs.push({ a, b, overlap, lift, coverage, strength });
      if (!adjacency.has(a.ref.cardId)) {
        adjacency.set(a.ref.cardId, new Set());
      }
      if (!adjacency.has(b.ref.cardId)) {
        adjacency.set(b.ref.cardId, new Set());
      }
      adjacency.get(a.ref.cardId)!.add(b.ref.cardId);
      adjacency.get(b.ref.cardId)!.add(a.ref.cardId);
    }
  }

  pairs.sort((x, y) => y.strength - x.strength);

  const byId = new Map<string, CardPresence>();
  for (const entry of candidates) {
    byId.set(entry.ref.cardId, entry);
  }

  const used = new Set<string>();
  const questions: SubstituteQuestion[] = [];
  for (const pair of pairs) {
    if (questions.length >= maxQuestions) {
      break;
    }
    const aId = pair.a.ref.cardId;
    const bId = pair.b.ref.cardId;
    if (used.has(aId) || used.has(bId)) {
      continue;
    }

    // Try to extend to a 3-way mutual-exclusion clique.
    let third: CardPresence | null = null;
    const aAdj = adjacency.get(aId);
    const bAdj = adjacency.get(bId);
    if (aAdj && bAdj) {
      let best = -Infinity;
      for (const cId of aAdj) {
        if (cId === bId || used.has(cId) || !bAdj.has(cId)) {
          continue;
        }
        const c = byId.get(cId);
        if (c && c.count > best) {
          best = c.count;
          third = c;
        }
      }
    }

    const members = third ? [pair.a, pair.b, third] : [pair.a, pair.b];
    const unionIds = new Set<string>();
    for (const m of members) {
      used.add(m.ref.cardId);
      for (const d of m.deckIds) {
        unionIds.add(d);
      }
    }
    const options = [...members].sort((x, y) => y.count - x.count).map(m => m.ref);

    questions.push({
      id: members
        .map(m => m.ref.cardId)
        .sort()
        .join('|'),
      options,
      coverage: unionIds.size / total,
      lift: pair.lift,
      strength: pair.strength
    });
  }

  return questions;
}

export interface ComplementOptions {
  /**
   * cardId → fraction of *all* archetype decks running the card. Used to favour
   * niche partners: a card that's reliable alongside the picks but rare in the
   * archetype overall scores higher than an everyone-plays-it staple.
   */
  baselinePct?: Map<string, number>;
  /** Candidate must appear alongside the picks at least this often. */
  minCoPct?: number;
  /** Distinctiveness floor (coPct ÷ baseline) when a baseline is available. */
  minLift?: number;
  /** Skip archetype-wide staples outright — they aren't a "suggestion". */
  maxBaseline?: number;
  maxSuggestions?: number;
}

/**
 * Cards that travel *distinctively* with the current picks. When a baseline is
 * supplied, ranking favours niche partners (high alongside the picks, rare in
 * the archetype overall) over generic staples.
 */
export function findComplements(
  ctx: CooccurrenceContext,
  pickedCardIds: string[],
  opts: ComplementOptions = {}
): ComplementSuggestion[] {
  const { baselinePct, minCoPct = 0.5, minLift = 2, maxBaseline = 0.6, maxSuggestions = 6 } = opts;
  const total = ctx.totalDecks;
  if (!total || !pickedCardIds.length) {
    return [];
  }
  const picked = new Set(pickedCardIds);

  const best = new Map<string, ComplementSuggestion>();
  for (const pid of pickedCardIds) {
    const p = ctx.presence.get(pid);
    if (!p || p.count === 0) {
      continue;
    }
    for (const [cid, c] of ctx.presence) {
      if (picked.has(cid)) {
        continue;
      }
      const overlap = intersectionSize(p.deckIds, c.deckIds);
      if (overlap === 0) {
        continue;
      }
      const coPct = overlap / p.count; // P(candidate | this pick)
      if (coPct < minCoPct) {
        continue;
      }
      const base = baselinePct?.get(cid);
      let lift: number;
      let basePct: number | undefined;
      if (base !== undefined && base > 0) {
        if (base > maxBaseline) {
          // An everyone-plays-it staple — not a meaningful suggestion.
          continue;
        }
        basePct = base;
        lift = coPct / base;
        if (lift < minLift) {
          continue;
        }
      } else {
        // No baseline to measure niche-ness against; fall back to raw coPct.
        lift = coPct;
      }
      const existing = best.get(cid);
      if (!existing || lift > existing.lift) {
        best.set(cid, { ref: c.ref, withCardId: pid, lift, coPct, basePct });
      }
    }
  }

  return [...best.values()].sort((x, y) => y.lift - x.lift || y.coPct - x.coPct).slice(0, maxSuggestions);
}
