import { fetchReport, fetchTournamentsList } from '../api.js';
import { parseReport } from '../parse.js';
import { getDisplayName } from './identifiers.js';
import { getCanonicalCard } from '../utils/cardSynonyms.js';
import { logger } from '../utils/logger.js';
import { CONFIG } from '../config.js';

const SLUG_CACHE_KEY = 'cardSlugCacheV2';
const DEFAULT_SCAN_LIMIT = 12;
const PATH_SAFE_SLUG_SEPARATOR = '~';
const COLON_PATTERN = /:/g;
const PATH_SEPARATOR_PATTERN = /~/g;
const reportCache = new Map<string, Promise<any> | null>();
let tournamentsCache: Promise<string[]> | null = null;

interface CardItem {
  set?: string;
  number?: string | number;
  name?: string;
  uid?: string;
}

interface ParsedReport {
  items: CardItem[];
}

interface SlugCache {
  [key: string]: string;
}

interface RouteInfo {
  source: 'query' | 'hash' | 'slug' | 'landing' | 'other';
  identifier: string | null;
  slug: string | null;
}

interface ResolveOptions {
  scanLimit?: number;
}

/**
 * Normalize card number to 3 digits with optional suffix
 * @param value
 */
export function normalizeCardNumber(value: string | number | null | undefined): string {
  if (value === undefined || value === null) {
    return '';
  }
  const raw = String(value).trim();
  if (!raw) {
    return '';
  }
  const match = raw.match(/^(\d+)([A-Za-z]*)$/);
  if (!match) {
    return raw.toUpperCase();
  }
  const digits = match[1];
  const suffix = match[2] || '';
  const padded = digits.padStart(3, '0');
  return `${padded}${suffix.toUpperCase()}`;
}

function sanitizeName(value: string | null | undefined): string {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[’']/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function normalizeSlug(slug: string | null | undefined): string {
  if (!slug) {
    return '';
  }
  const trimmed = String(slug).trim();
  if (!trimmed) {
    return '';
  }
  const withColons = trimmed.replace(PATH_SEPARATOR_PATTERN, ':');
  if (withColons.includes(':')) {
    const [rawSet, rawNumber] = withColons.split(':');
    if (!rawSet || !rawNumber) {
      return sanitizeName(trimmed);
    }
    const setCode = rawSet.toUpperCase();
    const number = normalizeCardNumber(rawNumber);
    return `${setCode}:${number}`;
  }
  return sanitizeName(withColons);
}

function loadSlugCache(): SlugCache {
  try {
    return JSON.parse(localStorage.getItem(SLUG_CACHE_KEY) || '{}');
  } catch (error: any) {
    logger.debug('Failed to load slug cache', error.message);
    return {};
  }
}

function saveSlugCache(cache: SlugCache): void {
  try {
    localStorage.setItem(SLUG_CACHE_KEY, JSON.stringify(cache));
  } catch (error: any) {
    logger.debug('Failed to persist slug cache', error.message);
  }
}

function ensureTournamentsLoaded(): Promise<string[]> {
  if (tournamentsCache) {
    return tournamentsCache;
  }
  tournamentsCache = fetchTournamentsList()
    .then((list: any) => {
      if (Array.isArray(list) && list.length) {
        return list as string[];
      }
      return ['2025-08-15, World Championships 2025'];
    })
    .catch(() => ['2025-08-15, World Championships 2025']);
  return tournamentsCache;
}

function fetchParsedReport(tournament: string): Promise<ParsedReport | null> {
  if (reportCache.has(tournament)) {
    return reportCache.get(tournament)!;
  }
  const parsedPromise = (async () => {
    try {
      const data = await fetchReport(tournament);
      return parseReport(data) as ParsedReport;
    } catch (error: any) {
      logger.debug('Failed to load tournament report while resolving slug', {
        tournament,
        error: error?.message || error
      });
      return null;
    }
  })();
  reportCache.set(tournament, parsedPromise);
  return parsedPromise;
}

function buildIdentifierFromParts(name: string | undefined, setCode: string, number: string): string | null {
  if (!name) {
    return null;
  }
  if (setCode && number) {
    return `${name}::${setCode}::${number}`;
  }
  if (setCode) {
    return `${name}::${setCode}`;
  }
  return name;
}

function matchesSetAndNumber(item: CardItem, setCode: string, number: string): boolean {
  if (!item) {
    return false;
  }
  const candidateSet = String(item.set || '').toUpperCase();
  const candidateNumber = normalizeCardNumber(item.number);
  return candidateSet === setCode && candidateNumber === number;
}

function matchesSanitizedName(item: CardItem, targetName: string): boolean | null {
  const sanitizedTarget = sanitizeName(targetName);
  const byUid = item.uid ? sanitizeName(getDisplayName(item.uid) || item.uid) : null;
  const byName = sanitizeName(item.name || '');
  return sanitizedTarget && (sanitizedTarget === byUid || sanitizedTarget === byName);
}

async function resolveBySetAndNumber(
  setCode: string,
  number: string,
  options: ResolveOptions = {}
): Promise<string | null> {
  const cache = loadSlugCache();
  const normalizedKey = `${setCode}:${number}`;
  if (cache[normalizedKey]) {
    return cache[normalizedKey];
  }

  const tournaments = await ensureTournamentsLoaded();
  const limit = Math.max(1, options.scanLimit || DEFAULT_SCAN_LIMIT);

  for (const tournament of tournaments.slice(0, limit)) {
    const parsed = await fetchParsedReport(tournament);
    if (!parsed) {
      continue;
    }
    const match = parsed.items.find(item => matchesSetAndNumber(item, setCode, number));
    if (match) {
      const identifier = match.uid || buildIdentifierFromParts(match.name, setCode, number);
      if (identifier) {
        const canonical = await getCanonicalCard(identifier);
        cache[normalizedKey] = canonical;
        saveSlugCache(cache);
        return canonical;
      }
    }
  }

  // Fallback: Try synonym resolution if exact match wasn't found in tournaments
  try {
    const response = await fetch(CONFIG.API.SYNONYMS_URL);
    if (response.ok) {
      const synonymData = await response.json();
      const normalizedNumber = normalizeCardNumber(number);

      // Search for any UID that has this set:number combination
      // Check both synonyms (variants) and their canonical values
      for (const [uid, canonicalUid] of Object.entries(synonymData.synonyms || {})) {
        if (uid.includes('::')) {
          const parts = uid.split('::');
          if (
            parts.length >= 3 &&
            parts[1].toUpperCase() === setCode.toUpperCase() &&
            normalizeCardNumber(parts[2]) === normalizedNumber
          ) {
            // Found a matching variant, return its canonical
            cache[normalizedKey] = canonicalUid as string;
            saveSlugCache(cache);
            return canonicalUid as string;
          }
        }
      }

      // Also check if this set:number IS a canonical by checking all canonical values
      for (const canonicalUid of Object.values(synonymData.canonicals || {})) {
        if ((canonicalUid as string).includes('::')) {
          const parts = (canonicalUid as string).split('::');
          if (
            parts.length >= 3 &&
            parts[1].toUpperCase() === setCode.toUpperCase() &&
            normalizeCardNumber(parts[2]) === normalizedNumber
          ) {
            // This set:number is itself a canonical
            cache[normalizedKey] = canonicalUid as string;
            saveSlugCache(cache);
            return canonicalUid as string;
          }
        }
      }
    }
  } catch (error: any) {
    logger.debug('Synonym fallback failed for set:number resolution', {
      setCode,
      number,
      error: error?.message || error
    });
  }

  return null;
}

async function resolveByName(slugName: string, options: ResolveOptions = {}): Promise<string | null> {
  const cache = loadSlugCache();
  if (cache[slugName]) {
    return cache[slugName];
  }

  const tournaments = await ensureTournamentsLoaded();
  const limit = Math.max(1, options.scanLimit || DEFAULT_SCAN_LIMIT);

  for (const tournament of tournaments.slice(0, limit)) {
    const parsed = await fetchParsedReport(tournament);
    if (!parsed) {
      continue;
    }
    const match = parsed.items.find(item => matchesSanitizedName(item, slugName));
    if (match) {
      const identifier =
        match.uid ||
        buildIdentifierFromParts(
          match.name,
          match.set ? String(match.set).toUpperCase() : '',
          normalizeCardNumber(match.number)
        );
      if (identifier) {
        const canonical = await getCanonicalCard(identifier);
        cache[slugName] = canonical;
        saveSlugCache(cache);
        return canonical;
      }
    }
  }

  return null;
}

/**
 * Create a slug from a card identifier
 * @param identifier
 */
export function makeCardSlug(identifier: string | null): string | null {
  if (!identifier) {
    return null;
  }
  const normalizedIdentifier = String(identifier).replace(PATH_SEPARATOR_PATTERN, ':');
  if (normalizedIdentifier.includes('::')) {
    const parts = normalizedIdentifier.split('::');
    if (parts.length >= 3 && parts[1] && parts[2]) {
      const setCode = parts[1].toUpperCase();
      const number = normalizeCardNumber(parts[2]);
      if (setCode && number) {
        return `${setCode}:${number}`;
      }
    }
  }
  const setSlugMatch = normalizedIdentifier.match(/^([A-Za-z0-9]{2,5})[:-]([0-9]{1,4}[A-Za-z]?)$/);
  if (setSlugMatch) {
    const setCode = setSlugMatch[1].toUpperCase();
    const number = normalizeCardNumber(setSlugMatch[2]);
    if (setCode && number) {
      return `${setCode}:${number}`;
    }
  }
  const display = getDisplayName(normalizedIdentifier) || normalizedIdentifier;
  const sanitized = sanitizeName(display);
  return sanitized || null;
}

/**
 * Build path for a card
 * @param identifier
 */
export function buildCardPath(identifier: string | null): string {
  const slug = makeCardSlug(identifier);
  if (!slug) {
    return '/card';
  }
  const pathSlug = slug.includes(':') ? slug.replace(COLON_PATTERN, PATH_SAFE_SLUG_SEPARATOR) : slug;
  return `/card/${encodeURIComponent(pathSlug)}`;
}

/**
 * Parse card route from location
 * @param loc
 */
export function parseCardRoute(loc: Location = window.location): RouteInfo {
  const params = new URLSearchParams(loc.search || '');
  if (params.has('name')) {
    const identifier = params.get('name');
    return { source: 'query', identifier, slug: null };
  }

  const hashMatch = (loc.hash || '').match(/^#card\/(.+)$/);
  if (hashMatch) {
    return {
      source: 'hash',
      identifier: decodeURIComponent(hashMatch[1]),
      slug: null
    };
  }

  const path = loc.pathname || '';
  const match = path.match(/\/card(?:\.html)?(?:\/([^/?#]+))?\/?$/i);
  if (match) {
    const rawSlug = match[1] ? decodeURIComponent(match[1]) : null;
    const normalizedSlug = rawSlug ? rawSlug.replace(PATH_SEPARATOR_PATTERN, ':') : null;
    return {
      source: normalizedSlug ? 'slug' : 'landing',
      identifier: null,
      slug: normalizedSlug
    };
  }

  return { source: 'other', identifier: null, slug: null };
}

/**
 * Resolve card slug to identifier
 * @param slug
 * @param options
 */
export async function resolveCardSlug(slug: string, options: ResolveOptions = {}): Promise<string | null> {
  const normalized = normalizeSlug(slug);
  if (!normalized) {
    return null;
  }

  const cache = loadSlugCache();
  if (cache[normalized]) {
    return cache[normalized];
  }

  if (normalized.includes(':')) {
    const [setCode, number] = normalized.split(':');
    const resolved = await resolveBySetAndNumber(setCode, number, options);
    if (resolved) {
      return resolved;
    }
  }

  const resolvedByName = await resolveByName(normalized, options);
  if (resolvedByName) {
    return resolvedByName;
  }

  return null;
}

/**
 * Describe slug for display
 * @param slug
 */
export function describeSlug(slug: string | null): string {
  if (!slug) {
    return '';
  }
  const normalized = normalizeSlug(slug);
  if (normalized.includes(':')) {
    const [setCode, number] = normalized.split(':');
    return `${setCode} ${number}`.trim();
  }
  return normalized.replace(/-/g, ' ');
}
