import { getCanonicalCard } from './cardSynonyms.js';
import { canonicalizeVariant } from './cardUtils.js';

// All performance tiers - matches src/data/performanceTiers.ts
const SUCCESS_TAGS = ['all', 'winner', 'top2', 'top4', 'top8', 'top16', 'top10', 'top25', 'top50'];

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

// Minimum matches for matchup to be statistically meaningful
const MIN_MATCHUP_GAMES = 3;

/**
 * Gets the ISO date string (YYYY-MM-DD) for a given date
 * @param {Date} date
 * @returns {string} ISO date string
 */
function getDateString(date) {
  const dt = new Date(date);
  dt.setHours(0, 0, 0, 0);
  return dt.toISOString().split('T')[0];
}

/**
 * Gets the ISO week start date (Monday) for a given date
 * @param {Date} date
 * @returns {string} ISO date string of Monday of that week
 */
function getWeekStart(date) {
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
function getWeekEnd(weekStart) {
  const endDate = new Date(weekStart);
  endDate.setDate(endDate.getDate() + 6);
  return endDate.toISOString().split('T')[0];
}

/**
 * Calculates the mode (most common value) from an array of numbers
 * @param {number[]} arr
 * @returns {number}
 */
function calculateMode(arr) {
  if (!arr.length) {
    return 0;
  }
  const freq = {};
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
function calculateStdDev(arr) {
  if (arr.length < 2) {
    return 0;
  }
  const mean = arr.reduce((acc, val) => acc + val, 0) / arr.length;
  const squaredDiffs = arr.map(num => (num - mean) ** 2);
  const variance = squaredDiffs.reduce((acc, val) => acc + val, 0) / arr.length;
  return Math.sqrt(variance);
}

/**
 * Calculates Pearson correlation coefficient between two arrays
 * @param {number[]} x
 * @param {number[]} y
 * @returns {number} Correlation coefficient (-1 to 1)
 */
function calculateCorrelation(x, y) {
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
function classifyCard(stats) {
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
function isInterestingCard(cardStats) {
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

/**
 * Builds matchup matrix from pairings data for a specific archetype.
 * @param {string} targetArchetype - The archetype we're generating trends for
 * @param {Array} allPairings - Array of { tournamentId, pairings, standings } objects
 * @returns {Object} Matchup data keyed by opponent archetype
 */
export function buildMatchupMatrix(targetArchetype, allPairings) {
  const matchups = new Map();

  if (!allPairings || !allPairings.length) {
    return {};
  }

  for (const tournamentData of allPairings) {
    const { pairings, standings } = tournamentData;

    if (!pairings || !standings) {
      continue;
    }

    // Build player -> deck mapping from standings
    const playerDecks = new Map();
    for (const standing of standings) {
      if (standing.player && standing.deck?.name) {
        playerDecks.set(standing.player, standing.deck.name);
      }
    }

    // Process each pairing/match
    for (const match of pairings) {
      // Skip byes (no player2)
      if (!match.player2) {
        continue;
      }

      const deck1 = playerDecks.get(match.player1);
      const deck2 = playerDecks.get(match.player2);

      // Skip if we can't identify both decks
      if (!deck1 || !deck2) {
        continue;
      }

      // We only care about matches involving our target archetype
      const isPlayer1Target = deck1 === targetArchetype;
      const isPlayer2Target = deck2 === targetArchetype;

      if (!isPlayer1Target && !isPlayer2Target) {
        continue;
      }

      // Determine opponent archetype
      const opponentArchetype = isPlayer1Target ? deck2 : deck1;

      if (!matchups.has(opponentArchetype)) {
        matchups.set(opponentArchetype, {
          opponent: opponentArchetype,
          wins: 0,
          losses: 0,
          ties: 0,
          total: 0
        });
      }

      const matchupData = matchups.get(opponentArchetype);
      matchupData.total += 1;

      // Determine result
      if (match.winner === 0) {
        // Tie
        matchupData.ties += 1;
      } else if (match.winner === -1) {
        // Double loss - count as loss for both
        matchupData.losses += 1;
      } else {
        // Someone won
        const targetPlayerWon =
          (isPlayer1Target && match.winner === match.player1) || (isPlayer2Target && match.winner === match.player2);
        if (targetPlayerWon) {
          matchupData.wins += 1;
        } else {
          matchupData.losses += 1;
        }
      }
    }
  }

  // Convert to final format with win rates, filter low sample sizes
  const result = {};
  for (const [opponent, data] of matchups.entries()) {
    if (data.total >= MIN_MATCHUP_GAMES) {
      result[opponent] = {
        opponent: data.opponent,
        wins: data.wins,
        losses: data.losses,
        ties: data.ties,
        total: data.total,
        winRate: data.total > 0 ? Math.round((data.wins / data.total) * 1000) / 1000 : 0
      };
    }
  }

  return result;
}

/**
 * Generates time-series trend data for a specific archetype with enhanced insights.
 * Now supports DAILY granularity for more granular trend analysis.
 * @param {Array} decks - List of decks for this archetype (must have successTags)
 * @param {Array} tournaments - List of tournaments in the window
 * @param {Object} synonymDb - Database for resolving card synonyms
 * @param {Object} [options] - Optional configuration
 * @param {Array} [options.pairingsData] - Array of { tournamentId, pairings, standings } for matchup analysis
 * @param {string} [options.archetypeName] - Name of the archetype for matchup matrix
 * @returns {Object} Enhanced trend report JSON structure with daily data and matchups
 */
export function generateArchetypeTrends(decks, tournaments, synonymDb, options) {
  const { pairingsData = [], archetypeName = null } = options || {};

  if (!decks || !decks.length) {
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

  const sortedTournaments = [...tournaments].sort(
    (first, second) => Date.parse(first.date || 0) - Date.parse(second.date || 0)
  );

  // 1. Group tournaments by DAY (new granular approach)
  const dayMap = new Map(); // date -> { date, tournamentIds: [], totals: {...} }
  const tournamentToDay = new Map(); // tournamentId -> date

  // Also maintain week groupings for backward compatibility
  const weekMap = new Map(); // weekStart -> { weekStart, weekEnd, tournamentIds: [], totals: {...} }
  const tournamentToWeek = new Map(); // tournamentId -> weekStart

  for (const tournament of sortedTournaments) {
    const tournamentDate = new Date(tournament.date);
    const dateStr = getDateString(tournamentDate);
    const weekStart = getWeekStart(tournamentDate);

    tournamentToDay.set(tournament.id, dateStr);
    tournamentToWeek.set(tournament.id, weekStart);

    // Initialize day entry
    if (!dayMap.has(dateStr)) {
      dayMap.set(dateStr, {
        date: dateStr,
        tournamentIds: [],
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
    }
    dayMap.get(dateStr).tournamentIds.push(tournament.id);

    // Initialize week entry (for backward compatibility)
    if (!weekMap.has(weekStart)) {
      weekMap.set(weekStart, {
        weekStart,
        weekEnd: getWeekEnd(weekStart),
        tournamentIds: [],
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
    }
    weekMap.get(weekStart).tournamentIds.push(tournament.id);
  }

  // 2. Process decks and aggregate by day
  // cardDayData: uid -> Map<date, { tier -> { counts: [], decksWithCard: 0 } }>
  const cardDayData = new Map();
  const cardMeta = new Map(); // uid -> { name, set, number }

  for (const deck of decks) {
    const dateStr = tournamentToDay.get(deck.tournamentId);
    const weekStart = tournamentToWeek.get(deck.tournamentId);
    if (!dateStr) {
      continue;
    }

    const dayData = dayMap.get(dateStr);
    const weekData = weekMap.get(weekStart);

    dayData.totals.all += 1;
    weekData.totals.all += 1;

    const tags = new Set(deck.successTags || []);
    for (const tag of SUCCESS_TAGS) {
      if (tag !== 'all' && tags.has(tag)) {
        dayData.totals[tag] = (dayData.totals[tag] || 0) + 1;
        weekData.totals[tag] = (weekData.totals[tag] || 0) + 1;
      }
    }

    // Process cards in deck
    for (const card of deck.cards || []) {
      const count = Number(card.count) || 0;
      if (!count) {
        continue;
      }

      const [setCode, number] = canonicalizeVariant(card.set, card.number);
      let uid = setCode && number ? `${card.name}::${setCode}::${number}` : card.name;

      if (synonymDb) {
        uid = getCanonicalCard(synonymDb, uid);
      }

      // Initialize card meta
      if (!cardMeta.has(uid)) {
        cardMeta.set(uid, {
          name: card.name,
          set: setCode,
          number
        });
      }

      // Initialize card day data
      if (!cardDayData.has(uid)) {
        cardDayData.set(uid, new Map());
      }

      const cardDays = cardDayData.get(uid);
      if (!cardDays.has(dateStr)) {
        cardDays.set(dateStr, {});
        for (const tag of SUCCESS_TAGS) {
          cardDays.get(dateStr)[tag] = { counts: [], decksWithCard: 0 };
        }
      }

      const dayEntry = cardDays.get(dateStr);
      const deckTags = new Set(['all', ...(deck.successTags || [])]);

      for (const tag of SUCCESS_TAGS) {
        if (deckTags.has(tag)) {
          dayEntry[tag].counts.push(count);
          dayEntry[tag].decksWithCard += 1;
        }
      }
    }
  }

  // Filter to days/weeks with data and sort chronologically
  const activeDays = [...dayMap.values()]
    .filter(dayEntry => dayEntry.totals.all > 0)
    .sort((first, second) => first.date.localeCompare(second.date));

  const activeWeeks = [...weekMap.values()]
    .filter(weekEntry => weekEntry.totals.all > 0)
    .sort((first, second) => first.weekStart.localeCompare(second.weekStart));

  if (activeDays.length === 0) {
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

  // Create day and week indices for timeline
  const dayIndex = new Map();
  activeDays.forEach((dayItem, idx) => {
    dayIndex.set(dayItem.date, idx);
  });

  const weekIndex = new Map();
  activeWeeks.forEach((weekItem, idx) => {
    weekIndex.set(weekItem.weekStart, idx);
  });

  // 3. Build final card data structure with daily granularity
  const finalCards = {};
  const cardPlayrateTimelines = new Map(); // For correlation analysis (daily)

  for (const [uid, daysData] of cardDayData.entries()) {
    const meta = cardMeta.get(uid);
    const dailyPlayrates = [];
    const dailyCopies = [];
    const timeline = {}; // dayIndex -> tier data
    const copyTrend = []; // daily copy distribution

    let maxShare = 0;
    let firstPlayrate = null;
    let lastPlayrate = 0;

    for (const dayItem of activeDays) {
      const idx = dayIndex.get(dayItem.date);
      const entry = daysData.get(dayItem.date);

      if (entry && entry.all && entry.all.counts.length > 0) {
        const { counts } = entry.all;
        const totalDecks = dayItem.totals.all;
        const decksWithCard = counts.length;
        const playrate = totalDecks > 0 ? (decksWithCard / totalDecks) * 100 : 0;

        const avg = Math.round((counts.reduce((acc, val) => acc + val, 0) / counts.length) * 100) / 100;
        const mode = calculateMode(counts);

        // Calculate copy distribution (0-4+ copies)
        const dist = [0, 0, 0, 0, 0];
        dist[0] = totalDecks - decksWithCard;
        for (const copyCount of counts) {
          if (copyCount >= 4) {
            dist[4] += 1;
          } else if (copyCount >= 1) {
            dist[copyCount] += 1;
          }
        }

        dailyPlayrates.push(playrate);
        dailyCopies.push(avg);

        if (playrate > maxShare) {
          maxShare = playrate;
        }
        if (firstPlayrate === null) {
          firstPlayrate = playrate;
        }
        lastPlayrate = playrate;

        // Build timeline entry for each tier
        const tierEntry = {};
        for (const tag of SUCCESS_TAGS) {
          if (entry[tag] && entry[tag].counts.length > 0) {
            const tierCounts = entry[tag].counts;
            const tierTotal = dayItem.totals[tag] || 0;
            const tierAvg = Math.round((tierCounts.reduce((acc, val) => acc + val, 0) / tierCounts.length) * 100) / 100;
            const tierMode = calculateMode(tierCounts);
            const tierDist = [tierTotal - tierCounts.length, 0, 0, 0, 0];
            for (const copyCount of tierCounts) {
              if (copyCount >= 4) {
                tierDist[4] += 1;
              } else if (copyCount >= 1) {
                tierDist[copyCount] += 1;
              }
            }

            tierEntry[tag] = {
              count: tierCounts.length,
              avg: tierAvg,
              mode: tierMode,
              dist: tierDist
            };
          }
        }

        timeline[idx] = tierEntry;
        copyTrend.push({ avg, mode, dist: dist.slice(1) }); // Exclude 0-count for trend viz
      } else {
        dailyPlayrates.push(0);
        dailyCopies.push(0);
        copyTrend.push({ avg: 0, mode: 0, dist: [0, 0, 0, 0] });
      }
    }

    // Filter by interest threshold
    const cardStats = {
      maxShare,
      startShare: firstPlayrate ?? 0,
      endShare: lastPlayrate
    };

    if (!isInterestingCard(cardStats)) {
      continue;
    }

    // Calculate aggregated stats
    const avgPlayrate =
      dailyPlayrates.length > 0 ? dailyPlayrates.reduce((acc, val) => acc + val, 0) / dailyPlayrates.length : 0;
    const playrateChange = lastPlayrate - (firstPlayrate ?? 0);
    const volatility = calculateStdDev(dailyPlayrates);

    // Calculate copy change
    const firstCopies = dailyCopies.find(copiesValue => copiesValue > 0) ?? 0;
    const lastCopies =
      dailyCopies
        .slice()
        .reverse()
        .find(copiesValue => copiesValue > 0) ?? 0;
    const copiesChange = Math.round((lastCopies - firstCopies) * 100) / 100;

    // Classify the card
    const classificationStats = {
      currentPlayrate: lastPlayrate,
      playrateChange,
      volatility,
      avgPlayrate,
      startPlayrate: firstPlayrate ?? 0
    };
    const category = classifyCard(classificationStats);

    // Get current stats from most recent day with data
    const lastValidCopy = copyTrend
      .slice()
      .reverse()
      .find(copyEntry => copyEntry.avg > 0);

    finalCards[uid] = {
      name: meta.name,
      set: meta.set,
      number: meta.number,
      category,
      currentPlayrate: Math.round(lastPlayrate * 10) / 10,
      currentAvgCopies: lastValidCopy?.avg ?? 0,
      currentModeCopies: lastValidCopy?.mode ?? 0,
      playrateChange: Math.round(playrateChange * 10) / 10,
      copiesChange,
      volatility: Math.round(volatility * 10) / 10,
      timeline,
      copyTrend
    };

    // Store playrate timeline for correlation analysis
    cardPlayrateTimelines.set(uid, dailyPlayrates);
  }

  // 4. Generate insights
  const insights = {
    coreCards: [],
    flexSlots: [],
    risers: [],
    fallers: [],
    substitutions: []
  };

  const cardUids = Object.keys(finalCards);

  for (const uid of cardUids) {
    const card = finalCards[uid];

    if (card.category === 'core') {
      insights.coreCards.push(uid);
    }

    if (card.category === 'flex') {
      const modes = card.copyTrend.filter(copyEntry => copyEntry.avg > 0).map(copyEntry => copyEntry.mode);
      const copyRange = [Math.min(...modes), Math.max(...modes)];
      insights.flexSlots.push({
        uid,
        variance: card.volatility,
        copyRange: isFinite(copyRange[0]) ? copyRange : [0, 0]
      });
    }

    if (card.category === 'emerging' || card.playrateChange >= RISING_DELTA_THRESHOLD) {
      insights.risers.push({
        uid,
        delta: card.playrateChange,
        from: Math.round((card.currentPlayrate - card.playrateChange) * 10) / 10,
        to: card.currentPlayrate
      });
    }

    if (card.category === 'fading' || card.playrateChange <= FALLING_DELTA_THRESHOLD) {
      insights.fallers.push({
        uid,
        delta: card.playrateChange,
        from: Math.round((card.currentPlayrate - card.playrateChange) * 10) / 10,
        to: card.currentPlayrate
      });
    }
  }

  // Sort insights by magnitude
  insights.risers.sort((first, second) => second.delta - first.delta);
  insights.fallers.sort((first, second) => first.delta - second.delta);
  insights.flexSlots.sort((first, second) => second.variance - first.variance);

  // 5. Find substitution patterns (cards with strong negative correlation)
  // Only check cards with decent playrate to avoid noise
  const significantCards = cardUids.filter(uid => {
    const timeline = cardPlayrateTimelines.get(uid);
    const avg = timeline ? timeline.reduce((acc, val) => acc + val, 0) / timeline.length : 0;
    return avg >= 15; // At least 15% average playrate
  });

  for (let iIndex = 0; iIndex < significantCards.length; iIndex++) {
    for (let jIndex = iIndex + 1; jIndex < significantCards.length; jIndex++) {
      const uidA = significantCards[iIndex];
      const uidB = significantCards[jIndex];
      const timelineA = cardPlayrateTimelines.get(uidA);
      const timelineB = cardPlayrateTimelines.get(uidB);

      if (timelineA && timelineB) {
        const correlation = calculateCorrelation(timelineA, timelineB);
        if (correlation <= SUBSTITUTION_THRESHOLD) {
          insights.substitutions.push({
            cardA: uidA,
            cardB: uidB,
            correlation: Math.round(correlation * 100) / 100
          });
        }
      }
    }
  }

  insights.substitutions.sort((first, second) => first.correlation - second.correlation);

  // Limit insights arrays to prevent bloat
  insights.risers = insights.risers.slice(0, 10);
  insights.fallers = insights.fallers.slice(0, 10);
  insights.flexSlots = insights.flexSlots.slice(0, 15);
  insights.substitutions = insights.substitutions.slice(0, 10);

  // 6. Build matchup matrix if pairings data is available
  let matchups = {};
  if (pairingsData.length > 0 && archetypeName) {
    matchups = buildMatchupMatrix(archetypeName, pairingsData);
  }

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
    // Daily granularity data (new)
    days: activeDays.map(dayItem => ({
      date: dayItem.date,
      tournamentIds: dayItem.tournamentIds,
      totals: dayItem.totals
    })),
    // Weekly aggregation for backward compatibility
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
