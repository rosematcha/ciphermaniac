/**
 * Credit every card played at a major to a set, and total each set's share.
 *
 * Decklists store a card under its global canonical print, not the print that
 * was sleeved, so the set is worked out here: at each event, the card belongs
 * to the oldest set holding a printing that was legal on that date.
 * Legality follows the regulation mark printed on each card, since that is
 * what rotates; PRE's G-mark reprints left in April 2026 while PRE stayed.
 * Producer-only: this pulls in the set catalog.
 * @module shared/setImpact/build
 */

import {
  BASIC_ENERGY_NAMES,
  buildClusterIndex,
  ENERGY_SETS,
  getReleaseIndex,
  PROMO_SETS,
  SET_CATALOG
} from '../data/canonicalPrint';
import { cardUid, parseCardUid, type SynonymDatabase } from '../data/cardIdentity';
import type {
  SetImpactAttribution,
  SetImpactCard,
  SetImpactEvent,
  SetImpactMetric,
  SetImpactPayload,
  SetImpactRotation,
  SetImpactSet
} from './types';

/**
 * Each April rotation removes the oldest regulation mark. Future dates assume
 * the usual second Friday of April.
 */
export const REGULATION_ROTATIONS: SetImpactRotation[] = [
  { mark: 'D', date: '2023-04-14', predicted: false },
  { mark: 'E', date: '2024-04-05', predicted: false },
  { mark: 'F', date: '2025-04-11', predicted: false },
  { mark: 'G', date: '2026-04-10', predicted: false },
  { mark: 'H', date: '2027-04-09', predicted: true },
  { mark: 'I', date: '2028-04-14', predicted: true },
  { mark: 'J', date: '2029-04-13', predicted: true }
];

const ROTATION_BY_MARK = new Map(REGULATION_ROTATIONS.map(rotation => [rotation.mark, rotation]));
const SET_BY_CODE = new Map(SET_CATALOG.map(entry => [entry.code, entry]));
const DAY_MS = 86_400_000;

/** `SET::NUMBER` (padded, as in card-types.json) to regulation mark. */
export type RegulationMarks = Record<string, string | null | undefined>;

/** A legality window for a set the catalog doesn't date (or dates differently). */
export interface SetWindow {
  code: string;
  /** Display name; falls back to the catalog's. */
  name?: string;
  /** A promo line: last choice for credit, never ranked. */
  promo?: boolean;
  legalFrom: string;
  legalUntil: string | null;
}

interface SetDates {
  legalFrom?: string;
  legalUntil?: string | null;
  promo?: boolean;
}

type SetLookup = Map<string, SetDates>;

interface Print {
  uid: string;
  name: string;
  set: string;
  number: string;
  legalFrom: string;
  /** Exclusive; null = no rotation known. */
  until: string | null;
  promo: boolean;
}

export interface Credit {
  uid: string;
  name: string;
  set: string;
  number: string;
  isNew: boolean;
}

function shiftDate(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function toPrint(uid: string, marks: RegulationMarks, sets: SetLookup): Print | null {
  const parsed = parseCardUid(uid);
  const entry = parsed ? sets.get(parsed.set) : undefined;
  if (!parsed || !entry?.legalFrom) {
    return null;
  }
  const mark = marks[`${parsed.set}::${parsed.number}`];
  const rotation = mark ? ROTATION_BY_MARK.get(mark) : undefined;
  return {
    uid,
    name: parsed.name,
    set: parsed.set,
    number: parsed.number,
    legalFrom: entry.legalFrom,
    until: rotation ? rotation.date : (entry.legalUntil ?? null),
    promo: PROMO_SETS.has(parsed.set) || Boolean(entry.promo)
  };
}

function isLegalAt(print: Print, date: string): boolean {
  return print.legalFrom <= date && (print.until === null || date < print.until);
}

// Non-promo before promo (a promo's set date says nothing about when that card
// came out), then oldest first.
function compareAge(a: Print, b: Print): number {
  if (a.promo !== b.promo) {
    return a.promo ? 1 : -1;
  }
  if (a.legalFrom !== b.legalFrom) {
    return a.legalFrom < b.legalFrom ? -1 : 1;
  }
  return getReleaseIndex(b.set) - getReleaseIndex(a.set) || a.number.localeCompare(b.number);
}

/**
 * Did this printing bring the card into Standard? Not if another set's
 * printing was legal the day before this one became legal. A printing that
 * rotated the same day counts as already legal, since the card never left.
 */
function isIntroduction(print: Print, cluster: Print[]): boolean {
  const dayBefore = shiftDate(print.legalFrom, -1);
  return !cluster.some(
    other => other.set !== print.set && (print.promo || !other.promo) && isLegalAt(other, dayBefore)
  );
}

/**
 * Build a resolver from any printing's UID and an event date to the set that
 * earns the credit, or null when no printing was legal then. `extraSets` dates
 * sets the catalog leaves undated (every set before Sword & Shield), so their
 * cards can be credited and a reprint of one is not mistaken for a card new
 * to Standard.
 */
export function createAttributor(
  db: SynonymDatabase,
  marks: RegulationMarks,
  extraSets: SetWindow[] = []
): { canonical: (uid: string) => string; credit: (canonical: string, date: string) => Credit | null } {
  const clusterIndex = buildClusterIndex(db);
  const sets: SetLookup = new Map<string, SetDates>([
    ...SET_BY_CODE,
    ...extraSets.map(set => [set.code, set] as const)
  ]);
  const clusters = new Map<string, Print[]>();
  const cache = new Map<string, Credit | null>();

  const printsOf = (canonical: string): Print[] => {
    let prints = clusters.get(canonical);
    if (!prints) {
      prints = [...new Set(clusterIndex.get(canonical) ?? [canonical])]
        .map(uid => toPrint(uid, marks, sets))
        .filter((print): print is Print => print !== null);
      clusters.set(canonical, prints);
    }
    return prints;
  };

  const resolve = (canonical: string, date: string): Credit | null => {
    const cluster = printsOf(canonical);
    const [oldest] = cluster.filter(print => isLegalAt(print, date)).sort(compareAge);
    if (!oldest) {
      return null;
    }
    const { uid, name, set, number } = oldest;
    return { uid, name, set, number, isNew: isIntroduction(oldest, cluster) };
  };

  return {
    canonical: uid => db.synonyms[uid] ?? uid,
    credit: (canonical, date) => {
      const key = `${canonical}@${date}`;
      if (!cache.has(key)) {
        cache.set(key, resolve(canonical, date));
      }
      return cache.get(key) ?? null;
    }
  };
}

/**
 * ln(field / placement). Over a whole field this averages to 1, so the
 * weighted view only moves a card that places better or worse than the field.
 * A deck without a placement weighs 1.
 */
export function placementWeight(placement: number | null | undefined, field: number): number {
  if (!placement || placement < 1) {
    return 1;
  }
  return Math.log(field / Math.min(placement, field));
}

export interface ImpactDeck {
  placement?: number | null;
  cards: Array<{ name: string; set?: string | null; number?: string | number | null }>;
}

export interface ImpactEventInput extends SetImpactEvent {
  decks: ImpactDeck[];
}

type Shares = Record<SetImpactMetric, number>;

function deckCanonicals(deck: ImpactDeck, canonical: (uid: string) => string): Set<string> {
  const ids = new Set<string>();
  for (const card of deck.cards) {
    const uid = BASIC_ENERGY_NAMES.has(card.name) ? null : cardUid(card.name, card.set, card.number);
    if (uid) {
      ids.add(canonical(uid));
    }
  }
  return ids;
}

/** Share of the field running each card, by canonical UID. */
export function cardShares(event: ImpactEventInput, canonical: (uid: string) => string): Map<string, Shares> {
  const placed = Math.max(0, ...event.decks.map(deck => deck.placement ?? 0));
  const field = Math.max(event.players, placed, event.decks.length);
  const totals = new Map<string, Shares>();
  let weightSum = 0;
  for (const deck of event.decks) {
    const weight = placementWeight(deck.placement, field);
    weightSum += weight;
    for (const id of deckCanonicals(deck, canonical)) {
      const shares = totals.get(id) ?? { linear: 0, weighted: 0 };
      shares.linear += 1;
      shares.weighted += weight;
      totals.set(id, shares);
    }
  }
  for (const shares of totals.values()) {
    shares.linear /= event.decks.length || 1;
    shares.weighted /= weightSum || 1;
  }
  return totals;
}

interface CardTotals extends Credit, Shares {}

type EventSetTotals = Map<string, Record<SetImpactAttribution, Shares>>;

const round = (value: number): number => Math.round(value * 10_000) / 10_000;

function emptySetTotals(): Record<SetImpactAttribution, Shares> {
  return { legal: { linear: 0, weighted: 0 }, new: { linear: 0, weighted: 0 } };
}

function addShares(target: Shares, shares: Shares): void {
  target.linear += shares.linear;
  target.weighted += shares.weighted;
}

/** The mark most of a set's own printings carry, and when it rotates. */
function predictedRotation(code: string, marks: RegulationMarks): SetImpactRotation | undefined {
  const counts = new Map<string, number>();
  for (const [key, mark] of Object.entries(marks)) {
    if (mark && key.startsWith(`${code}::`)) {
      counts.set(mark, (counts.get(mark) ?? 0) + 1);
    }
  }
  const [dominant] = [...counts].sort((a, b) => b[1] - a[1]);
  return dominant ? ROTATION_BY_MARK.get(dominant[0]) : undefined;
}

function rotationOf(
  entry: { code: string; legalUntil?: string | null },
  marks: RegulationMarks
): Pick<SetImpactSet, 'rotatesOn' | 'rotationPredicted'> {
  if (entry.legalUntil) {
    return { rotatesOn: entry.legalUntil, rotationPredicted: false };
  }
  const predicted = predictedRotation(entry.code, marks);
  return { rotatesOn: predicted?.date ?? null, rotationPredicted: predicted?.predicted ?? false };
}

function yearsBetween(from: string, until: string | null): number | null {
  return until ? Math.round(((Date.parse(until) - Date.parse(from)) / DAY_MS / 365.25) * 100) / 100 : null;
}

/**
 * Every dated set that can be ranked, oldest first: the catalog's, with extra
 * windows filling in (or overriding) the dates. Promo and energy sets never rank.
 */
function rankableSets(extraSets: SetWindow[]) {
  const extras = new Map(extraSets.map(set => [set.code, set]));
  const merged = [
    ...SET_CATALOG.map(entry => ({
      ...entry,
      ...extras.get(entry.code),
      name: extras.get(entry.code)?.name ?? entry.name
    })),
    ...extraSets.filter(set => !SET_BY_CODE.has(set.code)).map(set => ({ ...set, name: set.name ?? set.code }))
  ];
  return merged
    .filter(set => !('promo' in set && set.promo))
    .filter(isRankedSet)
    .sort((a, b) => a.legalFrom.localeCompare(b.legalFrom) || getReleaseIndex(b.code) - getReleaseIndex(a.code));
}

function isRankedSet<T extends { code: string; legalFrom?: string }>(entry: T): entry is T & { legalFrom: string } {
  return Boolean(entry.legalFrom) && !PROMO_SETS.has(entry.code) && !ENERGY_SETS.has(entry.code);
}

/**
 * Feed events oldest first, one at a time (a major's decks run to several MB),
 * then `finish` for the payload.
 */
export function createSetImpactBuilder(db: SynonymDatabase, marks: RegulationMarks, extraSets: SetWindow[] = []) {
  const attributor = createAttributor(db, marks, extraSets);
  const events: SetImpactEvent[] = [];
  const perEvent: EventSetTotals[] = [];
  const cards = new Map<string, CardTotals>();
  const unattributed = new Map<string, number>();

  const credit = (id: string, date: string, shares: Shares, setTotals: EventSetTotals): void => {
    const earned = attributor.credit(id, date);
    if (!earned) {
      unattributed.set(id, (unattributed.get(id) ?? 0) + shares.linear);
      return;
    }
    const totals = setTotals.get(earned.set) ?? emptySetTotals();
    addShares(totals.legal, shares);
    if (earned.isNew) {
      addShares(totals.new, shares);
    }
    setTotals.set(earned.set, totals);
    const card = cards.get(earned.uid) ?? { ...earned, linear: 0, weighted: 0 };
    addShares(card, shares);
    cards.set(earned.uid, card);
  };

  const addEvent = (event: ImpactEventInput): void => {
    const setTotals: EventSetTotals = new Map();
    for (const [id, shares] of cardShares(event, attributor.canonical)) {
      credit(id, event.date, shares, setTotals);
    }
    events.push({ date: event.date, name: event.name, players: event.players });
    perEvent.push(setTotals);
  };

  const buildSet = (entry: { code: string; name: string; legalFrom: string; legalUntil?: string | null }) => {
    const indexes = events.flatMap((event, index) =>
      entry.legalFrom <= event.date && (!entry.legalUntil || event.date < entry.legalUntil) ? [index] : []
    );
    if (indexes.length === 0) {
      return null;
    }
    const totalsAt = (index: number) => perEvent[index].get(entry.code) ?? emptySetTotals();
    const seriesFor = (attribution: SetImpactAttribution) => ({
      linear: indexes.map(index => round(totalsAt(index)[attribution].linear)),
      weighted: indexes.map(index => round(totalsAt(index)[attribution].weighted))
    });
    const rotation = rotationOf(entry, marks);
    const setCards: SetImpactCard[] = [...cards.values()]
      .filter(card => card.set === entry.code)
      .map(({ name, set, number, isNew, linear, weighted }) => ({
        name,
        set,
        number,
        isNew,
        linear: round(linear / indexes.length),
        weighted: round(weighted / indexes.length)
      }))
      .sort((a, b) => b.linear - a.linear || a.name.localeCompare(b.name));
    return {
      code: entry.code,
      name: entry.name,
      legalFrom: entry.legalFrom,
      ...rotation,
      legalYears: yearsBetween(entry.legalFrom, rotation.rotatesOn),
      events: indexes,
      series: { legal: seriesFor('legal'), new: seriesFor('new') },
      cards: setCards
    } satisfies SetImpactSet;
  };

  const finish = (generatedAt: string): SetImpactPayload => ({
    generatedAt,
    rotations: REGULATION_ROTATIONS,
    events,
    sets: rankableSets(extraSets)
      .map(buildSet)
      .filter((set): set is SetImpactSet => set !== null)
  });

  return { addEvent, finish, unattributed };
}
