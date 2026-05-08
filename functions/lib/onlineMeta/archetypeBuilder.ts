import { normalizeArchetypeName, sanitizeForFilename } from '../data/reportBuilder.js';
import type {
  BuildCardTrendReportOptions,
  BuildTrendReportOptions,
  CardTrendsResult,
  TrendReportResult
} from './types';

const MIN_TREND_PLAYERS = 0;
const DEFAULT_MIN_TREND_APPEARANCES = 3;
const CARD_TREND_MIN_APPEARANCES = 2;
const DEFAULT_CARD_TREND_TOP = 12;

const PLACEMENT_TAG_RULES = [
  { tag: 'winner', maxPlacing: 1, minPlayers: 2 },
  { tag: 'top2', maxPlacing: 2, minPlayers: 4 },
  { tag: 'top4', maxPlacing: 4, minPlayers: 8 },
  { tag: 'top8', maxPlacing: 8, minPlayers: 16 },
  { tag: 'top16', maxPlacing: 16, minPlayers: 32 }
];

const PERCENT_TAG_RULES = [
  { tag: 'top10', fraction: 0.1, minPlayers: 20 },
  { tag: 'top25', fraction: 0.25, minPlayers: 12 },
  { tag: 'top50', fraction: 0.5, minPlayers: 8 }
];

const SUCCESS_TAGS = Array.from(
  new Set([...PLACEMENT_TAG_RULES.map(rule => rule.tag), ...PERCENT_TAG_RULES.map(rule => rule.tag)])
);

export function buildTrendReport(decks, tournaments, options: BuildTrendReportOptions = {}): TrendReportResult {
  const now = options.now ? new Date(options.now) : new Date();
  const windowStart = options.windowStart ? new Date(options.windowStart) : null;
  const windowEnd = options.windowEnd ? new Date(options.windowEnd) : now;
  const minAppearances = Math.max(
    1,
    Number.isFinite(options.minAppearances) ? Number(options.minAppearances) : DEFAULT_MIN_TREND_APPEARANCES
  );
  const seriesLimit = Number.isFinite(options.seriesLimit) ? Math.max(1, Number(options.seriesLimit)) : null;

  const tournamentIndex = new Map();
  const sortedTournaments = (Array.isArray(tournaments) ? tournaments : [])
    .filter(tournament => tournament && tournament.id && (Number(tournament.players) || 0) >= MIN_TREND_PLAYERS)
    .map(tournament => ({
      ...tournament,
      date: tournament.date || null
    }))
    .sort((first, second) => Date.parse(first.date || 0) - Date.parse(second.date || 0));

  sortedTournaments.forEach(tournament => {
    tournamentIndex.set(tournament.id, {
      ...tournament,
      deckTotal: 0
    });
  });

  const archetypes = new Map();
  const successTagSet = new Set(SUCCESS_TAGS);
  const deckList = Array.isArray(decks) ? decks : [];

  for (const deck of deckList) {
    const tournamentId = deck?.tournamentId;
    if (!tournamentId || !tournamentIndex.has(tournamentId)) {
      continue;
    }
    const normalizedName = normalizeArchetypeName(deck?.archetype || 'Unknown');
    const base = sanitizeForFilename(normalizedName.replace(/ /g, '_')) || 'unknown';
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

  const series = [];
  archetypes.forEach(archetype => {
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

    const aggregateSuccess = {};
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

export function buildCardTrendReport(decks, tournaments, options: BuildCardTrendReportOptions = {}): CardTrendsResult {
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
      const key = set && number ? `${name}::${set}::${number}` : name;
      uniqueCards.add(key);
      if (!cardMeta.has(key)) {
        cardMeta.set(key, { name, set: set || null, number: number || null });
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

  const series = [];
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

    const chunk = Math.max(1, Math.ceil(timeline.length / 3));
    const startSlice = timeline.slice(0, chunk);
    const endSlice = timeline.slice(-chunk);
    const startAvg =
      Math.round((startSlice.reduce((sum, entry) => sum + (entry.share || 0), 0) / startSlice.length) * 10) / 10;
    const endAvg =
      Math.round((endSlice.reduce((sum, entry) => sum + (entry.share || 0), 0) / endSlice.length) * 10) / 10;
    const delta = Math.round((endAvg - startAvg) * 10) / 10;

    series.push({
      key,
      ...cardMeta.get(key),
      appearances: timeline.length,
      startShare: startAvg,
      endShare: endAvg,
      delta,
      currentShare: endAvg,
      recentAvg: endAvg,
      startAvg
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

  const rising = [...series]
    .filter(item => item.delta > 0)
    .filter(item => item.recentAvg >= MIN_VISIBLE_SHARE)
    .filter(item => !BASIC_ENERGY_NAMES.has(item.name))
    .sort((first, second) => second.delta - first.delta)
    .slice(0, topCount);
  const falling = [...series]
    .filter(item => item.delta < 0)
    .filter(item => item.startAvg >= MIN_VISIBLE_SHARE)
    .filter(item => !BASIC_ENERGY_NAMES.has(item.name))
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
