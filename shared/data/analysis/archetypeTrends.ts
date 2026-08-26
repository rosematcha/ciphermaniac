import { aggregateCanonicalCardsPerDeck } from '../../canonicalDeckCards';
import { SUCCESS_TAG_NAMES } from '../contracts';
import type { SynonymDatabase } from '../../synonyms';

// Performance tiers = the synthetic `all` aggregate plus every placement/percent
// tag emitted by the one frozen SUCCESS_TAG_POLICY (phase2/topcut are Labs-only
// and never surface in online trends). Sourced from SUCCESS_TAG_NAMES so this
// taxonomy cannot drift from the policy.
const SUCCESS_TAGS = ['all', ...SUCCESS_TAG_NAMES] as const;
type SuccessTag = (typeof SUCCESS_TAGS)[number];

type TierTotals = Record<SuccessTag, number>;

interface DayEntry {
  date: string;
  tournamentIds: string[];
  totals: TierTotals;
}

interface WeekEntry {
  weekStart: string;
  weekEnd: string;
  tournamentIds: string[];
  totals: TierTotals;
}

interface TierCounts {
  counts: number[];
  decksWithCard: number;
}

interface CardClassificationStats {
  currentPlayrate: number;
  playrateChange: number;
  volatility: number;
  avgPlayrate: number;
  startPlayrate: number;
}

interface CardInterestStats {
  maxShare: number;
  startShare: number;
  endShare: number;
}

/** One opponent's aggregated record in a {@link buildMatchupMatrix} result. */
export interface MatchupRecord {
  opponent: string;
  wins: number;
  losses: number;
  ties: number;
  total: number;
  winRate: number;
}

/**
 * One raw match from a tournament's pairing sheet. `winner` is the Labs
 * convention: `0` = tie, `-1` = double loss, otherwise the winning player's
 * identifier (matched against {@link PairingMatch.player1}/`player2`).
 */
export interface PairingMatch {
  player1: string;
  player2?: string | null;
  winner: number | string;
}

/** A player's standing, carrying the deck (archetype) they registered. */
export interface Standing {
  player: string;
  deck?: { name?: string };
}

/** One tournament's pairing sheet plus the standings that name each player's deck. */
export interface PairingData {
  tournamentId?: string;
  pairings?: PairingMatch[];
  standings?: Standing[];
}

/** A single card line within a {@link Deck}. */
export interface DeckCard {
  name: string;
  set?: string;
  number?: string;
  count?: number;
}

/** A deck belonging to an archetype window, tagged with its placement successes. */
export interface Deck {
  tournamentId: string;
  successTags?: string[];
  cards?: DeckCard[];
}

/** A tournament in the trend window; `date` bounds the day/week bucketing. */
export interface Tournament {
  id: string;
  date: string;
}

type SynonymDb = SynonymDatabase;

/** Optional matchup inputs for {@link generateArchetypeTrends}. */
export interface TrendOptions {
  pairingsData?: PairingData[];
  archetypeName?: string | null;
}

interface CopyTrendEntry {
  avg: number;
  mode: number;
  dist: number[];
}

interface TierData {
  count: number;
  avg: number;
  mode: number;
  dist: number[];
}

interface CardTrendData {
  name: string;
  set: string | null;
  number: string | null;
  category: string;
  currentPlayrate: number;
  currentAvgCopies: number;
  currentModeCopies: number;
  playrateChange: number;
  copiesChange: number;
  volatility: number;
  timeline: Record<number, Record<string, TierData>>;
  copyTrend: CopyTrendEntry[];
}

interface FlexSlot {
  uid: string;
  variance: number;
  copyRange: [number, number];
}

interface RiserFaller {
  uid: string;
  delta: number;
  from: number;
  to: number;
}

interface Substitution {
  cardA: string;
  cardB: string;
  correlation: number;
}

interface Insights {
  coreCards: string[];
  flexSlots: FlexSlot[];
  risers: RiserFaller[];
  fallers: RiserFaller[];
  substitutions: Substitution[];
}

export interface TrendReport {
  meta: {
    generatedAt: string;
    tournamentCount: number;
    cardCount: number;
    dayCount: number;
    weekCount: number;
    windowStart?: string;
    windowEnd?: string;
  };
  days: Array<{ date: string; tournamentIds: string[]; totals: TierTotals }>;
  weeks: Array<{ weekStart: string; weekEnd: string; tournamentIds: string[]; totals: TierTotals }>;
  cards: Record<string, CardTrendData>;
  insights: Insights;
  matchups: Record<string, MatchupRecord>;
}

// Threshold for a card to be included in the trend report
const MIN_PEAK_SHARE_PERCENT = 5.0;

// Thresholds for detecting "interesting" cards (rising or falling significantly)
const INTERESTING_START_SHARE = 10.0;
const INTERESTING_END_SHARE = 1.0;
const INTERESTING_RISE_DELTA = 8.0;

// Thresholds for card classification
const CORE_PLAYRATE_THRESHOLD = 90; // 90%+ playrate = core
const STAPLE_PLAYRATE_THRESHOLD = 70; // 70-90% = staple
const FLEX_VOLATILITY_THRESHOLD = 15; // High variance in playrate = flex
const TECH_PLAYRATE_MAX = 30; // <30% but consistent = tech
const RISING_DELTA_THRESHOLD = 15; // +15% = rising
const FALLING_DELTA_THRESHOLD = -15; // -15% = falling

// Correlation threshold for substitution detection
const SUBSTITUTION_THRESHOLD = -0.5;

// Below this average playrate a card's series is mostly zeroes, so its
// correlation with another card is noise rather than a shared deck slot.
const SUBSTITUTION_MIN_PLAYRATE = 15;

// Minimum matches for matchup to be statistically meaningful
const MIN_MATCHUP_GAMES = 3;

/**
 * Gets the ISO date string (YYYY-MM-DD) for a given date
 * @param {Date} date
 * @returns {string} ISO date string
 */
function getDateString(date: Date | string | number): string {
  const dt = new Date(date);
  dt.setHours(0, 0, 0, 0);
  return dt.toISOString().split('T')[0];
}

/**
 * Gets the ISO week start date (Monday) for a given date
 * @param {Date} date
 * @returns {string} ISO date string of Monday of that week
 */
function getWeekStart(date: Date | string | number): string {
  const weekDate = new Date(date);
  const day = weekDate.getDay();
  const diff = weekDate.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Sunday
  weekDate.setDate(diff);
  weekDate.setHours(0, 0, 0, 0);
  return weekDate.toISOString().split('T')[0];
}

/**
 * Gets the week end date (Sunday) for a given week start
 * @param {string} weekStart - ISO date string of Monday
 * @returns {string} ISO date string of Sunday
 */
function getWeekEnd(weekStart: string): string {
  const endDate = new Date(weekStart);
  endDate.setDate(endDate.getDate() + 6);
  return endDate.toISOString().split('T')[0];
}

/**
 * Calculates the mode (most common value) from an array of numbers
 * @param {number[]} arr
 * @returns {number}
 */
function calculateMode(arr: number[]): number {
  if (!arr.length) {
    return 0;
  }
  const freq: Record<number, number> = {};
  let maxFreq = 0;
  let mode = arr[0];
  for (const val of arr) {
    freq[val] = (freq[val] || 0) + 1;
    if (freq[val] > maxFreq) {
      maxFreq = freq[val];
      mode = val;
    }
  }
  return mode;
}

/**
 * Calculates standard deviation
 * @param {number[]} arr
 * @returns {number}
 */
function calculateStdDev(arr: number[]): number {
  if (arr.length < 2) {
    return 0;
  }
  const mean = arr.reduce((acc, val) => acc + val, 0) / arr.length;
  const squaredDiffs = arr.map((num: number) => (num - mean) ** 2);
  const variance = squaredDiffs.reduce((acc, val) => acc + val, 0) / arr.length;
  return Math.sqrt(variance);
}

/**
 * Calculates Pearson correlation coefficient between two arrays
 * @param {number[]} x
 * @param {number[]} y
 * @returns {number} Correlation coefficient (-1 to 1)
 */
function calculateCorrelation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length < 3) {
    return 0;
  }

  const lengthCount = x.length;
  const meanX = x.reduce((acc, val) => acc + val, 0) / lengthCount;
  const meanY = y.reduce((acc, val) => acc + val, 0) / lengthCount;

  let numerator = 0;
  let denomX = 0;
  let denomY = 0;

  for (let idx = 0; idx < lengthCount; idx++) {
    const dx = x[idx] - meanX;
    const dy = y[idx] - meanY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }

  const denominator = Math.sqrt(denomX * denomY);
  if (denominator === 0) {
    return 0;
  }

  return numerator / denominator;
}

/**
 * Classifies a card based on its usage patterns
 * @param {Object} stats - Card statistics
 * @returns {string} Category: "core" | "staple" | "flex" | "tech" | "emerging" | "fading"
 */
function classifyCard(stats: CardClassificationStats): string {
  const { currentPlayrate, playrateChange, volatility, avgPlayrate } = stats;

  // Rising significantly from low base
  if (playrateChange >= RISING_DELTA_THRESHOLD && avgPlayrate < STAPLE_PLAYRATE_THRESHOLD) {
    return 'emerging';
  }

  // Falling significantly from high base
  if (playrateChange <= FALLING_DELTA_THRESHOLD && stats.startPlayrate >= STAPLE_PLAYRATE_THRESHOLD) {
    return 'fading';
  }

  // High and consistent playrate
  if (currentPlayrate >= CORE_PLAYRATE_THRESHOLD && volatility < FLEX_VOLATILITY_THRESHOLD) {
    return 'core';
  }

  // Moderately high playrate
  if (currentPlayrate >= STAPLE_PLAYRATE_THRESHOLD) {
    return 'staple';
  }

  // High variance = flex slot
  if (volatility >= FLEX_VOLATILITY_THRESHOLD && avgPlayrate >= 20) {
    return 'flex';
  }

  // Low but consistent usage
  if (currentPlayrate < TECH_PLAYRATE_MAX && volatility < FLEX_VOLATILITY_THRESHOLD) {
    return 'tech';
  }

  // Default to flex for anything else with meaningful playrate
  if (avgPlayrate >= 10) {
    return 'flex';
  }

  return 'tech';
}

/**
 * Determines if a card is "interesting" enough to include in the trend report.
 * @param {Object} cardStats
 * @returns {boolean}
 */
function isInterestingCard(cardStats: CardInterestStats): boolean {
  const { maxShare, startShare, endShare } = cardStats;

  if (maxShare >= MIN_PEAK_SHARE_PERCENT) {
    return true;
  }

  if (startShare >= INTERESTING_START_SHARE && endShare <= INTERESTING_END_SHARE) {
    return true;
  }

  const delta = endShare - startShare;
  if (delta >= INTERESTING_RISE_DELTA) {
    return true;
  }

  return false;
}

/** A matchup record still being accumulated, before win rate is derived. */
interface MatchupTally {
  opponent: string;
  wins: number;
  losses: number;
  ties: number;
  total: number;
}

/** Which players brought which deck, from a tournament's standings. */
function playerDeckMap(standings: Standing[]): Map<string, string> {
  const playerDecks = new Map<string, string>();
  for (const standing of standings) {
    if (standing.player && standing.deck?.name) {
      playerDecks.set(standing.player, standing.deck.name);
    }
  }
  return playerDecks;
}

/**
 * The target archetype's result in one match, from the perspective of whichever
 * side it was on.
 *
 * `mirror` is its own outcome rather than a win or a loss: with the target on
 * both sides there is no directional signal, and attributing the win to
 * whoever happens to be `player1` would bias the rate by pairing order.
 */
type MatchResult = 'tie' | 'mirror' | 'win' | 'loss';

function resolveMatchResult(match: PairingMatch, isPlayer1Target: boolean, isPlayer2Target: boolean): MatchResult {
  if (match.winner === 0) {
    return 'tie';
  }
  if (isPlayer1Target && isPlayer2Target) {
    return 'mirror';
  }
  if (match.winner === -1) {
    // Double loss counts as a loss for both sides.
    return 'loss';
  }
  const targetWon =
    (isPlayer1Target && match.winner === match.player1) || (isPlayer2Target && match.winner === match.player2);
  return targetWon ? 'win' : 'loss';
}

/**
 * Credit one pairing to the running tallies, if it involves the target
 * archetype and both decks are identifiable. Byes (no player2) and matches
 * between two other archetypes are skipped.
 */
function creditMatch(
  matchups: Map<string, MatchupTally>,
  targetArchetype: string,
  match: PairingMatch,
  playerDecks: Map<string, string>
): void {
  if (!match.player2) {
    return;
  }
  const deck1 = playerDecks.get(match.player1);
  const deck2 = playerDecks.get(match.player2);
  if (!deck1 || !deck2) {
    return;
  }

  const isPlayer1Target = deck1 === targetArchetype;
  const isPlayer2Target = deck2 === targetArchetype;
  if (!isPlayer1Target && !isPlayer2Target) {
    return;
  }

  // Mirrors keep their self-keyed entry — the frontend derives its "(mirror)"
  // row and match count from it — but are recorded symmetrically below.
  const opponentArchetype = isPlayer1Target ? deck2 : deck1;
  if (!matchups.has(opponentArchetype)) {
    matchups.set(opponentArchetype, { opponent: opponentArchetype, wins: 0, losses: 0, ties: 0, total: 0 });
  }

  const tally = matchups.get(opponentArchetype)!;
  tally.total += 1;
  const result = resolveMatchResult(match, isPlayer1Target, isPlayer2Target);
  if (result === 'tie') {
    tally.ties += 1;
  } else if (result === 'win') {
    tally.wins += 1;
  } else if (result === 'loss') {
    tally.losses += 1;
  }
  // 'mirror' adds only to `total`; wins/losses are split evenly at finalize.
}

/**
 * Turn a tally into its published record. A mirror's decisive games are split
 * evenly so the record does not depend on pairing order, and its win rate is
 * definitionally 50.
 */
function finalizeMatchup(tally: MatchupTally, isMirror: boolean): MatchupRecord {
  if (!isMirror) {
    return {
      opponent: tally.opponent,
      wins: tally.wins,
      losses: tally.losses,
      ties: tally.ties,
      total: tally.total,
      // Percentage (0-100), not a decimal.
      winRate: tally.total > 0 ? Math.round((tally.wins / tally.total) * 1000) / 10 : 0
    };
  }
  const decisive = tally.total - tally.ties;
  const wins = Math.floor(decisive / 2);
  return {
    opponent: tally.opponent,
    wins,
    losses: decisive - wins,
    ties: tally.ties,
    total: tally.total,
    winRate: 50
  };
}

/**
 * Build a matchup matrix for one archetype from a set of tournaments' pairing
 * sheets, keyed by opponent archetype. Opponents seen fewer than
 * {@link MIN_MATCHUP_GAMES} times are dropped as statistically meaningless.
 * @param targetArchetype - The archetype we are generating trends for
 * @param allPairings - Per-tournament pairing sheets with the standings that name each deck
 * @returns Matchup records keyed by opponent archetype
 */
export function buildMatchupMatrix(targetArchetype: string, allPairings: PairingData[]): Record<string, MatchupRecord> {
  if (!allPairings || !allPairings.length) {
    return {};
  }

  const matchups = new Map<string, MatchupTally>();
  for (const { pairings, standings } of allPairings) {
    if (!pairings || !standings) {
      continue;
    }
    const playerDecks = playerDeckMap(standings);
    for (const match of pairings) {
      creditMatch(matchups, targetArchetype, match, playerDecks);
    }
  }

  const result: Record<string, MatchupRecord> = {};
  for (const [opponent, tally] of matchups.entries()) {
    if (tally.total >= MIN_MATCHUP_GAMES) {
      result[opponent] = finalizeMatchup(tally, opponent === targetArchetype);
    }
  }
  return result;
}

// ============================================================================
// Trend report assembly
//
// generateArchetypeTrends used to do all six of these stages in one body. They
// are separated here along the boundaries the original comments already named,
// because each stage has a genuinely different job and only the last two need
// to see more than one card at a time.
// ============================================================================

/** A zeroed per-tier deck counter. */
function emptyTierTotals(): TierTotals {
  const totals = {} as TierTotals;
  for (const tag of SUCCESS_TAGS) {
    totals[tag] = 0;
  }
  return totals;
}

/**
 * The report returned when there is nothing to report — no decks, or no
 * tournament day any deck could be attributed to. Both callers below need it,
 * and the two must stay identical: a consumer that special-cased one shape
 * would silently mis-render the other.
 */
function emptyTrendReport(): TrendReport {
  return {
    meta: {
      generatedAt: new Date().toISOString(),
      tournamentCount: 0,
      cardCount: 0,
      dayCount: 0,
      weekCount: 0
    },
    days: [],
    weeks: [],
    cards: {},
    insights: {
      coreCards: [],
      flexSlots: [],
      risers: [],
      fallers: [],
      substitutions: []
    },
    matchups: {}
  };
}

/** Mean of `counts`, rounded to two decimal places. */
function roundedMean(counts: number[]): number {
  return Math.round((counts.reduce((acc, val) => acc + val, 0) / counts.length) * 100) / 100;
}

/**
 * Copy-count distribution as `[0 copies, 1, 2, 3, 4+]`. The zero bucket is the
 * decks in the tier that did NOT play the card, so it is passed in rather than
 * derived — `counts` only describes the decks that did.
 */
function copyDistribution(counts: number[], decksWithoutCard: number): number[] {
  const dist = [decksWithoutCard, 0, 0, 0, 0];
  for (const copyCount of counts) {
    if (copyCount >= 4) {
      dist[4] += 1;
    } else if (copyCount >= 1) {
      dist[copyCount] += 1;
    }
  }
  return dist;
}

/** One tier's cell of a timeline: how many decks, how many copies, spread. */
function buildTierData(counts: number[], tierTotal: number, count = counts.length): TierData {
  return {
    count,
    avg: roundedMean(counts),
    mode: calculateMode(counts),
    dist: copyDistribution(counts, tierTotal - counts.length)
  };
}

/** Day and week buckets, plus the lookups from a tournament to each. */
interface TournamentBuckets {
  dayMap: Map<string, DayEntry>;
  weekMap: Map<string, WeekEntry>;
  tournamentToDay: Map<string, string>;
  tournamentToWeek: Map<string, string>;
}

/**
 * Stage 1 — group tournaments into day and week buckets.
 *
 * Days are the real granularity; weeks are kept alongside them because the
 * published report has carried a weekly series since before daily existed and
 * consumers still read it.
 */
function bucketTournaments(tournaments: Tournament[]): TournamentBuckets {
  const buckets: TournamentBuckets = {
    dayMap: new Map(),
    weekMap: new Map(),
    tournamentToDay: new Map(),
    tournamentToWeek: new Map()
  };

  for (const tournament of tournaments) {
    const tournamentDate = new Date(tournament.date);
    const dateStr = getDateString(tournamentDate);
    const weekStart = getWeekStart(tournamentDate);

    buckets.tournamentToDay.set(tournament.id, dateStr);
    buckets.tournamentToWeek.set(tournament.id, weekStart);

    if (!buckets.dayMap.has(dateStr)) {
      buckets.dayMap.set(dateStr, { date: dateStr, tournamentIds: [], totals: emptyTierTotals() });
    }
    buckets.dayMap.get(dateStr)!.tournamentIds.push(tournament.id);

    if (!buckets.weekMap.has(weekStart)) {
      buckets.weekMap.set(weekStart, {
        weekStart,
        weekEnd: getWeekEnd(weekStart),
        tournamentIds: [],
        totals: emptyTierTotals()
      });
    }
    buckets.weekMap.get(weekStart)!.tournamentIds.push(tournament.id);
  }

  return buckets;
}

/** Per-card day-by-day counts, plus the display metadata for each card. */
interface CardAggregate {
  cardDayData: Map<string, Map<string, Record<SuccessTag, TierCounts>>>;
  cardMeta: Map<string, { name: string; set: string | null; number: string | null }>;
}

/**
 * Add one deck's tier membership to its day and week totals. Takes the buckets
 * and resolves the two entries itself, so the counters it bumps are its own
 * locals rather than caller-owned objects it reaches into.
 */
function creditDeckToTotals(deck: Deck, buckets: TournamentBuckets, dateStr: string, weekStart: string): void {
  const dayData = buckets.dayMap.get(dateStr)!;
  const weekData = buckets.weekMap.get(weekStart)!;
  dayData.totals.all += 1;
  weekData.totals.all += 1;
  const tags = new Set(deck.successTags || []);
  for (const tag of SUCCESS_TAGS) {
    if (tag !== 'all' && tags.has(tag)) {
      dayData.totals[tag] = (dayData.totals[tag] || 0) + 1;
      weekData.totals[tag] = (weekData.totals[tag] || 0) + 1;
    }
  }
}

/** The per-tier counter bucket for one card on one day, created on first touch. */
function tierCountsFor(
  cardDayData: CardAggregate['cardDayData'],
  uid: string,
  dateStr: string
): Record<SuccessTag, TierCounts> {
  if (!cardDayData.has(uid)) {
    cardDayData.set(uid, new Map());
  }
  const cardDays = cardDayData.get(uid)!;
  if (!cardDays.has(dateStr)) {
    const freshEntry = {} as Record<SuccessTag, TierCounts>;
    for (const tag of SUCCESS_TAGS) {
      freshEntry[tag] = { counts: [], decksWithCard: 0 };
    }
    cardDays.set(dateStr, freshEntry);
  }
  return cardDays.get(dateStr)!;
}

/**
 * Stage 2 — walk every deck once, crediting it to its day/week totals and
 * recording its cards' copy counts per day and tier.
 *
 * Mutates the totals inside `buckets`, which is why it runs before any read of
 * them. Cards are aggregated to a canonical UID per deck FIRST: duplicate
 * printings that a synonym mapping collapses to the same UID must count once
 * per deck, or decksWithCard climbs above totalDecks and yields playrates over
 * 100% and negative zero-copy buckets.
 */
function aggregateDecksByDay(decks: Deck[], buckets: TournamentBuckets, synonymDb: SynonymDb | null): CardAggregate {
  const cardDayData: CardAggregate['cardDayData'] = new Map();
  const cardMeta: CardAggregate['cardMeta'] = new Map();

  for (const deck of decks) {
    const dateStr = buckets.tournamentToDay.get(deck.tournamentId);
    const weekStart = buckets.tournamentToWeek.get(deck.tournamentId);
    if (!dateStr || !weekStart) {
      continue;
    }

    creditDeckToTotals(deck, buckets, dateStr, weekStart);

    const deckTags = new Set<string>(['all', ...(deck.successTags || [])]);
    for (const { uid, name, set, number, copies } of aggregateCanonicalCardsPerDeck(deck.cards, synonymDb).values()) {
      if (!cardMeta.has(uid)) {
        cardMeta.set(uid, { name, set, number });
      }
      const dayEntry = tierCountsFor(cardDayData, uid, dateStr);
      for (const tag of SUCCESS_TAGS) {
        if (deckTags.has(tag)) {
          dayEntry[tag].counts.push(copies);
          dayEntry[tag].decksWithCard += 1;
        }
      }
    }
  }

  return { cardDayData, cardMeta };
}

/** One card's day-by-day series, before it is classified and trimmed. */
interface DailySeries {
  playrates: number[];
  copies: number[];
  timeline: Record<number, Record<string, TierData>>;
  copyTrend: CopyTrendEntry[];
  maxShare: number;
}

/**
 * Stage 3a — one card's daily timeline across every active day.
 *
 * Days on which the card did not appear are recorded as explicit zeroes rather
 * than skipped, so the series stays index-aligned with `activeDays` and a card
 * that vanishes on the last day reports a playrate of 0 rather than its last
 * non-zero value.
 */
function buildDailySeries(
  daysData: Map<string, Record<SuccessTag, TierCounts>>,
  activeDays: DayEntry[],
  dayIndex: Map<string, number>
): DailySeries {
  const series: DailySeries = { playrates: [], copies: [], timeline: {}, copyTrend: [], maxShare: 0 };

  for (const dayItem of activeDays) {
    const entry = daysData.get(dayItem.date);
    if (!entry || !entry.all || entry.all.counts.length === 0) {
      series.playrates.push(0);
      series.copies.push(0);
      series.copyTrend.push({ avg: 0, mode: 0, dist: [0, 0, 0, 0] });
      continue;
    }

    const { counts } = entry.all;
    const totalDecks = dayItem.totals.all;
    const playrate = totalDecks > 0 ? (counts.length / totalDecks) * 100 : 0;
    const avg = roundedMean(counts);

    series.playrates.push(playrate);
    series.copies.push(avg);
    series.maxShare = Math.max(series.maxShare, playrate);

    const tierEntry: Record<string, TierData> = {};
    for (const tag of SUCCESS_TAGS) {
      if (entry[tag] && entry[tag].counts.length > 0) {
        tierEntry[tag] = buildTierData(entry[tag].counts, dayItem.totals[tag] || 0);
      }
    }
    series.timeline[dayIndex.get(dayItem.date)!] = tierEntry;

    // The trend viz plots 1..4+ only, so the zero-copy bucket is dropped here.
    series.copyTrend.push({ avg, mode: calculateMode(counts), dist: copyDistribution(counts, 0).slice(1) });
  }

  return series;
}

/**
 * Stage 3b — turn one card's series into its published trend record, or null
 * when the card is too flat to be worth publishing.
 *
 * Start and end playrates are read off the fully-filled daily array (zeroes
 * included) rather than off the days the card happened to appear, so a card
 * that drops out reports the fall rather than hiding it.
 */
function buildCardTrend(
  meta: { name: string; set: string | null; number: string | null },
  series: DailySeries
): CardTrendData | null {
  const { playrates, copies, copyTrend } = series;
  const startPlayrate = playrates.length > 0 ? playrates[0] : 0;
  const endPlayrate = playrates.length > 0 ? playrates[playrates.length - 1] : 0;

  if (!isInterestingCard({ maxShare: series.maxShare, startShare: startPlayrate, endShare: endPlayrate })) {
    return null;
  }

  const avgPlayrate = playrates.length > 0 ? playrates.reduce((acc, val) => acc + val, 0) / playrates.length : 0;
  const playrateChange = endPlayrate - startPlayrate;
  const volatility = calculateStdDev(playrates);

  const firstCopies = copies.find(copiesValue => copiesValue > 0) ?? 0;
  const lastCopies =
    copies
      .slice()
      .reverse()
      .find(copiesValue => copiesValue > 0) ?? 0;

  const lastValidCopy = copyTrend
    .slice()
    .reverse()
    .find(copyEntry => copyEntry.avg > 0);

  return {
    name: meta.name,
    set: meta.set,
    number: meta.number,
    category: classifyCard({ currentPlayrate: endPlayrate, playrateChange, volatility, avgPlayrate, startPlayrate }),
    currentPlayrate: Math.round(endPlayrate * 10) / 10,
    currentAvgCopies: lastValidCopy?.avg ?? 0,
    currentModeCopies: lastValidCopy?.mode ?? 0,
    playrateChange: Math.round(playrateChange * 10) / 10,
    copiesChange: Math.round((lastCopies - firstCopies) * 100) / 100,
    volatility: Math.round(volatility * 10) / 10,
    timeline: series.timeline,
    copyTrend
  };
}

/** A rising/falling entry, whose `from` is recovered from the delta. */
function movement(uid: string, card: CardTrendData) {
  return {
    uid,
    delta: card.playrateChange,
    from: Math.round((card.currentPlayrate - card.playrateChange) * 10) / 10,
    to: card.currentPlayrate
  };
}

/**
 * Stage 4 — derive the insight lists from the finished card trends, sorted by
 * magnitude and capped so the published report cannot balloon on a wide meta.
 */
function buildInsights(finalCards: Record<string, CardTrendData>): Insights {
  const insights: Insights = { coreCards: [], flexSlots: [], risers: [], fallers: [], substitutions: [] };

  for (const uid of Object.keys(finalCards)) {
    const card = finalCards[uid];
    if (card.category === 'core') {
      insights.coreCards.push(uid);
    }
    if (card.category === 'flex') {
      const modes = card.copyTrend.filter(copyEntry => copyEntry.avg > 0).map(copyEntry => copyEntry.mode);
      const copyRange: [number, number] = [Math.min(...modes), Math.max(...modes)];
      insights.flexSlots.push({
        uid,
        variance: card.volatility,
        copyRange: isFinite(copyRange[0]) ? copyRange : [0, 0]
      });
    }
    if (card.category === 'emerging' || card.playrateChange >= RISING_DELTA_THRESHOLD) {
      insights.risers.push(movement(uid, card));
    }
    if (card.category === 'fading' || card.playrateChange <= FALLING_DELTA_THRESHOLD) {
      insights.fallers.push(movement(uid, card));
    }
  }

  insights.risers.sort((first, second) => second.delta - first.delta);
  insights.fallers.sort((first, second) => first.delta - second.delta);
  insights.flexSlots.sort((first, second) => second.variance - first.variance);

  insights.risers = insights.risers.slice(0, 10);
  insights.fallers = insights.fallers.slice(0, 10);
  insights.flexSlots = insights.flexSlots.slice(0, 15);
  return insights;
}

/**
 * Stage 5 — pairs of cards whose playrates move against each other, which is
 * what a deck slot being swapped between two options looks like in aggregate.
 *
 * Restricted to cards averaging at least 15% playrate: below that the series is
 * mostly zeroes and the correlation is noise rather than signal.
 */
function findSubstitutions(cardUids: string[], timelines: Map<string, number[]>): Insights['substitutions'] {
  const significant = cardUids.filter(uid => {
    const timeline = timelines.get(uid);
    const avg = timeline ? timeline.reduce((acc, val) => acc + val, 0) / timeline.length : 0;
    return avg >= SUBSTITUTION_MIN_PLAYRATE;
  });

  const substitutions: Insights['substitutions'] = [];
  for (let iIndex = 0; iIndex < significant.length; iIndex++) {
    for (let jIndex = iIndex + 1; jIndex < significant.length; jIndex++) {
      const timelineA = timelines.get(significant[iIndex]);
      const timelineB = timelines.get(significant[jIndex]);
      if (!timelineA || !timelineB) {
        continue;
      }
      const correlation = calculateCorrelation(timelineA, timelineB);
      if (correlation <= SUBSTITUTION_THRESHOLD) {
        substitutions.push({
          cardA: significant[iIndex],
          cardB: significant[jIndex],
          correlation: Math.round(correlation * 100) / 100
        });
      }
    }
  }

  substitutions.sort((first, second) => first.correlation - second.correlation);
  return substitutions.slice(0, 10);
}

/**
 * Generates time-series trend data for a specific archetype with enhanced
 * insights, at DAILY granularity with a weekly roll-up alongside it.
 *
 * The six stages are the six helpers above, in order: bucket the tournaments,
 * aggregate the decks into them, build each card's timelines, derive the
 * insight lists, correlate for substitutions, and attach matchups.
 * @param decks - List of decks for this archetype (must have successTags)
 * @param tournaments - List of tournaments in the window
 * @param synonymDb - Database for resolving card synonyms
 * @param options - Optional pairings data and archetype name for the matchup matrix
 * @returns Enhanced trend report with daily data, weekly roll-up and matchups
 */
export function generateArchetypeTrends(
  decks: Deck[],
  tournaments: Tournament[],
  synonymDb: SynonymDb | null,
  options?: TrendOptions
): TrendReport {
  const { pairingsData = [], archetypeName = null } = options || {};

  if (!decks || !decks.length) {
    return emptyTrendReport();
  }

  const sortedTournaments = [...tournaments].sort(
    (first, second) => Date.parse(String(first.date || 0)) - Date.parse(String(second.date || 0))
  );

  const buckets = bucketTournaments(sortedTournaments);
  const { cardDayData, cardMeta } = aggregateDecksByDay(decks, buckets, synonymDb);

  const activeDays = [...buckets.dayMap.values()]
    .filter(dayEntry => dayEntry.totals.all > 0)
    .sort((first, second) => first.date.localeCompare(second.date));
  const activeWeeks = [...buckets.weekMap.values()]
    .filter(weekEntry => weekEntry.totals.all > 0)
    .sort((first, second) => first.weekStart.localeCompare(second.weekStart));

  if (activeDays.length === 0) {
    return emptyTrendReport();
  }

  const dayIndex = new Map<string, number>(activeDays.map((dayItem, idx) => [dayItem.date, idx]));

  const finalCards: Record<string, CardTrendData> = {};
  const cardPlayrateTimelines = new Map<string, number[]>();

  for (const [uid, daysData] of cardDayData.entries()) {
    const series = buildDailySeries(daysData, activeDays, dayIndex);
    const card = buildCardTrend(cardMeta.get(uid)!, series);
    if (!card) {
      continue;
    }
    finalCards[uid] = card;
    cardPlayrateTimelines.set(uid, series.playrates);
  }

  const insights = buildInsights(finalCards);
  insights.substitutions = findSubstitutions(Object.keys(finalCards), cardPlayrateTimelines);

  const matchups: Record<string, MatchupRecord> =
    pairingsData.length > 0 && archetypeName ? buildMatchupMatrix(archetypeName, pairingsData) : {};

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      tournamentCount: sortedTournaments.length,
      cardCount: Object.keys(finalCards).length,
      dayCount: activeDays.length,
      weekCount: activeWeeks.length,
      windowStart: activeDays[0].date,
      windowEnd: activeDays[activeDays.length - 1].date
    },
    days: activeDays.map(dayItem => ({
      date: dayItem.date,
      tournamentIds: dayItem.tournamentIds,
      totals: dayItem.totals
    })),
    weeks: activeWeeks.map(weekItem => ({
      weekStart: weekItem.weekStart,
      weekEnd: weekItem.weekEnd,
      tournamentIds: weekItem.tournamentIds,
      totals: weekItem.totals
    })),
    cards: finalCards,
    insights,
    matchups
  };
}
