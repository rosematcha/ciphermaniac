/**
 * The non-Standard formats the site publishes, and the keys that name them.
 *
 * Each format is one report folder under `reports/Formats/<id>/` with the same
 * artifact shapes as the Standard online meta, plus one shared index listing
 * what was published. Formats stay out of `reports/tournaments.json` on purpose:
 * every surface that reads that list (Home, Trends, players, earnings, the
 * meta binder) is Standard-only and stays that way without knowing formats exist.
 * @module shared/formats/registry
 */

/** How far back a format's report reaches. */
export type FormatWindow =
  | { kind: 'days'; days: number }
  /** The newest `count` Standard release groups, counted from the oldest one's release. */
  | { kind: 'sets'; count: number }
  | { kind: 'all'; since: string };

/** Where a format's decks come from. */
export type FormatSource =
  | {
      kind: 'limitless-online';
      /** Limitless format id, upper case (`EXPANDED`, `EX`, `RMEP`, `GLC`, `2010`, `CUSTOM`). */
      format: string;
      organizerId?: number;
      /** Keep only events whose name contains this text. */
      nameIncludes?: string;
    }
  | {
      /** Japanese City League pages on limitlesstcg.com. */
      kind: 'limitless-jp';
    };

/**
 * How a format names each card's print. Set codes are catalog codes
 * (`.github/scripts/data/set-catalog.json`), which orders them by release.
 */
export interface FormatCanon {
  /**
   * The legal sets: everything, or a release range plus any sets outside it.
   * `newest` omitted means through the newest set.
   */
  sets: 'all' | { oldest: string; newest?: string; also?: readonly string[] };
  /**
   * Which end of the legal range names a card. Period formats show the print
   * of their era (oldest); open-ended ones show the newest base-rarity print.
   */
  prefer: 'oldest' | 'newest';
  /** A set whose basic energies the format shows, for the listed types. */
  basicEnergy?: { set: string; types: readonly string[] };
}

export interface FormatScope {
  id: string;
  label: string;
  /**
   * Short description of the window, shown beside the label. Only City
   * Leagues carries one: its two weeks are what readers need to know.
   */
  windowLabel?: string;
  window: FormatWindow;
  source: FormatSource;
  /** Smallest field (players with a placing) that contributes decks. */
  minFieldPlayers: number;
  /** Smallest field whose pairings feed the matchup matrix. */
  minMatchupFieldPlayers: number;
  /** The format's own print choice; absent means the Standard canonical. */
  canon?: FormatCanon;
}

const EX_ERA_BASIC_TYPES = ['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting'] as const;
const BASIC_TYPES = [...EX_ERA_BASIC_TYPES, 'Darkness', 'Metal'] as const;

/** In the order the site lists them. */
export const FORMAT_SCOPES: readonly FormatScope[] = [
  {
    id: 'city-leagues',
    label: 'City Leagues',
    windowLabel: 'last 14 days',
    window: { kind: 'days', days: 14 },
    source: { kind: 'limitless-jp' },
    minFieldPlayers: 0,
    minMatchupFieldPlayers: 0
  },
  {
    id: 'expanded',
    label: 'Expanded',
    window: { kind: 'sets', count: 4 },
    source: { kind: 'limitless-online', format: 'EXPANDED' },
    minFieldPlayers: 4,
    minMatchupFieldPlayers: 8,
    canon: { sets: { oldest: 'BLW', also: ['BWP'] }, prefer: 'newest' }
  },
  {
    id: 'eternal',
    label: 'Eternal',
    window: { kind: 'days', days: 365 },
    source: { kind: 'limitless-online', format: 'CUSTOM', organizerId: 90, nameIncludes: 'Eternal' },
    minFieldPlayers: 0,
    minMatchupFieldPlayers: 0,
    canon: { sets: 'all', prefer: 'newest' }
  },
  {
    // Gym Leader Challenge: singleton, one type per deck, Expanded's card pool.
    // Limitless names each deck by its type.
    id: 'glc',
    label: 'GLC',
    window: { kind: 'days', days: 60 },
    source: { kind: 'limitless-online', format: 'GLC' },
    minFieldPlayers: 4,
    minMatchupFieldPlayers: 8,
    canon: { sets: { oldest: 'BLW', also: ['BWP'] }, prefer: 'newest' }
  },
  {
    id: 'rspk',
    label: 'RS-PK',
    window: { kind: 'days', days: 60 },
    source: { kind: 'limitless-online', format: 'EX' },
    minFieldPlayers: 4,
    minMatchupFieldPlayers: 8,
    // ex Ruby & Sapphire through ex Power Keepers, POP 1-5 and the Nintendo
    // black star promos. Basic energies show their Expedition prints.
    canon: {
      sets: { oldest: 'RS', newest: 'P5', also: ['NP'] },
      prefer: 'oldest',
      basicEnergy: { set: 'E1', types: EX_ERA_BASIC_TYPES }
    }
  },
  {
    // Diamond & Pearl through Unleashed and the DP promos. Basic energies show
    // the HeartGold SoulSilver prints the lists play. Its pool never changes,
    // so a year of events is no staler than a month.
    id: 'worlds-2010',
    label: 'Worlds 2010',
    window: { kind: 'days', days: 365 },
    source: { kind: 'limitless-online', format: '2010' },
    minFieldPlayers: 4,
    minMatchupFieldPlayers: 8,
    canon: {
      sets: { oldest: 'DP', newest: 'UL', also: ['DPP'] },
      prefer: 'oldest',
      basicEnergy: { set: 'HS', types: BASIC_TYPES }
    }
  },
  {
    id: 'efg',
    label: 'EFG',
    window: { kind: 'all', since: '2022-01-01' },
    source: { kind: 'limitless-online', format: 'RMEP' },
    minFieldPlayers: 4,
    minMatchupFieldPlayers: 8,
    canon: {
      sets: { oldest: 'BST', newest: 'PAF', also: ['SP'] },
      prefer: 'oldest',
      basicEnergy: { set: 'BRS', types: BASIC_TYPES }
    }
  }
];

/** R2 root every format folder sits under. */
export const FORMATS_ROOT = 'reports/Formats';

/** Path of the index listing the published formats. */
export const FORMATS_INDEX_PATH = `${FORMATS_ROOT}/index.json`;

const KEY_PREFIX = 'format:';

/** The scope key the site passes around for a format, e.g. `format:rspk`. */
export function formatScopeKey(id: string): string {
  return `${KEY_PREFIX}${id}`;
}

/** The format id inside a scope key, or null when the key is not a format. */
export function formatIdFromKey(key: string): string | null {
  return key.startsWith(KEY_PREFIX) ? key.slice(KEY_PREFIX.length) : null;
}

/** A format's display label, or its id when the registry doesn't know it. */
export function formatLabel(id: string): string {
  return FORMAT_SCOPES.find(format => format.id === id)?.label ?? id;
}

/**
 * Whether a scope's decks come from Limitless Play, so its events link to Play
 * standings: the Standard online meta, or a format sourced there.
 */
export function isLimitlessPlayScope(key: string, onlineKey: string): boolean {
  const id = formatIdFromKey(key);
  return (
    key === onlineKey || FORMAT_SCOPES.some(format => format.id === id && format.source.kind === 'limitless-online')
  );
}

/** R2 folder of a format's report. */
export function formatFolder(id: string): string {
  return `${FORMATS_ROOT}/${id}`;
}

/** One published format, as listed in `reports/Formats/index.json`. */
export interface FormatsIndexEntry {
  id: string;
  label: string;
  window?: string;
  events: number;
  decks: number;
  windowStart: string;
  windowEnd: string;
}

export interface FormatsIndex {
  generatedAt: string;
  formats: FormatsIndexEntry[];
  /** Formats whose run failed; their previous report, if any, stays published. */
  failed?: Array<{ id: string; message: string }>;
}
