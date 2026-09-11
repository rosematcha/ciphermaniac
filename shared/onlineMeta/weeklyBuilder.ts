/**
 * The weekly report: this week against last, from the 30-day deck window.
 *
 * Everything the Trends page needs beyond the daily chart is computed here in
 * one pass over the decks, so the page renders a small artifact instead of
 * recomputing from tens of megabytes of lists in the browser:
 *
 *  - per archetype: share of lists and of top-10% finishes in each period,
 *    plus a daily series over the last `dailyDays` days;
 *  - per deck: which cards its own lists added or cut, as inclusion among the
 *    archetype's lists this week against last, with a daily inclusion series;
 *  - card movers: the change in a card's share of ALL lists, split into the
 *    part that came from the decks playing it growing or shrinking (mix) and
 *    the part that came from lists adding or cutting it (adoption), with the
 *    archetypes that drove it.
 *
 * The attribution is a shift-share decomposition. For a card c and archetype a
 * with archetype share S_a and within-archetype inclusion W_a in each period,
 * the card's overall share is Σ_a S_a·W_a, so its change decomposes exactly as
 *   Δ = Σ_a ΔS_a·W̄_a  (mix)  +  Σ_a S̄_a·ΔW_a  (adoption)
 * using period means for the bars. The two parts sum to the change.
 *
 * Periods are whole UTC days. `windowEnd` is exclusive; the recent period is
 * the `days` days before it, the prior period the `days` before that.
 * @module shared/onlineMeta/weeklyBuilder
 */

import { deriveArchetypeGrouping } from '../data/archetypes/build';
import { isGenericArchetypeName } from '../analysis/archetypeClassifier.js';
import { getCanonicalCard } from '../data/cardSynonyms.js';
import { cardUidOrName, parseCardUid } from '../data/cardIdentity';
import { BASIC_ENERGY_NAMES } from '../data/canonicalPrint';
import type {
  BuildWeeklyReportOptions,
  TrendDeckInput,
  TrendHistory,
  TrendHistoryDay,
  WeeklyArchetype,
  WeeklyDailyPoint,
  WeeklyDeck,
  WeeklyDeckCard,
  WeeklyMover,
  WeeklyMoverDriver,
  WeeklyReport
} from './types';

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT = 0;
const PRIOR = 1;
/** A card is "new" to a deck when it crosses this inclusion from below. */
const NEW_CARD_THRESHOLD = 5;

interface Settings {
  endMs: number;
  days: number;
  dailyDays: number;
  minDayLists: number;
  minDeckLists: number;
  minDeckDayLists: number;
  archetypeLimit: number;
  deckLimit: number;
  deckCardLimit: number;
  moverLimit: number;
  minMoverLists: number;
  driverLimit: number;
}

/** Counts split by period (index RECENT / PRIOR) and by day of the daily window. */
class Tally {
  readonly period: [number, number] = [0, 0];
  readonly day: number[];

  constructor(dailyDays: number) {
    this.day = Array.from({ length: dailyDays }, () => 0);
  }

  bump(place: Placement, by = 1): void {
    if (place.period !== null) {
      this.period[place.period] += by;
    }
    if (place.day !== null) {
      this.day[place.day] += by;
    }
  }
}

/** Where a list lands: which comparison period and which day of the daily window. */
interface Placement {
  period: 0 | 1 | null;
  day: number | null;
}

/** What every builder step needs. */
interface Ctx {
  tallies: Tallies;
  s: Settings;
  synonymDb: BuildWeeklyReportOptions['synonymDb'];
}

interface CardInArchetype {
  lists: Tally;
}

interface ArchetypeTally {
  base: string;
  displayName: string;
  generic: boolean;
  lists: Tally;
  top10: Tally;
  cards: Map<string, CardInArchetype>;
}

interface CardTally {
  uid: string;
  name: string;
  set: string | null;
  number: string | null;
  lists: Tally;
  byArchetype: Map<string, [number, number]>;
}

interface Tallies {
  total: { lists: Tally; top10: Tally };
  archetypes: Map<string, ArchetypeTally>;
  cards: Map<string, CardTally>;
}

const round1 = (value: number): number => Math.round(value * 10) / 10;
const pctOf = (part: number, whole: number): number => (whole > 0 ? round1((100 * part) / whole) : 0);

const DEFAULTS: Omit<Settings, 'endMs'> = {
  days: 7,
  dailyDays: 14,
  minDayLists: 100,
  minDeckLists: 20,
  minDeckDayLists: 8,
  archetypeLimit: 32,
  deckLimit: 8,
  deckCardLimit: 8,
  moverLimit: 12,
  minMoverLists: 40,
  driverLimit: 3
};

const orDefault = (value: number | undefined, fallback: number): number => (value === undefined ? fallback : value);

function settingsFrom(options: BuildWeeklyReportOptions): Settings {
  const endMs = new Date(options.windowEnd).getTime();
  if (!Number.isFinite(endMs)) {
    throw new Error('buildWeeklyReport: windowEnd is not a date');
  }
  const settings = { endMs, ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS) as Array<keyof typeof DEFAULTS>) {
    settings[key] = orDefault(options[key], DEFAULTS[key]);
  }
  settings.days = Math.max(1, Math.floor(settings.days));
  settings.dailyDays = Math.max(1, Math.floor(settings.dailyDays));
  return settings;
}

/** Which period (RECENT / PRIOR / null) and which daily-window day a timestamp lands in. */
function placeInTime(dateMs: number, s: Settings): Placement {
  const daysBeforeEnd = (s.endMs - dateMs) / DAY_MS;
  if (daysBeforeEnd <= 0) {
    return { period: null, day: null };
  }
  const period = daysBeforeEnd <= s.days ? RECENT : daysBeforeEnd <= 2 * s.days ? PRIOR : null;
  const dayIndex = s.dailyDays - Math.ceil(daysBeforeEnd);
  const day = dayIndex >= 0 && dayIndex < s.dailyDays ? dayIndex : null;
  return { period, day };
}

function archetypeFor(tallies: Tallies, deck: TrendDeckInput, dailyDays: number): ArchetypeTally {
  const label = deck.archetype || 'Unknown';
  const { base } = deriveArchetypeGrouping(label, 'lower', 'unknown');
  let entry = tallies.archetypes.get(base);
  if (!entry) {
    entry = {
      base,
      displayName: label,
      generic: isGenericArchetypeName(label),
      lists: new Tally(dailyDays),
      top10: new Tally(dailyDays),
      cards: new Map()
    };
    tallies.archetypes.set(base, entry);
  }
  return entry;
}

function cardKey(card: NonNullable<TrendDeckInput['cards']>[number], synonymDb: BuildWeeklyReportOptions['synonymDb']) {
  const name = card?.name || 'Unknown Card';
  const set = (card?.set || '').toString().toUpperCase();
  const number = card?.number === undefined || card.number === null ? '' : String(card.number);
  const raw = cardUidOrName(name, set, number);
  return synonymDb ? getCanonicalCard(synonymDb, raw) : raw;
}

function cardFor(tallies: Tallies, uid: string, fallbackName: string, dailyDays: number): CardTally {
  let entry = tallies.cards.get(uid);
  if (!entry) {
    const parsed = parseCardUid(uid);
    entry = {
      uid,
      name: parsed?.name ?? fallbackName,
      set: parsed?.set ?? null,
      number: parsed?.number ?? null,
      lists: new Tally(dailyDays),
      byArchetype: new Map()
    };
    tallies.cards.set(uid, entry);
  }
  return entry;
}

function tallyDeckCards(ctx: Ctx, deck: TrendDeckInput, archetype: ArchetypeTally, place: Placement): void {
  const seen = new Set<string>();
  for (const card of deck.cards ?? []) {
    const uid = cardKey(card, ctx.synonymDb);
    if (seen.has(uid)) {
      continue;
    }
    seen.add(uid);
    const entry = cardFor(ctx.tallies, uid, card?.name || 'Unknown Card', ctx.s.dailyDays);
    entry.lists.bump(place);
    if (place.period !== null) {
      const per = entry.byArchetype.get(archetype.base) ?? [0, 0];
      per[place.period] += 1;
      entry.byArchetype.set(archetype.base, per);
    }
    let inArchetype = archetype.cards.get(uid);
    if (!inArchetype) {
      inArchetype = { lists: new Tally(ctx.s.dailyDays) };
      archetype.cards.set(uid, inArchetype);
    }
    inArchetype.lists.bump(place);
  }
}

function tallyDecks(ctx: Ctx, decks: TrendDeckInput[]): void {
  const { tallies, s } = ctx;
  for (const deck of decks) {
    const dateMs = Date.parse(String(deck?.tournamentDate ?? ''));
    if (!Number.isFinite(dateMs)) {
      continue;
    }
    const place = placeInTime(dateMs, s);
    if (place.period === null && place.day === null) {
      continue;
    }
    const archetype = archetypeFor(tallies, deck, s.dailyDays);
    const isTop10 = Array.isArray(deck.successTags) && deck.successTags.includes('top10');
    tallies.total.lists.bump(place);
    archetype.lists.bump(place);
    if (isTop10) {
      tallies.total.top10.bump(place);
      archetype.top10.bump(place);
    }
    tallyDeckCards(ctx, deck, archetype, place);
  }
}

const dayKey = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

function datesOf(s: Settings): string[] {
  return Array.from({ length: s.dailyDays }, (_, i) => dayKey(s.endMs - (s.dailyDays - i) * DAY_MS));
}

function dailyPoints(archetype: ArchetypeTally, tallies: Tallies, dates: string[], s: Settings): WeeklyDailyPoint[] {
  return dates.map((date, i) => {
    const lists = tallies.total.lists.day[i];
    const top10 = tallies.total.top10.day[i];
    return {
      date,
      lists: archetype.lists.day[i],
      top10: archetype.top10.day[i],
      share: lists >= s.minDayLists ? pctOf(archetype.lists.day[i], lists) : null,
      top10Share: lists >= s.minDayLists && top10 > 0 ? pctOf(archetype.top10.day[i], top10) : null
    };
  });
}

function buildArchetypes(tallies: Tallies, dates: string[], s: Settings): WeeklyArchetype[] {
  const { total } = tallies;
  const rows: WeeklyArchetype[] = [];
  for (const archetype of tallies.archetypes.values()) {
    if (archetype.generic) {
      continue;
    }
    const share = pctOf(archetype.lists.period[RECENT], total.lists.period[RECENT]);
    const priorShare = pctOf(archetype.lists.period[PRIOR], total.lists.period[PRIOR]);
    rows.push({
      base: archetype.base,
      displayName: archetype.displayName,
      lists: archetype.lists.period[RECENT],
      priorLists: archetype.lists.period[PRIOR],
      share,
      priorShare,
      delta: round1(share - priorShare),
      top10Share: pctOf(archetype.top10.period[RECENT], total.top10.period[RECENT]),
      priorTop10Share: pctOf(archetype.top10.period[PRIOR], total.top10.period[PRIOR]),
      daily: dailyPoints(archetype, tallies, dates, s)
    });
  }
  rows.sort((a, b) => b.share - a.share || b.lists - a.lists || a.base.localeCompare(b.base));
  return rows.slice(0, s.archetypeLimit);
}

function deckCard(ctx: Ctx, uid: string, inArchetype: CardInArchetype, archetype: ArchetypeTally): WeeklyDeckCard {
  const { tallies, s } = ctx;
  const meta = tallies.cards.get(uid);
  const inclusion = pctOf(inArchetype.lists.period[RECENT], archetype.lists.period[RECENT]);
  const priorInclusion = pctOf(inArchetype.lists.period[PRIOR], archetype.lists.period[PRIOR]);
  const card: WeeklyDeckCard = {
    uid,
    name: meta?.name ?? uid,
    set: meta?.set ?? null,
    number: meta?.number ?? null,
    inclusion,
    priorInclusion,
    delta: round1(inclusion - priorInclusion),
    isNew: priorInclusion < NEW_CARD_THRESHOLD && inclusion >= NEW_CARD_THRESHOLD,
    daily: archetype.lists.day.map((lists, i) =>
      lists >= s.minDeckDayLists ? pctOf(inArchetype.lists.day[i], lists) : null
    )
  };
  return card;
}

function buildDeck(ctx: Ctx, archetype: ArchetypeTally): WeeklyDeck {
  const { s } = ctx;
  const cards: WeeklyDeckCard[] = [];
  for (const [uid, inArchetype] of archetype.cards) {
    const card = deckCard(ctx, uid, inArchetype, archetype);
    if (card.delta !== 0 && !BASIC_ENERGY_NAMES.has(card.name)) {
      cards.push(card);
    }
  }
  const byDelta = (a: WeeklyDeckCard, b: WeeklyDeckCard) => b.delta - a.delta || a.name.localeCompare(b.name);
  return {
    base: archetype.base,
    displayName: archetype.displayName,
    lists: archetype.lists.period[RECENT],
    priorLists: archetype.lists.period[PRIOR],
    added: cards
      .filter(c => c.delta > 0)
      .sort(byDelta)
      .slice(0, s.deckCardLimit),
    cut: cards
      .filter(c => c.delta < 0)
      .sort((a, b) => byDelta(b, a))
      .slice(0, s.deckCardLimit)
  };
}

function buildDecks(ctx: Ctx, archetypes: WeeklyArchetype[]): WeeklyDeck[] {
  const { tallies, s } = ctx;
  const decks: WeeklyDeck[] = [];
  for (const row of archetypes) {
    const archetype = tallies.archetypes.get(row.base);
    if (!archetype || row.lists < s.minDeckLists || row.priorLists < s.minDeckLists) {
      continue;
    }
    decks.push(buildDeck(ctx, archetype));
    if (decks.length >= s.deckLimit) {
      break;
    }
  }
  return decks;
}

/** Shift-share attribution of one card's change across the archetypes that play it. */
function attribute(card: CardTally, tallies: Tallies, s: Settings): WeeklyMoverDriver[] {
  const total = tallies.total.lists.period;
  const drivers: WeeklyMoverDriver[] = [];
  for (const [base, lists] of card.byArchetype) {
    const archetype = tallies.archetypes.get(base);
    if (!archetype) {
      continue;
    }
    const shareRecent = total[RECENT] ? (100 * archetype.lists.period[RECENT]) / total[RECENT] : 0;
    const sharePrior = total[PRIOR] ? (100 * archetype.lists.period[PRIOR]) / total[PRIOR] : 0;
    const withinRecent = archetype.lists.period[RECENT] ? lists[RECENT] / archetype.lists.period[RECENT] : 0;
    const withinPrior = archetype.lists.period[PRIOR] ? lists[PRIOR] / archetype.lists.period[PRIOR] : 0;
    const mix = ((shareRecent - sharePrior) * (withinRecent + withinPrior)) / 2;
    const adoption = ((shareRecent + sharePrior) / 2) * (withinRecent - withinPrior);
    drivers.push({
      base,
      displayName: archetype.displayName,
      total: round1(mix + adoption),
      mix: round1(mix),
      adoption: round1(adoption)
    });
  }
  drivers.sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  return drivers.slice(0, s.driverLimit);
}

/**
 * Cards from one set with the same presence on every day of the window are one
 * signal: an evolution line moves together. Keep the highest-numbered
 * printing, which for a line is its final stage.
 */
function collapseLines(cards: CardTally[]): CardTally[] {
  const bySignature = new Map<string, CardTally>();
  const rank = (card: CardTally) => Number(String(card.number ?? '').replace(/\D/g, '')) || -1;
  for (const card of cards) {
    const signature = `${card.set ?? ''}|${card.lists.day.join(',')}|${card.lists.period.join(',')}`;
    const current = bySignature.get(signature);
    if (!current || rank(card) > rank(current)) {
      bySignature.set(signature, card);
    }
  }
  return [...bySignature.values()];
}

function moverOf(card: CardTally, tallies: Tallies, s: Settings): WeeklyMover {
  const total = tallies.total.lists.period;
  const share = pctOf(card.lists.period[RECENT], total[RECENT]);
  const priorShare = pctOf(card.lists.period[PRIOR], total[PRIOR]);
  const drivers = attribute(card, tallies, s);
  const mix = drivers.reduce((sum, d) => sum + d.mix, 0);
  const adoption = drivers.reduce((sum, d) => sum + d.adoption, 0);
  return {
    uid: card.uid,
    name: card.name,
    set: card.set,
    number: card.number,
    share,
    priorShare,
    delta: round1(share - priorShare),
    mix: round1(mix),
    adoption: round1(adoption),
    drivers
  };
}

function buildMovers(tallies: Tallies, s: Settings): WeeklyReport['movers'] {
  const eligible = [...tallies.cards.values()].filter(
    card =>
      card.lists.period[RECENT] + card.lists.period[PRIOR] >= s.minMoverLists && !BASIC_ENERGY_NAMES.has(card.name)
  );
  const movers = collapseLines(eligible)
    .map(card => moverOf(card, tallies, s))
    .filter(m => m.delta !== 0);
  const rising = movers
    .filter(m => m.delta > 0)
    .sort((a, b) => b.delta - a.delta || a.name.localeCompare(b.name))
    .slice(0, s.moverLimit);
  const falling = movers
    .filter(m => m.delta < 0)
    .sort((a, b) => a.delta - b.delta || a.name.localeCompare(b.name))
    .slice(0, s.moverLimit);
  return { rising, falling };
}

function periodOf(tallies: Tallies, index: 0 | 1, s: Settings) {
  const end = s.endMs - index * s.days * DAY_MS;
  return {
    start: dayKey(end - s.days * DAY_MS),
    end: dayKey(end),
    lists: tallies.total.lists.period[index],
    top10: tallies.total.top10.period[index]
  };
}

/**
 * Build the weekly report from the decks of the trends window.
 * @param decks - Placed lists with a tournament date, an archetype, success tags and cards
 * @param options - Window end plus optional floors and limits
 * @returns The report; every list is empty when no deck falls inside the periods
 */
export function buildWeeklyReport(decks: TrendDeckInput[], options: BuildWeeklyReportOptions): WeeklyReport {
  const s = settingsFrom(options);
  const tallies: Tallies = {
    total: { lists: new Tally(s.dailyDays), top10: new Tally(s.dailyDays) },
    archetypes: new Map(),
    cards: new Map()
  };
  const ctx: Ctx = { tallies, s, synonymDb: options.synonymDb ?? null };
  tallyDecks(ctx, Array.isArray(decks) ? decks : []);
  const dates = datesOf(s);
  const archetypes = buildArchetypes(tallies, dates, s);
  return {
    generatedAt: new Date(options.now ?? Date.now()).toISOString(),
    days: s.days,
    recent: periodOf(tallies, RECENT, s),
    prior: periodOf(tallies, PRIOR, s),
    dates,
    dailyTotals: dates.map((date, i) => ({
      date,
      lists: tallies.total.lists.day[i],
      top10: tallies.total.top10.day[i]
    })),
    archetypes,
    decks: buildDecks(ctx, archetypes),
    movers: buildMovers(tallies, s)
  };
}

/** The report's newest complete day as one history row. */
function historyRow(report: WeeklyReport): TrendHistoryDay | null {
  const last = report.dailyTotals[report.dailyTotals.length - 1];
  if (!last || last.lists === 0) {
    return null;
  }
  const archetypes: TrendHistoryDay['archetypes'] = {};
  for (const archetype of report.archetypes) {
    const point = archetype.daily[archetype.daily.length - 1];
    if (point && point.lists > 0) {
      archetypes[archetype.base] = { displayName: archetype.displayName, lists: point.lists, top10: point.top10 };
    }
  }
  return { date: last.date, lists: last.lists, top10: last.top10, archetypes };
}

/**
 * Append the report's newest day to the rolling history. A day already present
 * is replaced (a rerun refreshes it), and rows stay sorted by date. The input
 * is not mutated.
 * @param history - The stored ledger, or null on the first run
 * @param report - The weekly report just built
 * @returns The ledger to store
 */
export function appendTrendHistory(history: TrendHistory | null, report: WeeklyReport): TrendHistory {
  const row = historyRow(report);
  const days = (history?.days ?? []).filter(day => day.date !== row?.date);
  if (row) {
    days.push(row);
  }
  days.sort((a, b) => a.date.localeCompare(b.date));
  return { schemaVersion: 1, generatedAt: report.generatedAt, days };
}
