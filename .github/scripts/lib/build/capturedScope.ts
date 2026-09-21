const ONLINE_PREFIX = 'reports/Online - Last 14 Days/';
const TRENDS_PREFIX = 'reports/Trends - Last 30 Days/';
const SNAPSHOT_DECK_SHARD = /^reports\/Snapshots\/[^/]+\/archetypes\/[^/]+\/decks\.json$/;

const ONLINE_ROOT_FILES = new Set(['master.json', 'meta.json', 'cardSuccess.json', 'cardUsage.json', 'lists.json']);
const TRENDS_FILES = new Set(['meta.json', 'trends.json', 'history.json']);

export function isOnlineReportRelativeKey(relative: string): boolean {
  return (
    ONLINE_ROOT_FILES.has(relative) ||
    relative === 'decks/index.json' ||
    relative === 'decks/other.json' ||
    relative === 'archetypes/index.json' ||
    /^archetypes\/[^/]+\/(?:cards|decks|trends)\.json$/.test(relative)
  );
}

export function isOnlineReportObject(key: string): boolean {
  return key.startsWith(ONLINE_PREFIX) && isOnlineReportRelativeKey(key.slice(ONLINE_PREFIX.length));
}

export function isTrendsReportObject(key: string): boolean {
  return key.startsWith(TRENDS_PREFIX) && TRENDS_FILES.has(key.slice(TRENDS_PREFIX.length));
}

/** Mutable report objects outside either producer's contract are stale. */
export function staleCapturedReport(key: string): boolean {
  if (key.startsWith(ONLINE_PREFIX)) {
    return !isOnlineReportObject(key);
  }
  if (key.startsWith(TRENDS_PREFIX)) {
    return !isTrendsReportObject(key);
  }
  return SNAPSHOT_DECK_SHARD.test(key);
}
