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
 * Generates time-series trend data for a specific archetype with enhanced insights.
 * @param {Array} decks - List of decks for this archetype (must have successTags)
 * @param {Array} tournaments - List of tournaments in the window
 * @param {Object} synonymDb - Database for resolving card synonyms
 * @returns {Object} Enhanced trend report JSON structure
 */
export function generateArchetypeTrends(decks, tournaments, synonymDb) {
  if (!decks || !decks.length) {
    return {
      meta: {
        generatedAt: new Date().toISOString(),
        tournamentCount: 0,
        cardCount: 0,
        weekCount: 0
      },
      weeks: [],
      cards: {},
      insights: {
        coreCards: [],
        flexSlots: [],
        risers: [],
        fallers: [],
        substitutions: []
      }
    };
  }

  const sortedTournaments = [...tournaments].sort(
    (first, second) => Date.parse(first.date || 0) - Date.parse(second.date || 0)
  );

  // 1. Group tournaments by week
  const weekMap = new Map(); // weekStart -> { tournaments: [], totals: {...} }
  const tournamentToWeek = new Map(); // tournamentId -> weekStart

  for (const tournament of sortedTournaments) {
    const weekStart = getWeekStart(new Date(tournament.date));
    tournamentToWeek.set(tournament.id, weekStart);

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

  // 2. Process decks and aggregate by week
  // cardWeekData: uid -> Map<weekStart, { tier -> { counts: [], decksWithCard: 0, totalDecks: 0 } }>
  const cardWeekData = new Map();
  const cardMeta = new Map(); // uid -> { name, set, number }

  for (const deck of decks) {
    const weekStart = tournamentToWeek.get(deck.tournamentId);
    if (!weekStart) {
      continue;
    }

    const weekData = weekMap.get(weekStart);
    weekData.totals.all += 1;

    const tags = new Set(deck.successTags || []);
    for (const tag of SUCCESS_TAGS) {
      if (tag !== 'all' && tags.has(tag)) {
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

      // Initialize card week data
      if (!cardWeekData.has(uid)) {
        cardWeekData.set(uid, new Map());
      }

      const cardWeeks = cardWeekData.get(uid);
      if (!cardWeeks.has(weekStart)) {
        cardWeeks.set(weekStart, {});
        for (const tag of SUCCESS_TAGS) {
          cardWeeks.get(weekStart)[tag] = { counts: [], decksWithCard: 0 };
        }
      }

      const weekEntry = cardWeeks.get(weekStart);
      const deckTags = new Set(['all', ...(deck.successTags || [])]);

      for (const tag of SUCCESS_TAGS) {
        if (deckTags.has(tag)) {
          weekEntry[tag].counts.push(count);
          weekEntry[tag].decksWithCard += 1;
        }
      }
    }
  }

  // Filter to weeks with data and sort chronologically
  const activeWeeks = [...weekMap.values()]
    .filter(weekEntryItem => weekEntryItem.totals.all > 0)
    .sort((first, second) => first.weekStart.localeCompare(second.weekStart));

  if (activeWeeks.length === 0) {
    return {
      meta: {
        generatedAt: new Date().toISOString(),
        tournamentCount: 0,
        cardCount: 0,
        weekCount: 0
      },
      weeks: [],
      cards: {},
      insights: {
        coreCards: [],
        flexSlots: [],
        risers: [],
        fallers: [],
        substitutions: []
      }
    };
  }

  // Create week index for timeline
  const weekIndex = new Map();
  activeWeeks.forEach((weekItem, idx) => {
    weekIndex.set(weekItem.weekStart, idx);
  });

  // 3. Build final card data structure
  const finalCards = {};
  const cardPlayrateTimelines = new Map(); // For correlation analysis

  for (const [uid, weekData] of cardWeekData.entries()) {
    const meta = cardMeta.get(uid);
    const weeklyPlayrates = [];
    const weeklyCopies = [];
    const timeline = {};
    const copyTrend = [];

    let maxShare = 0;
    let firstPlayrate = null;
    let lastPlayrate = 0;

    for (const weekItem of activeWeeks) {
      const idx = weekIndex.get(weekItem.weekStart);
      const entry = weekData.get(weekItem.weekStart);

      if (entry && entry.all && entry.all.counts.length > 0) {
        const { counts } = entry.all;
        const totalDecks = weekItem.totals.all;
        const decksWithCard = counts.length;
        const playrate = totalDecks > 0 ? (decksWithCard / totalDecks) * 100 : 0;

        const avg = Math.round((counts.reduce((acc, val) => acc + val, 0) / counts.length) * 100) / 100;
        const mode = calculateMode(counts);

        // Calculate copy distribution (0-4+ copies)
        const dist = [0, 0, 0, 0, 0];
        // For distribution, we need to count decks NOT running the card too
        // But we only have decks that have the card, so dist[0] = totalDecks - decksWithCard
        dist[0] = totalDecks - decksWithCard;
        for (const copyCount of counts) {
          if (copyCount >= 4) {
            dist[4] += 1;
          } else if (copyCount >= 1) {
            dist[copyCount] += 1;
          }
        }

        weeklyPlayrates.push(playrate);
        weeklyCopies.push(avg);

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
            const tierTotal = weekItem.totals[tag] || 0;
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
        weeklyPlayrates.push(0);
        weeklyCopies.push(0);
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
      weeklyPlayrates.length > 0 ? weeklyPlayrates.reduce((acc, val) => acc + val, 0) / weeklyPlayrates.length : 0;
    const playrateChange = lastPlayrate - (firstPlayrate ?? 0);
    const volatility = calculateStdDev(weeklyPlayrates);

    // Calculate copy change
    const firstCopies = weeklyCopies.find(copiesValue => copiesValue > 0) ?? 0;
    const lastCopies =
      weeklyCopies
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

    // Get current stats from most recent week with data
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
    cardPlayrateTimelines.set(uid, weeklyPlayrates);
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

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      tournamentCount: sortedTournaments.length,
      cardCount: Object.keys(finalCards).length,
      weekCount: activeWeeks.length,
      windowStart: activeWeeks[0].weekStart,
      windowEnd: activeWeeks[activeWeeks.length - 1].weekEnd
    },
    weeks: activeWeeks.map(weekItem => ({
      weekStart: weekItem.weekStart,
      weekEnd: weekItem.weekEnd,
      tournamentIds: weekItem.tournamentIds,
      totals: weekItem.totals
    })),
    cards: finalCards,
    insights
  };
}
