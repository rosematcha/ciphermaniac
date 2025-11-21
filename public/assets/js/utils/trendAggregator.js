import { logger } from './logger.js';

const SUCCESS_TAGS = ['winner', 'top2', 'top4', 'top8', 'top16', 'top10', 'top25', 'top50'];
const DEFAULT_MIN_APPEARANCES = 3;

function normalizeArchetypeName(name) {
  const cleaned = (name || '').replace(/_/g, ' ').trim();
  if (!cleaned) {
    return 'unknown';
  }
  return cleaned.replace(/\s+/g, ' ').toLowerCase();
}

function buildBaseName(normalized) {
  return (normalized || 'unknown').replace(/ /g, '_').replace(/[^a-z0-9_]/g, '') || 'unknown';
}

export function buildTrendDataset(decks, tournaments, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const minAppearances = Math.max(
    1,
    Number.isFinite(options.minAppearances) ? Number(options.minAppearances) : DEFAULT_MIN_APPEARANCES
  );

  const sortedTournaments = (Array.isArray(tournaments) ? tournaments : [])
    .filter(t => t && t.id)
    .map(t => ({ ...t }))
    .sort((a, b) => Date.parse(a.date || 0) - Date.parse(b.date || 0));

  const tournamentIndex = new Map();
  sortedTournaments.forEach(t => {
    tournamentIndex.set(t.id, { ...t, deckTotal: 0 });
  });

  const archetypes = new Map();
  const deckList = Array.isArray(decks) ? decks : [];
  const successTagSet = new Set(SUCCESS_TAGS);

  for (const deck of deckList) {
    const tournamentId = deck?.tournamentId;
    if (!tournamentId || !tournamentIndex.has(tournamentId)) {
      continue;
    }
    const normalized = normalizeArchetypeName(deck?.archetype || 'Unknown');
    const base = buildBaseName(normalized);
    const displayName = deck?.archetype || 'Unknown';

    const archetype = archetypes.get(base) || {
      base,
      displayName,
      totalDecks: 0,
      timeline: new Map()
    };

    const tournamentMeta = tournamentIndex.get(tournamentId);
    tournamentMeta.deckTotal += 1;

    const entry =
      archetype.timeline.get(tournamentId) || {
        tournamentId,
        tournamentName: deck?.tournamentName || tournamentMeta?.name || 'Unknown Tournament',
        date: deck?.tournamentDate || tournamentMeta?.date || null,
        decks: 0,
        success: {}
      };

    entry.decks += 1;
    for (const tag of Array.isArray(deck?.successTags) ? deck.successTags : []) {
      if (!successTagSet.has(tag)) {
        continue;
      }
      entry.success[tag] = (entry.success[tag] || 0) + 1;
    }

    archetype.timeline.set(tournamentId, entry);
    archetype.totalDecks += 1;
    archetype.displayName = archetype.displayName || displayName;
    archetypes.set(base, archetype);
  }

  const series = [];
  archetypes.forEach(archetype => {
    const timeline = Array.from(archetype.timeline.values())
      .map(entry => {
        const tournamentMeta = tournamentIndex.get(entry.tournamentId);
        const totalDecks = tournamentMeta?.deckTotal || 0;
        const share = totalDecks ? Math.round((entry.decks / totalDecks) * 1000) / 10 : 0;
        return {
          ...entry,
          totalDecks,
          share
        };
      })
      .sort((a, b) => Date.parse(a.date || 0) - Date.parse(b.date || 0));

    if (timeline.length < minAppearances) {
      return;
    }

    const shares = timeline.map(item => item.share || 0);
    const successTotals = {};
    for (const entry of timeline) {
      Object.entries(entry.success || {}).forEach(([tag, count]) => {
        successTotals[tag] = (successTotals[tag] || 0) + (Number(count) || 0);
      });
    }

    const avgShare = shares.length
      ? Math.round((shares.reduce((sum, value) => sum + value, 0) / shares.length) * 10) / 10
      : 0;
    const maxShare = shares.length ? Math.max(...shares) : 0;
    const minShare = shares.length ? Math.min(...shares) : 0;

    series.push({
      base: archetype.base,
      displayName: archetype.displayName,
      totalDecks: archetype.totalDecks,
      appearances: timeline.length,
      avgShare,
      maxShare,
      minShare,
      successTotals,
      timeline
    });
  });

  series.sort((a, b) => b.totalDecks - a.totalDecks || b.avgShare - a.avgShare);

  const tournamentsWithTotals = sortedTournaments.map(t => ({
    ...t,
    deckTotal: tournamentIndex.get(t.id)?.deckTotal || 0
  }));

  logger.debug('Built trend dataset', {
    deckTotal: deckList.length,
    archetypes: series.length,
    tournaments: tournamentsWithTotals.length
  });

  return {
    generatedAt: now.toISOString(),
    windowStart: options.windowStart || null,
    windowEnd: options.windowEnd || null,
    minAppearances,
    deckTotal: deckList.length,
    tournamentCount: tournamentsWithTotals.length,
    archetypeCount: series.length,
    tournaments: tournamentsWithTotals,
    series
  };
}
