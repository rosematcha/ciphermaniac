/**
 * Utilities to merge multiple parsed reports into a single aggregate dataset.
 * @module utils/reportAggregator
 */

import { logger } from './logger.js';

/**
 * @typedef {import('../parse.js').CardItem} CardItem
 * @typedef {{ deckTotal: number, items: CardItem[] }} ParsedReport
 */

/**
 * Compute a stable aggregation key for a card item.
 * Prefers UID when available, otherwise falls back to name + set + number.
 * @param {CardItem} item
 * @returns {string}
 */
function buildAggregationKey(item) {
  if (item.uid) {
    return item.uid;
  }

  const setPart = item.set ? item.set.toUpperCase() : '';
  const numberPart =
    typeof item.number === 'string' || typeof item.number === 'number'
      ? String(item.number).toUpperCase()
      : '';

  return `${item.name}::${setPart}::${numberPart}`;
}

/**
 * Create a fresh accumulator for the provided card item.
 * @param {CardItem} item
 * @returns {object}
 */
function createAccumulator(item) {
  return {
    name: item.name,
    uid: item.uid || null,
    set: item.set || null,
    number: item.number || null,
    category: item.category || null,
    trainerType: item.trainerType || null,
    energyType: item.energyType || null,
    displayCategory: item.displayCategory || null,
    rank: item.rank ?? null,
    found: 0,
    distBuckets: new Map()
  };
}

/**
 * Merge distribution information from a card item into the accumulator.
 * @param {Map<number, { copies: number, players: number }>} buckets
 * @param {CardItem['dist']} dist
 * @param {number} deckTotal
 */
function mergeDistribution(buckets, dist, deckTotal) {
  if (!Array.isArray(dist) || dist.length === 0) {
    return;
  }

  for (const entry of dist) {
    if (!entry) {
      continue;
    }

    const copies = Number.isFinite(entry.copies) ? entry.copies : null;
    if (copies === null) {
      continue;
    }

    let players = Number.isFinite(entry.players) ? entry.players : null;
    if (players === null && Number.isFinite(entry.percent)) {
      players = Math.round((entry.percent / 100) * deckTotal);
    }
    if (!Number.isFinite(players)) {
      continue;
    }

    const existing = buckets.get(copies);
    if (existing) {
      existing.players += players;
    } else {
      buckets.set(copies, { copies, players });
    }
  }
}

/**
 * Convert accumulator objects into CardItem entries after aggregation.
 * @param {Map<string, ReturnType<typeof createAccumulator>>} map
 * @param {number} totalDecks
 * @returns {CardItem[]}
 */
function finalizeAggregates(map, totalDecks) {
  const items = [];

  for (const aggregate of map.values()) {
    const pct =
      totalDecks > 0
        ? Math.round((aggregate.found / totalDecks) * 100 * 100) / 100
        : 0;

    let dist = [];
    if (aggregate.distBuckets.size > 0) {
      dist = Array.from(aggregate.distBuckets.values())
        .map(bucket => {
          const percent =
            totalDecks > 0 ? (bucket.players / totalDecks) * 100 : 0;

          return {
            copies: bucket.copies,
            players: bucket.players,
            percent: Math.round(percent * 100) / 100
          };
        })
        .sort(
          (firstBucket, secondBucket) =>
            firstBucket.copies - secondBucket.copies
        );
    }

    /** @type {CardItem} */
    const item = {
      name: aggregate.name,
      found: aggregate.found,
      total: totalDecks,
      pct,
      ...(aggregate.uid ? { uid: aggregate.uid } : {}),
      ...(aggregate.set ? { set: aggregate.set } : {}),
      ...(aggregate.number ? { number: aggregate.number } : {}),
      ...(aggregate.category ? { category: aggregate.category } : {}),
      ...(aggregate.trainerType ? { trainerType: aggregate.trainerType } : {}),
      ...(aggregate.energyType ? { energyType: aggregate.energyType } : {}),
      ...(aggregate.displayCategory
        ? { displayCategory: aggregate.displayCategory }
        : {}),
      ...(aggregate.rank !== null ? { rank: aggregate.rank } : {}),
      ...(dist.length ? { dist } : {})
    };

    items.push(item);
  }

  return items;
}

/**
 * Aggregate multiple reports into a single combined report result.
 * Cards are matched by UID when available, otherwise by name + set + number.
 * @param {ParsedReport[]} reports
 * @returns {ParsedReport}
 */
export function aggregateReports(reports) {
  if (!Array.isArray(reports) || reports.length === 0) {
    return { deckTotal: 0, items: [] };
  }

  let totalDecks = 0;
  const aggregates = new Map();

  for (const report of reports) {
    if (!report || !Array.isArray(report.items)) {
      continue;
    }

    const deckTotal = Number.isFinite(report.deckTotal) ? report.deckTotal : 0;
    totalDecks += deckTotal;

    for (const item of report.items) {
      if (!item || typeof item.name !== 'string') {
        continue;
      }

      const key = buildAggregationKey(item);
      let aggregate = aggregates.get(key);

      if (!aggregate) {
        aggregate = createAccumulator(item);
        aggregates.set(key, aggregate);
      }

      aggregate.found += Number.isFinite(item.found) ? item.found : 0;
      mergeDistribution(aggregate.distBuckets, item.dist, deckTotal);

      // Preserve metadata if accumulator is missing it
      if (!aggregate.uid && item.uid) {
        aggregate.uid = item.uid;
      }
      if (!aggregate.set && item.set) {
        aggregate.set = item.set;
      }
      if (
        !aggregate.number &&
        (typeof item.number === 'string' || typeof item.number === 'number')
      ) {
        aggregate.number = item.number;
      }
      if (!aggregate.category && item.category) {
        aggregate.category = item.category;
      }
      if (!aggregate.trainerType && item.trainerType) {
        aggregate.trainerType = item.trainerType;
      }
      if (!aggregate.energyType && item.energyType) {
        aggregate.energyType = item.energyType;
      }
      if (!aggregate.displayCategory && item.displayCategory) {
        aggregate.displayCategory = item.displayCategory;
      }
    }
  }

  const aggregatedItems = finalizeAggregates(aggregates, totalDecks).sort(
    (left, right) => (right.found ?? 0) - (left.found ?? 0)
  );

  logger.debug('Aggregated reports', {
    sourceCount: reports.length,
    combinedDecks: totalDecks,
    itemCount: aggregatedItems.length
  });

  return {
    deckTotal: totalDecks,
    items: aggregatedItems
  };
}
