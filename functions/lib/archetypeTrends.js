import { getCanonicalCard } from './cardSynonyms.js';

// All performance tiers - matches src/data/performanceTiers.ts
const SUCCESS_TAGS = ['all', 'winner', 'top2', 'top4', 'top8', 'top16', 'top10', 'top25', 'top50'];

// Threshold for a card to be included in the trend report
const MIN_PEAK_SHARE_PERCENT = 5.0;

// Thresholds for detecting "interesting" cards (rising or falling significantly)
const INTERESTING_START_SHARE = 10.0;
const INTERESTING_END_SHARE = 1.0;
const INTERESTING_RISE_DELTA = 8.0; // Cards that rose by at least 8% are interesting

/**
 * Standardizes set code and number for card ID generation.
 * @param {string} setCode - The set code
 * @param {string|number} number - The card number
 * @returns {[string|null, string|null]} Tuple of [setCode, number]
 */
function canonicalizeVariant(setCode, number) {
  const sc = (setCode || '').toUpperCase().trim();
  if (!sc) {
    return [null, null];
  }
  const match = /^(\d+)([A-Za-z]*)$/.exec(String(number || '').trim());
  if (!match) {
    return [
      sc,
      String(number || '')
        .trim()
        .toUpperCase()
    ];
  }
  const [, digits, suffix = ''] = match;
  const normalized = digits.padStart(3, '0');
  return [sc, suffix ? `${normalized}${suffix.toUpperCase()}` : normalized];
}

/**
 * Determines if a card is "interesting" enough to include in the trend report.
 * A card is interesting if:
 * - It has a peak share >= MIN_PEAK_SHARE_PERCENT (5%)
 * - OR it started high (>=10%) and dropped low (<=1%)
 * - OR it rose significantly (delta >= 8%)
 *
 * @param {Object} cardStats - Card statistics including maxShare, startShare, endShare
 * @returns {boolean} Whether the card should be included
 */
function isInterestingCard(cardStats) {
  const { maxShare, startShare, endShare } = cardStats;

  // High peak usage
  if (maxShare >= MIN_PEAK_SHARE_PERCENT) {
    return true;
  }

  // Started high and dropped to near zero (fallen star)
  if (startShare >= INTERESTING_START_SHARE && endShare <= INTERESTING_END_SHARE) {
    return true;
  }

  // Rose significantly (rising star)
  const delta = endShare - startShare;
  if (delta >= INTERESTING_RISE_DELTA) {
    return true;
  }

  return false;
}

/**
 * Generates time-series trend data for a specific archetype.
 *
 * @param {Array} decks - List of decks for this archetype (must have successTags)
 * @param {Array} tournaments - List of tournaments in the window
 * @param {Object} synonymDb - Database for resolving card synonyms
 * @returns {Object} Trend report JSON structure
 */
export function generateArchetypeTrends(decks, tournaments, synonymDb) {
  if (!decks || !decks.length) {
    return {
      meta: {
        generatedAt: new Date().toISOString(),
        tournamentCount: 0,
        cardCount: 0
      },
      tournaments: [],
      cards: {}
    };
  }

  const sortedTournaments = [...tournaments].sort((a, b) => Date.parse(a.date || 0) - Date.parse(b.date || 0));

  // 1. Map Decks to Tournaments and calculate Archetype Totals per Tier
  const tournamentStats = new Map(); // tId -> { id, date, name, totals: { all: 0, top8: 0... } }
  const deckMap = new Map(); // tId -> [decks]

  // Initialize with all tournaments in window
  for (const t of sortedTournaments) {
    tournamentStats.set(t.id, {
      id: t.id,
      date: t.date,
      name: t.name,
      totals: {
        all: 0,
        winner: 0,
        top2: 0,
        top4: 0,
        top8: 0,
        top16: 0,
        top10: 0,
        top25: 0,
        top50: 0
      }
    });
    deckMap.set(t.id, []);
  }

  // Populate counts and group decks
  for (const deck of decks) {
    const tId = deck.tournamentId;
    if (!tournamentStats.has(tId)) {
      // Tournament not in our list - might be from outside the window, skip
      continue;
    }

    const stats = tournamentStats.get(tId);
    stats.totals.all += 1;
    deckMap.get(tId).push(deck);

    // Check success tags and increment counters
    const tags = new Set(deck.successTags || []);
    for (const tag of SUCCESS_TAGS) {
      if (tag === 'all') continue;
      if (tags.has(tag)) {
        stats.totals[tag] = (stats.totals[tag] || 0) + 1;
      }
    }
  }

  // Filter to tournaments where this archetype had at least 1 deck
  const activeTournaments = [];
  for (const t of sortedTournaments) {
    const stats = tournamentStats.get(t.id);
    if (stats.totals.all > 0) {
      activeTournaments.push(stats);
    }
  }

  if (activeTournaments.length === 0) {
    return {
      meta: {
        generatedAt: new Date().toISOString(),
        tournamentCount: 0,
        cardCount: 0
      },
      tournaments: [],
      cards: {}
    };
  }

  // 2. Aggregate Card Data across all tournaments
  // cardData: uid -> { name, set, number, maxShare, startShare, endShare, timeline: { tId: { tier: [count, avg] } } }
  const cardData = new Map();

  for (const tStats of activeTournaments) {
    const tId = tStats.id;
    const tDecks = deckMap.get(tId);

    // Track card usage for this tournament
    // cardUsage: uid -> { all: [], top8: [], ... } where values are arrays of copy counts
    const cardUsage = new Map();

    for (const deck of tDecks) {
      // Every deck counts for 'all', plus any success tags it has
      const tags = new Set(['all', ...(deck.successTags || [])]);

      for (const card of deck.cards || []) {
        const count = Number(card.count) || 0;
        if (!count) continue;

        const [setCode, number] = canonicalizeVariant(card.set, card.number);
        let uid = setCode && number ? `${card.name}::${setCode}::${number}` : card.name;

        if (synonymDb) {
          uid = getCanonicalCard(synonymDb, uid);
        }

        if (!cardUsage.has(uid)) {
          cardUsage.set(uid, {});
          // Initialize card meta if first time seeing this card
          if (!cardData.has(uid)) {
            cardData.set(uid, {
              name: card.name,
              set: setCode,
              number: number,
              maxShare: 0,
              firstTournamentShare: null,
              lastTournamentShare: 0,
              timeline: {}
            });
          }
        }

        const usageEntry = cardUsage.get(uid);

        // Add count to all applicable tiers
        for (const tag of SUCCESS_TAGS) {
          if (tags.has(tag)) {
            if (!usageEntry[tag]) usageEntry[tag] = [];
            usageEntry[tag].push(count);
          }
        }
      }
    }

    // Convert per-tournament usage arrays to stats [includedCount, avgCopies]
    for (const [uid, tiers] of cardUsage.entries()) {
      const cData = cardData.get(uid);
      const tEntry = {};
      let hasData = false;

      for (const tag of SUCCESS_TAGS) {
        if (tiers[tag] && tiers[tag].length > 0) {
          const counts = tiers[tag];
          const included = counts.length;
          const totalCopies = counts.reduce((a, b) => a + b, 0);
          const avg = Math.round((totalCopies / included) * 100) / 100;

          tEntry[tag] = [included, avg];
          hasData = true;

          // Track peak share and first/last share for 'all' tier
          if (tag === 'all') {
            const totalDecks = tStats.totals.all;
            const share = totalDecks > 0 ? (included / totalDecks) * 100 : 0;

            if (share > cData.maxShare) {
              cData.maxShare = share;
            }

            // Track first tournament share
            if (cData.firstTournamentShare === null) {
              cData.firstTournamentShare = share;
            }

            // Always update last tournament share
            cData.lastTournamentShare = share;
          }
        }
      }

      if (hasData) {
        cData.timeline[tId] = tEntry;
      }
    }
  }

  // 3. Format Output and Apply Relevance Filter
  const finalCards = {};
  for (const [uid, data] of cardData.entries()) {
    const cardStats = {
      maxShare: data.maxShare,
      startShare: data.firstTournamentShare ?? 0,
      endShare: data.lastTournamentShare
    };

    if (isInterestingCard(cardStats)) {
      finalCards[uid] = {
        name: data.name,
        set: data.set,
        number: data.number,
        timeline: data.timeline
      };
    }
  }

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      tournamentCount: activeTournaments.length,
      cardCount: Object.keys(finalCards).length
    },
    tournaments: activeTournaments.map(t => ({
      id: t.id,
      date: t.date,
      name: t.name,
      totals: t.totals
    })),
    cards: finalCards
  };
}
