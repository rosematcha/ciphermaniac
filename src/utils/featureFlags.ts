/**
 * Runtime feature flags for staged rollouts.
 */

type FeatureFlagName = 'useArchetypeFilterApi';

const FEATURE_FLAGS_META_NAME = 'ciphermaniac-feature-flags';
const FEATURE_FLAGS_QUERY_PARAM = 'ff';
const FEATURE_FLAG_QUERY_PREFIX = 'ff_';
const FEATURE_FLAGS_STORAGE_KEY = 'ciphermaniacFeatureFlags';

const DEFAULT_FLAGS: Record<FeatureFlagName, boolean> = {
  useArchetypeFilterApi: false
};

function parseBooleanLike(raw: string | null): boolean | null {
  const normalized = String(raw || '')
    .trim()
    .toLowerCase();
  if (!normalized) {
    return null;
  }
  if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) {
    return false;
  }
  return null;
}

function parseCommaSet(raw: string | null | undefined): Set<string> {
  if (!raw) {
    return new Set();
  }
  return new Set(
    String(raw)
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
  );
}

function getFlagFromQuery(flag: FeatureFlagName): boolean | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const search = new URLSearchParams(window.location.search || '');
    const directValue = parseBooleanLike(search.get(`${FEATURE_FLAG_QUERY_PREFIX}${flag}`));
    if (directValue !== null) {
      return directValue;
    }

    const list = parseCommaSet(search.get(FEATURE_FLAGS_QUERY_PARAM));
    if (list.has(flag)) {
      return true;
    }
    if (list.has(`-${flag}`) || list.has(`!${flag}`)) {
      return false;
    }
  } catch {
    return null;
  }
  return null;
}

function getFlagFromMeta(flag: FeatureFlagName): boolean | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const meta = document.querySelector(`meta[name="${FEATURE_FLAGS_META_NAME}"]`);
  const content = meta?.getAttribute('content') || '';
  const list = parseCommaSet(content);
  if (list.has(flag)) {
    return true;
  }
  if (list.has(`-${flag}`) || list.has(`!${flag}`)) {
    return false;
  }
  return null;
}

function getFlagFromStorage(flag: FeatureFlagName): boolean | null {
  if (typeof localStorage === 'undefined') {
    return null;
  }
  try {
    const raw = localStorage.getItem(FEATURE_FLAGS_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed?.[flag] === 'boolean') {
      return parsed[flag] as boolean;
    }
  } catch {
    return null;
  }
  return null;
}

const flagCache = new Map<FeatureFlagName, boolean>();

export function isFeatureEnabled(flag: FeatureFlagName): boolean {
  const cached = flagCache.get(flag);
  if (cached !== undefined) {
    return cached;
  }

  const queryValue = getFlagFromQuery(flag);
  if (queryValue !== null) {
    flagCache.set(flag, queryValue);
    return queryValue;
  }

  const storageValue = getFlagFromStorage(flag);
  if (storageValue !== null) {
    flagCache.set(flag, storageValue);
    return storageValue;
  }

  const metaValue = getFlagFromMeta(flag);
  if (metaValue !== null) {
    flagCache.set(flag, metaValue);
    return metaValue;
  }

  const result = DEFAULT_FLAGS[flag];
  flagCache.set(flag, result);
  return result;
}

export function clearFeatureFlagCache(): void {
  flagCache.clear();
}
