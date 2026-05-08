import { generateReportFromDecks, normalizeArchetypeName, sanitizeForFilename } from '../data/reportBuilder.js';
import archetypeThumbnails from '../../../public/assets/data/archetype-thumbnails.json';
import type { BuildArchetypeReportsOptions, ReportData, ThumbnailConfig } from './types';

const ARCHETYPE_THUMBNAILS: ThumbnailConfig = (archetypeThumbnails as ThumbnailConfig) || {};
const AUTO_THUMB_MAX = 2;
const AUTO_THUMB_REQUIRED_PCT = 99.9;
const ARCHETYPE_DESCRIPTOR_TOKENS = new Set(['box', 'control', 'festival', 'lead', 'toolbox', 'turbo']);

function normalizeDeckLabel(label: string) {
  return String(label || '')
    .replace(/['']/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function tokenizeForMatching(text: string): string[] {
  const normalized = String(text || '')
    .replace(/['']s\b/gi, 's')
    .replace(/_/g, ' ')
    .toLowerCase();

  return normalized
    .split(/[^a-z0-9]+/gi)
    .map(token => token.trim())
    .filter(Boolean);
}

function extractArchetypeKeywords(name: string): string[] {
  return tokenizeForMatching(name).filter(token => !ARCHETYPE_DESCRIPTOR_TOKENS.has(token));
}

function formatCardNumber(raw: string | number | null | undefined): string | null {
  if (raw === undefined || raw === null) {
    return null;
  }
  const str = String(raw).trim();
  if (!str) {
    return null;
  }
  const match = str.match(/^(\d+)([A-Za-z]*)$/);
  if (!match) {
    return str.toUpperCase();
  }
  const [, digits, suffix = ''] = match;
  return `${digits.padStart(3, '0')}${suffix.toUpperCase()}`;
}

function buildThumbnailId(
  setCode: string | null | undefined,
  number: string | number | null | undefined
): string | null {
  const formattedNumber = formatCardNumber(number);
  const set = String(setCode || '')
    .toUpperCase()
    .trim();
  if (!formattedNumber || !set) {
    return null;
  }
  return `${set}/${formattedNumber}`;
}

function inferArchetypeThumbnails(displayName: string, reportData: ReportData | undefined | null): string[] {
  const keywords = extractArchetypeKeywords(displayName);
  if (!keywords.length || !reportData || !Array.isArray(reportData.items)) {
    return [];
  }
  const keywordSet = new Set(keywords);
  const candidates = [];

  reportData.items.forEach((item, index) => {
    const pct = Number(item?.pct);
    if (!Number.isFinite(pct) || pct < AUTO_THUMB_REQUIRED_PCT) {
      return;
    }
    const category = String(item?.category || '').toLowerCase();
    if (category && !category.includes('pokemon')) {
      return;
    }
    const thumbnailId = buildThumbnailId(item?.set, item?.number);
    if (!thumbnailId) {
      return;
    }
    const cardTokens = extractArchetypeKeywords(item?.name || '');
    const matchCount = cardTokens.filter(token => keywordSet.has(token)).length;
    if (matchCount === 0) {
      return;
    }
    candidates.push({
      id: thumbnailId,
      matchCount,
      pct,
      index,
      tokens: cardTokens
    });
  });

  if (!candidates.length) {
    return [];
  }

  candidates.sort(
    (first, second) => second.matchCount - first.matchCount || second.pct - first.pct || first.index - second.index
  );

  const selected: string[] = [];
  const covered = new Set<string>();
  for (const candidate of candidates) {
    const coversNewToken = candidate.tokens.some(token => keywordSet.has(token) && !covered.has(token));
    if (!coversNewToken && selected.length > 0) {
      continue;
    }
    if (selected.includes(candidate.id)) {
      continue;
    }
    selected.push(candidate.id);
    candidate.tokens.forEach(token => {
      if (keywordSet.has(token)) {
        covered.add(token);
      }
    });
    if (selected.length >= AUTO_THUMB_MAX || covered.size >= keywordSet.size) {
      break;
    }
  }

  return selected;
}

function resolveArchetypeThumbnails(
  baseName: string,
  displayName: string,
  config: ThumbnailConfig,
  reportData?: ReportData
): string[] {
  const attempts = [displayName, displayName?.replace(/_/g, ' '), baseName];
  for (const candidate of attempts) {
    if (candidate && Array.isArray(config[candidate]) && config[candidate].length) {
      return config[candidate];
    }
  }

  const normalizedTarget = normalizeDeckLabel(displayName || baseName || '');
  if (!normalizedTarget) {
    return inferArchetypeThumbnails(displayName || baseName || '', reportData);
  }

  for (const [key, ids] of Object.entries(config)) {
    if (normalizeDeckLabel(key) === normalizedTarget && ids.length) {
      return ids;
    }
  }

  return inferArchetypeThumbnails(displayName || baseName || '', reportData);
}

export function buildArchetypeReports(decks, minPercent, synonymDb, options: BuildArchetypeReportsOptions = {}) {
  const groups = new Map();
  const thumbnailConfig: ThumbnailConfig = options.thumbnailConfig || {};

  for (const deck of decks) {
    const displayName = deck?.archetype || 'Unknown';
    const normalized = normalizeArchetypeName(displayName);
    const filenameBase = sanitizeForFilename(normalized.replace(/ /g, '_')) || 'Unknown';
    if (!groups.has(normalized)) {
      groups.set(normalized, {
        displayName,
        filenameBase,
        decks: []
      });
    }
    groups.get(normalized).decks.push(deck);
  }

  const deckTotal = decks.length || 0;
  const minDecks = Math.max(1, Math.ceil(deckTotal * (minPercent / 100)));
  const archetypeFiles = [];
  const deckMap = new Map();

  groups.forEach(group => {
    if (group.decks.length < minDecks) {
      return;
    }
    const filename = `${group.filenameBase}.json`;
    const data = generateReportFromDecks(group.decks, group.decks.length, decks, synonymDb);
    archetypeFiles.push({
      filename,
      base: group.filenameBase,
      displayName: group.displayName,
      data,
      deckCount: group.decks.length
    });
    deckMap.set(group.filenameBase, group.decks);
  });

  archetypeFiles.sort((first, second) => second.deckCount - first.deckCount);

  const archetypeIndex = archetypeFiles.map(file => ({
    name: file.base,
    label: file.displayName || file.base.replace(/_/g, ' '),
    deckCount: file.deckCount,
    percent: deckTotal ? file.deckCount / deckTotal : 0,
    thumbnails: resolveArchetypeThumbnails(file.base, file.displayName, thumbnailConfig, file.data)
  }));

  return {
    archetypeFiles,
    archetypeIndex,
    minDecks,
    deckMap
  };
}

export { ARCHETYPE_THUMBNAILS };
