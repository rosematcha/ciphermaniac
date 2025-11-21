#!/usr/bin/env node

/**
 * Trends-only builder for the past month of online tournaments.
 * Keeps the legacy online-meta job untouched. Outputs:
 *   reports/Trends - Last 30 Days/trends.json
 *   reports/Trends - Last 30 Days/meta.json
 */

import process from 'node:process';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  fetchRecentOnlineTournaments,
  gatherDecks,
  buildTrendReport,
  buildCardTrendReport
} from '../../functions/lib/onlineMeta.js';
import { loadCardTypesDatabase } from '../../functions/lib/cardTypesDatabase.js';

const TRENDS_FOLDER = 'Trends - Last 30 Days';
const LOOKBACK_DAYS = 30;
const BASIC_ENERGY = new Set([
  'Psychic Energy',
  'Fire Energy',
  'Lightning Energy',
  'Grass Energy',
  'Darkness Energy',
  'Metal Energy',
  'Fighting Energy',
  'Water Energy'
]);

// Suggestion/category thresholds (mirroring generate_suggestions.py)
const RECENT_WEIGHT_HALF_LIFE_DAYS = 30;
const MIN_LEADER_APPEARANCE_PCT = 0.6;
const MIN_LEADER_AVG_PCT = 4.0;
const LEADER_RECENCY_WEIGHT = 0.1;
const MIN_RISE_CURRENT_PCT = 2.0;
const MIN_RISE_DELTA_ABS = 1.5;
const MIN_RISE_DELTA_REL = 1.25;
const MIN_RISE_TOURNAMENTS = 3;
const MIN_CHOPPED_PEAK_PCT = 6.0;
const MIN_CHOPPED_DROP_ABS = 5.0;
const MIN_CHOPPED_DROP_REL = 0.6;
const MIN_SUSTAINED_PEAK_TOURNAMENTS = 2;
const MAX_CHOPPED_RECENT_PCT = 2.0;
const MAX_DAY2D_TOTAL_APPEARANCES = 2;
const MAX_DAY2D_PEAK_USAGE = 1.5;
const MAX_DAY2D_TOTAL_USAGE_SUM = 3.0;
const MIN_DAY2D_MIN_APPEARANCE = 0.3;
const MAX_DAY2D_RECENT_PCT = 0.1;
const MAX_PER_ARCHETYPE = 2;
const MAX_SUGGESTIONS = 18;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

const R2_ACCOUNT_ID = requireEnv('R2_ACCOUNT_ID');
const R2_ACCESS_KEY_ID = requireEnv('R2_ACCESS_KEY_ID');
const R2_SECRET_ACCESS_KEY = requireEnv('R2_SECRET_ACCESS_KEY');
const R2_BUCKET_NAME = requireEnv('R2_BUCKET_NAME');
const R2_REPORTS_PREFIX = process.env.R2_REPORTS_PREFIX || 'reports';

const s3Client = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY
  }
});

class R2Binding {
  constructor(prefix = '') {
    this.prefix = prefix.replace(/\/+$/, '');
  }

  withPrefix(key) {
    return this.prefix ? `${this.prefix}/${key}` : key;
  }

  async put(key, data) {
    const body = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    await s3Client.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: this.withPrefix(key),
        Body: body,
        ContentType: 'application/json'
      })
    );
  }
}

function recencyWeight(daysDiff) {
  return Math.pow(0.5, daysDiff / RECENT_WEIGHT_HALF_LIFE_DAYS);
}

function selectWithArchetypeCap(items, getArchetype, maxPer = MAX_PER_ARCHETYPE, limit = MAX_SUGGESTIONS) {
  const result = [];
  const counts = new Map();
  for (const item of items) {
    if (result.length >= limit) {
      break;
    }
    const arch = getArchetype(item) || 'unknown';
    const current = counts.get(arch) || 0;
    if (current >= maxPer) {
      continue;
    }
    counts.set(arch, current + 1);
    result.push(item);
  }
  return result;
}

function buildCardTimelines(decks, tournaments) {
  const sortedTournaments = [...tournaments].sort(
    (a, b) => Date.parse(a.date || 0) - Date.parse(b.date || 0)
  );
  const deckTotals = new Map(sortedTournaments.map(t => [t.id, Number(t.deckTotal) || 0]));
  const countsByCard = new Map(); // key -> Map<tournamentId, presentCount>
  const metaByCard = new Map(); // key -> {name,set,number, archetypes:Map}

  for (const deck of decks) {
    const seenInDeck = new Set();
    for (const card of Array.isArray(deck.cards) ? deck.cards : []) {
      const name = card?.name || 'Unknown Card';
      const set = (card?.set || '').toString().toUpperCase();
      const number = card?.number || '';
      const key = set && number ? `${name}::${set}::${number}` : name;
      if (seenInDeck.has(key)) {
        continue;
      }
      seenInDeck.add(key);
      if (!countsByCard.has(key)) {
        countsByCard.set(key, new Map());
      }
      const byTournament = countsByCard.get(key);
      const tid = deck.tournamentId;
      byTournament.set(tid, (byTournament.get(tid) || 0) + 1);

      if (!metaByCard.has(key)) {
        metaByCard.set(key, {
          name,
          set: set || null,
          number: number || null,
          archetypes: new Map()
        });
      }
      if (deck.archetype) {
        const archMap = metaByCard.get(key).archetypes;
        archMap.set(deck.archetype, (archMap.get(deck.archetype) || 0) + 1);
      }
    }
  }

  const timelines = new Map();
  sortedTournaments.forEach(t => {
    if (!deckTotals.has(t.id)) {
      deckTotals.set(t.id, 0);
    }
  });

  countsByCard.forEach((tMap, key) => {
    const meta = metaByCard.get(key) || {};
    const timeline = sortedTournaments.map(t => {
      const present = tMap.get(t.id) || 0;
      const total = deckTotals.get(t.id) || 0;
      const share = total ? Math.round((present / total) * 1000) / 10 : 0;
      return {
        tournamentId: t.id,
        date: t.date || null,
        present,
        total,
        share
      };
    });
    timelines.set(key, { ...meta, timeline });
  });

  return { timelines, tournaments: sortedTournaments };
}

function buildSuggestions(cardTimelines, now) {
  const leaders = [];
  const rising = [];
  const chopped = [];
  const day2d = [];

  const computeWindowAverages = series => {
    const n = series.length;
    if (n === 0) {
      return { startAvg: 0, recentAvg: 0, overallAvg: 0 };
    }
    const windowSize = Math.max(2, Math.ceil(n * 0.4));
    const startWindow = series.slice(0, windowSize);
    const recentWindow = series.slice(-windowSize);

    const avg = arr => (arr.length ? arr.reduce((sum, s) => sum + (s.share || 0), 0) / arr.length : 0);
    const weightedAvg = arr => {
      let num = 0;
      let den = 0;
      for (const s of arr) {
        const date = s.date ? new Date(s.date) : null;
        const daysDiff = date ? (now - date) / (1000 * 60 * 60 * 24) : 0;
        const w = recencyWeight(daysDiff);
        num += (s.share || 0) * w;
        den += w;
      }
      return den ? num / den : 0;
    };

    return {
      startAvg: avg(startWindow),
      recentAvg: weightedAvg(recentWindow),
      overallAvg: avg(series)
    };
  };

  const entries = Array.from(cardTimelines.entries());
  for (const [key, data] of entries) {
    if (BASIC_ENERGY.has(data.name)) {
      continue;
    }
    const series = data.timeline || [];
    if (!series.length) continue;
    const latest = series[series.length - 1].share || 0;
    const secondLatest = series.length > 1 ? series[series.length - 2].share || 0 : 0;
    const appearances = series.filter(s => s.present > 0).length;
    const totalTournaments = series.length;
    const { startAvg, recentAvg, overallAvg } = computeWindowAverages(series);

    // Leaders
    if (
      totalTournaments > 0 &&
      appearances / totalTournaments >= MIN_LEADER_APPEARANCE_PCT &&
      overallAvg >= MIN_LEADER_AVG_PCT &&
      recentAvg >= MIN_LEADER_AVG_PCT
    ) {
      const latestDate = series[series.length - 1].date ? new Date(series[series.length - 1].date) : null;
      const daysDiff = latestDate ? (now - latestDate) / (1000 * 60 * 60 * 24) : 0;
      const score = overallAvg + recentAvg + (latest * LEADER_RECENCY_WEIGHT) + recencyWeight(daysDiff);
      leaders.push({ key, ...data, latest, avgShare: overallAvg, recentAvg, score });
    }

    // Rising
    if (series.length >= MIN_RISE_TOURNAMENTS) {
      const deltaAbs = recentAvg - startAvg;
      const deltaRel = startAvg > 0 ? recentAvg / startAvg : recentAvg > 0 ? Infinity : 0;
      if (
        recentAvg >= MIN_RISE_CURRENT_PCT &&
        deltaAbs >= MIN_RISE_DELTA_ABS &&
        deltaRel >= MIN_RISE_DELTA_REL
      ) {
        const score = deltaAbs * 2 + recentAvg + (deltaRel >= MIN_RISE_DELTA_REL ? deltaRel : 0);
        rising.push({ key, ...data, latest, recentAvg, startAvg, deltaAbs, deltaRel, score });
      }
    }

    // Chopped and washed
    const peakShare = Math.max(...series.map(s => s.share || 0));
    const peakIdx = series.findIndex(s => (s.share || 0) === peakShare);
    let sustained = 0;
    if (peakIdx >= 0) {
      for (let idx = peakIdx; idx < series.length; idx += 1) {
        const share = series[idx].share || 0;
        if (share >= MIN_CHOPPED_PEAK_PCT * 0.7 && share >= MIN_CHOPPED_PEAK_PCT) {
          sustained += 1;
        } else {
          break;
        }
      }
    }
    const absDrop = peakShare - latest;
    const relDrop = peakShare > 0 ? absDrop / peakShare : 0;
    if (
      peakShare >= MIN_CHOPPED_PEAK_PCT &&
      sustained >= MIN_SUSTAINED_PEAK_TOURNAMENTS &&
      latest <= MAX_CHOPPED_RECENT_PCT &&
      absDrop >= MIN_CHOPPED_DROP_ABS &&
      relDrop >= MIN_CHOPPED_DROP_REL
    ) {
      const peakDate = peakIdx >= 0 && series[peakIdx].date ? new Date(series[peakIdx].date) : null;
      const daysSincePeak = peakDate ? (now - peakDate) / (1000 * 60 * 60 * 24) : (series.length - peakIdx) * 7;
      const steepness = absDrop / Math.max(1, series.length - peakIdx);
      let score = absDrop * 2 + relDrop * peakShare + steepness * 3 + sustained * 2 + recencyWeight(daysSincePeak) * 5;
      if (latest <= 0) {
        score *= 1.5;
      }
      chopped.push({ key, ...data, peakShare, latest, absDrop, relDrop, score });
    }

    // That Day 2'd
    const totalUsage = series.reduce((sum, s) => sum + (s.share || 0), 0);
    const maxUsage = peakShare;
    const minUsage = Math.min(...series.map(s => s.share || 0));
    if (
      appearances <= MAX_DAY2D_TOTAL_APPEARANCES &&
      maxUsage <= MAX_DAY2D_PEAK_USAGE &&
      totalUsage <= MAX_DAY2D_TOTAL_USAGE_SUM &&
      minUsage >= MIN_DAY2D_MIN_APPEARANCE &&
      latest <= MAX_DAY2D_RECENT_PCT
    ) {
      day2d.push({ key, ...data, latest, maxUsage, totalUsage });
    }
  }

  const sortDesc = (arr, field = 'score') => [...arr].sort((a, b) => (b[field] || 0) - (a[field] || 0));
  const pickArch = item => {
    const archMap = item.archetypes || new Map();
    if (archMap instanceof Map) {
      let best = null;
      let bestCount = -1;
      archMap.forEach((count, name) => {
        if (count > bestCount) {
          best = name;
          bestCount = count;
        }
      });
      return best;
    }
    return null;
  };

  const toPlain = (item, extra = {}) => ({
    key: item.key,
    name: item.name,
    set: item.set || null,
    number: item.number || null,
    archetype: pickArch(item) || null,
    ...extra
  });

  return {
    leaders: selectWithArchetypeCap(sortDesc(leaders), pickArch).map(item =>
      toPlain(item, { latest: item.latest, avgShare: item.avgShare, score: item.score })
    ),
    onTheRise: selectWithArchetypeCap(sortDesc(rising), pickArch).map(item =>
      toPlain(item, {
        latest: item.latest,
        deltaAbs: item.deltaAbs,
        deltaRel: item.deltaRel,
        score: item.score
      })
    ),
    choppedAndWashed: selectWithArchetypeCap(sortDesc(chopped), pickArch).map(item =>
      toPlain(item, {
        peakShare: item.peakShare,
        latest: item.latest,
        absDrop: item.absDrop,
        relDrop: item.relDrop,
        score: item.score
      })
    ),
    thatDay2d: selectWithArchetypeCap(sortDesc(day2d, 'maxUsage'), pickArch).map(item =>
      toPlain(item, {
        latest: item.latest,
        maxUsage: item.maxUsage,
        totalUsage: item.totalUsage
      })
    )
  };
}

async function main() {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const now = new Date();

  const env = {
    REPORTS: new R2Binding(R2_REPORTS_PREFIX),
    LIMITLESS_API_KEY: requireEnv('LIMITLESS_API_KEY')
  };

  console.log(`[trends] Loading card types database...`);
  const cardTypesDb = await loadCardTypesDatabase(env);
  console.log(`[trends] Card DB entries: ${Object.keys(cardTypesDb || {}).length}`);

  console.log(`[trends] Fetching tournaments since ${since.toISOString()}`);
  const tournaments = await fetchRecentOnlineTournaments(env, since, { maxPages: 20 });
  console.log(`[trends] Tournaments: ${tournaments.length}`);
  if (!tournaments.length) {
    throw new Error('No tournaments found for trends window');
  }

  console.log('[trends] Gathering decks...');
  const decks = await gatherDecks(env, tournaments, {}, cardTypesDb, {});
  console.log(`[trends] Decks: ${decks.length}`);
  if (!decks.length) {
    throw new Error('No decks gathered for trends');
  }

  const trendReport = buildTrendReport(decks, tournaments, {
    windowStart: since,
    windowEnd: now,
    now,
    minAppearances: 2
  });
  const cardTrends = buildCardTrendReport(decks, trendReport.tournaments, {
    windowStart: since,
    windowEnd: now,
    minAppearances: 2
  });
  const { timelines: cardTimelines } = buildCardTimelines(decks, trendReport.tournaments);
  const suggestions = buildSuggestions(cardTimelines, now);

  const meta = {
    name: TRENDS_FOLDER,
    generatedAt: now.toISOString(),
    windowStart: since.toISOString(),
    windowEnd: now.toISOString(),
    deckTotal: decks.length,
    tournamentCount: tournaments.length
  };

  const baseKey = `${TRENDS_FOLDER}`;
  console.log('[trends] Uploading meta and trends...');
  await env.REPORTS.put(`${baseKey}/meta.json`, meta);
  await env.REPORTS.put(`${baseKey}/trends.json`, { trendReport, cardTrends, suggestions });

  console.log('[trends] Done', {
    tournaments: tournaments.length,
    decks: decks.length,
    archetypeSeries: trendReport.series?.length || 0,
    cardRising: cardTrends.rising?.length || 0,
    cardFalling: cardTrends.falling?.length || 0
  });
}

main().catch(error => {
  console.error('[trends] Failed', error);
  process.exit(1);
});
