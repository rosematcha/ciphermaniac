/**
 * The global search box's index and ranking, as pure functions.
 *
 * Entries from every searchable surface (archetypes, cards, players,
 * tournaments) are flattened into one list with pre-folded match keys, then
 * ranked in tiers: exact key, label prefix, label word-start, substring. No
 * Solid, no DOM, no fetching; the loader takes its fetchers as arguments so
 * its laziness can be tested in isolation.
 * @module lib/globalSearch
 */

import type { PlayerIndexSlimEntry } from '../../shared/playerTypes';
import { tournamentDate } from '../../shared/data/tournamentKeys';
import { foldSearch } from '../utils/searchFold';
import { formatPercent, nameFromTournamentKey, shortDate } from './format';
import { scopeParam } from './scopeUrl';
import type { ArchetypeIndexEntry, CardItem } from '../types';

export type SearchKind = 'archetype' | 'card' | 'player' | 'tournament';

/** Kind order within a tier. */
const KIND_PRIORITY: Record<SearchKind, number> = { archetype: 0, card: 1, player: 2, tournament: 3 };

interface BaseEntry {
  label: string;
  sublabel: string;
  href: string;
  /** Pre-folded strings a query word can match exactly or as a substring. */
  keys: string[];
  /** Folded label, for the prefix tier. */
  labelFold: string;
  /** Folded label words, for the word-start tier. */
  labelWords: string[];
  /** Prominence within its kind; higher ranks first. */
  weight: number;
}

export type SearchEntry = BaseEntry &
  (
    | { kind: 'archetype'; icons: string[] }
    | { kind: 'card'; set: string; number: string }
    | { kind: 'player' }
    | { kind: 'tournament'; tournament: string; date: string }
  );

export interface SearchSources {
  cards?: readonly CardItem[] | null;
  archetypes?: readonly ArchetypeIndexEntry[] | null;
  players?: readonly PlayerIndexSlimEntry[] | null;
  /** Tournament keys, most recent first. */
  tournaments?: readonly string[] | null;
}

/** 1 exact key, 2 label prefix, 3 label word-start, 4 substring. */
export type SearchTier = 1 | 2 | 3 | 4;

export interface SearchHit {
  entry: SearchEntry;
  tier: SearchTier;
}

export interface SearchGroup {
  kind: SearchKind;
  hits: SearchHit[];
}

export interface SearchResults {
  groups: SearchGroup[];
  /** Every hit in display order (groups concatenated), for keyboard movement. */
  hits: SearchHit[];
}

export interface SearchLimits {
  perKind: number;
  total: number;
}

const DEFAULT_LIMITS: SearchLimits = { perKind: 5, total: 20 };

function splitWords(folded: string): string[] {
  return folded.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

interface BaseInput {
  label: string;
  sublabel: string;
  href: string;
  extraKeys: string[];
  weight: number;
}

function base({ label, sublabel, href, extraKeys, weight }: BaseInput): BaseEntry {
  const labelFold = foldSearch(label);
  return {
    label,
    sublabel,
    href,
    keys: [labelFold, ...extraKeys.map(foldSearch)],
    labelFold,
    labelWords: splitWords(labelFold),
    weight
  };
}

function archetypeEntries(list: readonly ArchetypeIndexEntry[]): SearchEntry[] {
  return list.map(a => ({
    ...base({
      label: a.label || a.name,
      sublabel: a.percent === null ? '' : formatPercent(a.percent),
      href: `/archetypes/${encodeURIComponent(a.name)}`,
      extraKeys: [a.name.replace(/_/g, ' ')],
      weight: a.percent ?? 0
    }),
    kind: 'archetype',
    icons: a.icons ?? []
  }));
}

function cardEntry(item: CardItem): SearchEntry | null {
  if (!item.set || item.number === undefined || item.number === null) {
    return null;
  }
  const { set } = item;
  const number = String(item.number);
  return {
    ...base({
      label: item.name,
      sublabel: `${set} ${number}`,
      href: `/cards/${encodeURIComponent(set)}/${encodeURIComponent(number)}`,
      extraKeys: [`${set} ${number}`, `${set}/${number}`, `${set}${number}`],
      weight: item.pct
    }),
    kind: 'card',
    set,
    number
  };
}

function playerEntries(list: readonly PlayerIndexSlimEntry[]): SearchEntry[] {
  return list.map(p => ({
    ...base({
      label: p.name,
      sublabel: `${p.eventCount} ${p.eventCount === 1 ? 'event' : 'events'}`,
      href: `/players/${encodeURIComponent(p.playerId)}`,
      extraKeys: [],
      weight: p.eventCount
    }),
    kind: 'player'
  }));
}

/** The home page scoped to a tournament, per the `?scope=` URL param. */
function tournamentHref(key: string): string {
  const scope = scopeParam(key);
  return scope ? `/?scope=${encodeURIComponent(scope)}` : '/';
}

function tournamentEntries(keys: readonly string[]): SearchEntry[] {
  return keys.map((key, i) => {
    const date = tournamentDate(key);
    return {
      ...base({
        label: nameFromTournamentKey(key),
        sublabel: date ? date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '',
        href: tournamentHref(key),
        extraKeys: [key],
        weight: -i
      }),
      kind: 'tournament',
      tournament: key,
      date: date ? shortDate(date) : ''
    };
  });
}

/**
 * Flatten every loaded source into one searchable list. Missing sources are
 * skipped, so a partially loaded index still searches what it has.
 * @param sources - Whatever indices have loaded so far
 * @returns Entries with pre-folded keys
 */
export function buildSearchIndex(sources: SearchSources): SearchEntry[] {
  const cards = (sources.cards ?? []).map(cardEntry).filter((e): e is SearchEntry => e !== null);
  return [
    ...archetypeEntries(sources.archetypes ?? []),
    ...cards,
    ...playerEntries(sources.players ?? []),
    ...tournamentEntries(sources.tournaments ?? [])
  ];
}

function wordTier(entry: SearchEntry, word: string): SearchTier | null {
  if (entry.keys.includes(word)) {
    return 1;
  }
  if (entry.labelFold.startsWith(word)) {
    return 2;
  }
  if (entry.labelWords.some(w => w.startsWith(word))) {
    return 3;
  }
  return entry.keys.some(k => k.includes(word)) ? 4 : null;
}

/** Tier of the whole query: an exact key wins outright, else the weakest word's tier. */
function entryTier(entry: SearchEntry, phrase: string, words: readonly string[]): SearchTier | null {
  if (entry.keys.includes(phrase)) {
    return 1;
  }
  let worst: SearchTier = 1;
  for (const word of words) {
    const tier = wordTier(entry, word);
    if (tier === null) {
      return null;
    }
    worst = Math.max(worst, tier) as SearchTier;
  }
  return worst;
}

function compareHits(a: SearchHit, b: SearchHit): number {
  return (
    a.tier - b.tier ||
    KIND_PRIORITY[a.entry.kind] - KIND_PRIORITY[b.entry.kind] ||
    b.entry.weight - a.entry.weight ||
    a.entry.label.localeCompare(b.entry.label) ||
    a.entry.href.localeCompare(b.entry.href)
  );
}

function capHits(sorted: readonly SearchHit[], limits: SearchLimits): SearchHit[] {
  const perKind = new Map<SearchKind, number>();
  const out: SearchHit[] = [];
  for (const hit of sorted) {
    if (out.length >= limits.total) {
      break;
    }
    const count = perKind.get(hit.entry.kind) ?? 0;
    if (count < limits.perKind) {
      perKind.set(hit.entry.kind, count + 1);
      out.push(hit);
    }
  }
  return out;
}

/** Group capped hits by kind, groups ordered by their best hit. */
function groupHits(hits: readonly SearchHit[]): SearchGroup[] {
  const groups = new Map<SearchKind, SearchGroup>();
  for (const hit of hits) {
    const group = groups.get(hit.entry.kind) ?? { kind: hit.entry.kind, hits: [] };
    group.hits.push(hit);
    groups.set(hit.entry.kind, group);
  }
  return [...groups.values()];
}

/**
 * Rank the index against a query in tiers, then kind, then prominence.
 * @param index - From {@link buildSearchIndex}
 * @param query - Raw input text
 * @param limits - Per-kind and total caps
 * @returns Grouped hits plus the flat display order
 */
export function searchTiered(
  index: readonly SearchEntry[],
  query: string,
  limits: SearchLimits = DEFAULT_LIMITS
): SearchResults {
  const phrase = splitWords(foldSearch(query)).join(' ');
  const exactPhrase = foldSearch(query.trim()).replace(/\s+/g, ' ');
  if (!phrase) {
    return { groups: [], hits: [] };
  }
  const words = phrase.split(' ');
  const matched: SearchHit[] = [];
  for (const entry of index) {
    const tier = entryTier(entry, exactPhrase, words);
    if (tier !== null) {
      matched.push({ entry, tier });
    }
  }
  const groups = groupHits(capHits(matched.sort(compareHits), limits));
  return { groups, hits: groups.flatMap(g => g.hits) };
}

export interface SearchFetchers {
  cards: (scope: string) => Promise<readonly CardItem[]>;
  archetypes: (scope: string) => Promise<readonly ArchetypeIndexEntry[]>;
  players: () => Promise<readonly PlayerIndexSlimEntry[] | null>;
  tournaments: () => Promise<readonly string[]>;
}

function memoize<T>(fetch: (key: string) => Promise<T>): (key: string) => Promise<T> {
  const cache = new Map<string, Promise<T>>();
  return key => {
    let pending = cache.get(key);
    if (!pending) {
      pending = fetch(key);
      cache.set(key, pending);
      // A failure is evicted so the next open retries instead of caching it.
      pending.catch(() => cache.delete(key));
    }
    return pending;
  };
}

/**
 * Session-cached source loaders. Nothing is fetched until a method is called,
 * which the box does only once it is opened; the players index is the
 * heaviest and must never load with the page. Cards and archetypes cache per
 * scope, players and tournaments once.
 * @param fetchers - The underlying data fetchers
 * @returns Memoized loaders with the same shape
 */
export function createSearchLoader(fetchers: SearchFetchers): SearchFetchers {
  const players = memoize(() => fetchers.players());
  const tournaments = memoize(() => fetchers.tournaments());
  return {
    cards: memoize(scope => fetchers.cards(scope)),
    archetypes: memoize(scope => fetchers.archetypes(scope)),
    players: () => players(''),
    tournaments: () => tournaments('')
  };
}
