import { SUCCESS_TAG_NAMES } from '../data/contracts';
import { deriveArchetypeGrouping } from '../data/archetypes/build';
import { isGenericArchetypeName } from '../analysis/archetypeClassifier.js';
import { getCanonicalCard } from '../data/cardSynonyms.js';
import { cardUidOrName, parseCardUid } from '../data/cardIdentity';
import type {
  BuildCardTrendReportOptions,
  BuildTrendReportOptions,
  CardTrendItem,
  CardTrendsResult,
  TrendDeckInput,
  TrendReportResult,
  TrendSeriesEntry,
  TrendTournamentInput
} from './types';

const MIN_TREND_PLAYERS = 0;
const DEFAULT_MIN_TREND_APPEARANCES = 3;
const CARD_TREND_MIN_APPEARANCES = 2;
const DEFAULT_CARD_TREND_TOP = 12;

export function buildTrendReport(
  decks: TrendDeckInput[],
  tournaments: TrendTournamentInput[],
  options: BuildTrendReportOptions = {}
): TrendReportResult {
  const now = options.now ? new Date(options.now) : new Date();
  const windowStart = options.windowStart ? new Date(options.windowStart) : null;
  const windowEnd = options.windowEnd ? new Date(options.windowEnd) : now;
  const minAppearances = Math.max(
    1,
    Number.isFinite(options.minAppearances) ? Number(options.minAppearances) : DEFAULT_MIN_TREND_APPEARANCES
  );
  const seriesLimit = Number.isFinite(options.seriesLimit) ? Math.max(1, Number(options.seriesLimit)) : null;
  const minDayDecks = Math.max(0, Number(options.minDayDecks) || 0);

  const tournamentIndex = new Map();
  const sortedTournaments = (Array.isArray(tournaments) ? tournaments : [])
    .filter(tournament => tournament && tournament.id && (Number(tournament.players) || 0) >= MIN_TREND_PLAYERS)
    .map(tournament => ({
      ...tournament,
      date: tournament.date || null
    }))
    .sort((first, second) => Date.parse(String(first.date || 0)) - Date.parse(String(second.date || 0)));

  sortedTournaments.forEach(tournament => {
    tournamentIndex.set(tournament.id, {
      ...tournament,
      deckTotal: 0
    });
  });

  const archetypes = new Map();
  const successTagSet = new Set<string>(SUCCESS_TAG_NAMES);
  const deckList = Array.isArray(decks) ? decks : [];

  for (const deck of deckList) {
    const tournamentId = deck?.tournamentId;
    if (!tournamentId || !tournamentIndex.has(tournamentId)) {
      continue;
    }
    // This producer requires a lowercase `unknown` fallback.
    const { base } = deriveArchetypeGrouping(deck?.archetype || 'Unknown', 'lower', 'unknown');
    const displayName = deck?.archetype || 'Unknown';

    const archetype = archetypes.get(base) || {
      base,
      displayName,
      totalDecks: 0,
      timeline: new Map()
    };

    const tournamentMeta = tournamentIndex.get(tournamentId);
    tournamentMeta.deckTotal += 1;

    const timelineEntry = archetype.timeline.get(tournamentId) || {
      tournamentId,
      tournamentName: deck?.tournamentName || tournamentMeta?.name || 'Unknown Tournament',
      date: deck?.tournamentDate || tournamentMeta?.date || null,
      decks: 0,
      success: {}
    };

    timelineEntry.decks += 1;
    for (const tag of Array.isArray(deck?.successTags) ? deck.successTags : []) {
      if (!successTagSet.has(tag)) {
        continue;
      }
      timelineEntry.success[tag] = (timelineEntry.success[tag] || 0) + 1;
    }

    archetype.timeline.set(tournamentId, timelineEntry);
    archetype.totalDecks += 1;
    archetype.displayName = archetype.displayName || displayName;

    archetypes.set(base, archetype);
  }

  // Decks per calendar day across every archetype; days under the floor are
  // dropped from every timeline at once so the chart never plots them.
  const dayTotals = new Map<string, number>();
  for (const tournament of sortedTournaments) {
    const dateKey = tournament.date ? String(tournament.date).split('T')[0] : 'unknown';
    dayTotals.set(dateKey, (dayTotals.get(dateKey) || 0) + (tournamentIndex.get(tournament.id)?.deckTotal || 0));
  }
  const thinDays = new Set([...dayTotals].filter(([, total]) => total < minDayDecks).map(([date]) => date));

  const series: TrendSeriesEntry[] = [];
  archetypes.forEach(archetype => {
    // "Other" / "Unknown" is a bucket, not a deck; it has no page and no trend.
    if (isGenericArchetypeName(archetype.displayName)) {
      return;
    }
    const timeline = sortedTournaments.map(tournament => {
      const entry = archetype.timeline.get(tournament.id);
      const tournamentMeta = tournamentIndex.get(tournament.id);
      const totalDecks = tournamentMeta?.deckTotal || 0;

      if (entry) {
        const share = totalDecks ? Math.round((entry.decks / totalDecks) * 10000) / 100 : 0;
        return {
          ...entry,
          totalDecks,
          share
        };
      }

      // Backfill missing tournament
      return {
        tournamentId: tournament.id,
        tournamentName: tournament.name,
        date: tournament.date,
        decks: 0,
        totalDecks,
        share: 0,
        success: {}
      };
    });

    // Count actual appearances (tournaments where archetype had at least 1 deck)
    const appearances = timeline.filter(entry => (entry.decks || 0) > 0).length;
    if (appearances < minAppearances) {
      return;
    }

    const aggregateSuccess: Record<string, number> = {};
    for (const entry of timeline) {
      Object.entries(entry.success || {}).forEach(([tag, count]) => {
        aggregateSuccess[tag] = (aggregateSuccess[tag] || 0) + (Number(count) || 0);
      });
    }

    const shares = timeline.map(entry => entry.share || 0);
    const timelineDecks = timeline.reduce((sum, entry) => sum + (entry.decks || 0), 0);
    const timelineTotalDecks = timeline.reduce((sum, entry) => sum + (entry.totalDecks || 0), 0);
    // Weighted share across all tournaments in the window.
    const avgShare = timelineTotalDecks ? Math.round((timelineDecks / timelineTotalDecks) * 100 * 10) / 10 : 0;
    const maxShare = shares.length ? Math.max(...shares) : 0;
    const peakShare = maxShare; // Alias for clarity
    const minShare = shares.length ? Math.min(...shares) : 0;

    // Aggregate timeline by day (date) instead of by tournament
    const dailyData = new Map();
    for (const entry of timeline) {
      const dateKey = entry.date ? entry.date.split('T')[0] : 'unknown';
      if (!dailyData.has(dateKey)) {
        dailyData.set(dateKey, { decks: 0, totalDecks: 0 });
      }
      const day = dailyData.get(dateKey);
      day.decks += entry.decks || 0;
      day.totalDecks += entry.totalDecks || 0;
    }

    const dailyTimeline = Array.from(dailyData.entries())
      .filter(([date]) => !thinDays.has(date))
      .map(([date, data]) => ({
        date,
        decks: data.decks,
        totalDecks: data.totalDecks,
        share: data.totalDecks ? Math.round((data.decks / data.totalDecks) * 10000) / 100 : 0
      }))
      .sort((first, second) => first.date.localeCompare(second.date));

    series.push({
      base: archetype.base,
      displayName: archetype.displayName,
      totalDecks: archetype.totalDecks,
      appearances,
      avgShare,
      maxShare,
      peakShare,
      minShare,
      successTotals: aggregateSuccess,
      timeline: dailyTimeline
    });
  });

  series.sort((first, second) => second.totalDecks - first.totalDecks || second.avgShare - first.avgShare);
  const limitedSeries = seriesLimit ? series.slice(0, seriesLimit) : series;

  const tournamentCount = sortedTournaments.length;

  const tournamentsWithDeckCounts = sortedTournaments.map(tournament => {
    const meta = tournamentIndex.get(tournament.id);
    return {
      ...tournament,
      deckTotal: meta?.deckTotal ?? tournament.deckTotal ?? 0
    };
  });

  const result: TrendReportResult = {
    generatedAt: now.toISOString(),
    windowStart: windowStart ? windowStart.toISOString() : null,
    windowEnd: windowEnd ? windowEnd.toISOString() : null,
    deckTotal: deckList.length,
    tournamentCount,
    minAppearances,
    archetypeCount: limitedSeries.length,
    series: limitedSeries,
    tournaments: tournamentsWithDeckCounts
  };

  if (seriesLimit && limitedSeries.length !== series.length) {
    result.totalArchetypes = series.length;
  }

  return result;
}

/** Deck-weighted presence share (0-100, one decimal) across a slice of events. */
function weightedShare(slice: Array<{ present: number; total: number }>): number {
  const present = slice.reduce((sum, entry) => sum + (entry.present || 0), 0);
  const total = slice.reduce((sum, entry) => sum + (entry.total || 0), 0);
  return total ? Math.round((present / total) * 1000) / 10 : 0;
}

type MoverCandidate = CardTrendItem & { presenceSignature: string };

/** Sort key for picking one card out of an evolution line: highest set number wins. */
function printingRank(item: CardTrendItem): number {
  const digits = String(item.number || '').replace(/\D/g, '');
  return digits ? Number(digits) : -1;
}

/**
 * Cards from one set whose presence is identical in every event are one
 * signal, not several: an evolution line moves together and used to fill
 * three rows of the movers list with the same numbers. Keep the
 * highest-numbered printing of each group, which for a line is its final
 * stage.
 */
function collapseIdenticalTimelines(series: MoverCandidate[]): CardTrendItem[] {
  const bySignature = new Map<string, MoverCandidate>();
  for (const item of series) {
    const current = bySignature.get(item.presenceSignature);
    if (!current || printingRank(item) > printingRank(current)) {
      bySignature.set(item.presenceSignature, item);
    }
  }
  return [...bySignature.values()].map(({ presenceSignature: _signature, ...item }) => item);
}

export function buildCardTrendReport(
  decks: TrendDeckInput[],
  tournaments: TrendTournamentInput[],
  options: BuildCardTrendReportOptions = {}
): CardTrendsResult {
  const synonymDb = options.synonymDb ?? null;
  const now = options.now ? new Date(options.now) : new Date();
  const windowStart = options.windowStart ? new Date(options.windowStart) : null;
  const windowEnd = options.windowEnd ? new Date(options.windowEnd) : now;
  const minAppearances = Math.max(
    1,
    Number.isFinite(options.minAppearances) ? Number(options.minAppearances) : CARD_TREND_MIN_APPEARANCES
  );
  const topCount = Math.max(1, Number.isFinite(options.topCount) ? Number(options.topCount) : DEFAULT_CARD_TREND_TOP);

  const tournamentsMap = new Map();
  (Array.isArray(tournaments) ? tournaments : [])
    .filter(tournament => tournament && tournament.id && (Number(tournament.players) || 0) >= MIN_TREND_PLAYERS)
    .forEach(tournament => {
      tournamentsMap.set(tournament.id, {
        id: tournament.id,
        date: tournament.date || null,
        deckTotal: Number(tournament.deckTotal) || 0
      });
    });

  const cardPresence = new Map(); // key -> Map<tournamentId, presentCount>
  const cardMeta = new Map();

  const deckList = Array.isArray(decks) ? decks : [];
  for (const deck of deckList) {
    const tournamentId = deck?.tournamentId;
    if (!tournamentId || !tournamentsMap.has(tournamentId)) {
      continue;
    }
    const uniqueCards = new Set();
    for (const card of Array.isArray(deck?.cards) ? deck.cards : []) {
      const name = card?.name || 'Unknown Card';
      const set = (card?.set || '').toString().toUpperCase();
      const number = card?.number || '';
      // Build through the one constructor: decks carry RAW collector numbers
      // (`PRE/4`) while the synonym database and every other artifact key UIDs
      // zero-padded (`PRE/004`). Interpolating the fields split one printing
      // across every spelling of its number AND missed the 547 padded synonym
      // entries outright, so the collapse below silently did nothing for them
      //.
      let key = cardUidOrName(name, set, number);
      // Canonicalize so reprints (e.g. same card in two sets) collapse into
      // a single trend entry instead of splitting appearances + share.
      if (synonymDb) {
        key = getCanonicalCard(synonymDb, key);
      }
      uniqueCards.add(key);
      if (!cardMeta.has(key)) {
        // Use the canonical UID's set/number for display when the key was
        // rewritten by the synonym DB; this keeps the UI link pointing at
        // the canonical card page.
        const parsed = parseCardUid(key);
        if (parsed) {
          cardMeta.set(key, parsed);
        } else {
          cardMeta.set(key, { name, set: set || null, number: number || null });
        }
      }
    }
    uniqueCards.forEach(key => {
      if (!cardPresence.has(key)) {
        cardPresence.set(key, new Map());
      }
      const counts = cardPresence.get(key);
      counts.set(tournamentId, (counts.get(tournamentId) || 0) + 1);
    });
  }

  const series: MoverCandidate[] = [];
  cardPresence.forEach((presenceMap, key) => {
    const timeline = Array.from(tournamentsMap.values())
      .sort((first, second) => Date.parse(first.date || 0) - Date.parse(second.date || 0))
      .map(meta => {
        const present = presenceMap.get(meta.id) || 0;
        const share = meta.deckTotal ? Math.round((present / meta.deckTotal) * 10000) / 100 : 0;
        return {
          tournamentId: meta.id,
          date: meta.date || null,
          present,
          total: meta.deckTotal,
          share
        };
      });

    const presentEvents = timeline.filter(entry => entry.present > 0).length;
    if (presentEvents < minAppearances) {
      return;
    }

    // Deck-weighted share over the first and last third of the window's
    // events: a 4-player pod and a 500-player open used to count the same.
    const chunk = Math.max(1, Math.ceil(timeline.length / 3));
    const startAvg = weightedShare(timeline.slice(0, chunk));
    const endAvg = weightedShare(timeline.slice(-chunk));
    const delta = Math.round((endAvg - startAvg) * 10) / 10;

    series.push({
      key,
      ...cardMeta.get(key),
      // Number of events the card actually appeared in, not the total number of
      // events in the window (timeline.length includes zero-presence events).
      appearances: presentEvents,
      startShare: startAvg,
      endShare: endAvg,
      delta,
      currentShare: endAvg,
      recentAvg: endAvg,
      startAvg,
      // Same set + same presence in every event: the shape an evolution line
      // printed together takes. Unrelated cards from different sets that
      // happen to share a timeline stay separate.
      presenceSignature: `${cardMeta.get(key)?.set || ''}|${timeline.map(entry => entry.present).join(',')}`
    });
  });

  // Basic energy cards to exclude from trend reports (variant changes aren't meaningful)
  const BASIC_ENERGY_NAMES = new Set([
    'Psychic Energy',
    'Fire Energy',
    'Lightning Energy',
    'Grass Energy',
    'Darkness Energy',
    'Metal Energy',
    'Fighting Energy',
    'Water Energy'
  ]);

  // Minimum recent share (%) for a card to be considered "currently played" enough
  // to feature in the Rising list. For Falling, we instead require a meaningful
  // historical share so we can show genuine drops (including drops to ~0).
  const MIN_VISIBLE_SHARE = 0.3;

  const movers = collapseIdenticalTimelines(series).filter(item => !BASIC_ENERGY_NAMES.has(item.name));
  const rising = movers
    .filter(item => item.delta > 0)
    .filter(item => item.recentAvg >= MIN_VISIBLE_SHARE)
    .sort((first, second) => second.delta - first.delta)
    .slice(0, topCount);
  const falling = movers
    .filter(item => item.delta < 0)
    .filter(item => item.startAvg >= MIN_VISIBLE_SHARE)
    .sort((first, second) => first.delta - second.delta)
    .slice(0, topCount);

  return {
    generatedAt: now.toISOString(),
    windowStart: windowStart ? windowStart.toISOString() : null,
    windowEnd: windowEnd ? windowEnd.toISOString() : null,
    cardsAnalyzed: series.length,
    rising,
    falling
  };
}
