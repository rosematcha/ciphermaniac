import { BANLIST_FILE } from '../../../../shared/formats/banlist';

const ONLINE_PREFIX = 'reports/Online - Last 14 Days/';
const TRENDS_PREFIX = 'reports/Trends - Last 30 Days/';
const FORMATS_PREFIX = 'reports/Formats/';
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

/** The formats index, or an online-shaped report object inside one format's folder. */
export function isFormatsReportObject(key: string): boolean {
  if (!key.startsWith(FORMATS_PREFIX)) {
    return false;
  }
  const relative = key.slice(FORMATS_PREFIX.length);
  const slash = relative.indexOf('/');
  const inFolder = relative.slice(slash + 1);
  return relative === 'index.json' || (slash > 0 && (isOnlineReportRelativeKey(inFolder) || inFolder === BANLIST_FILE));
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
  if (key.startsWith(FORMATS_PREFIX)) {
    return !isFormatsReportObject(key);
  }
  return SNAPSHOT_DECK_SHARD.test(key);
}
