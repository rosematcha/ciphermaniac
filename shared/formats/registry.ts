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
export type FormatSource = {
  kind: 'limitless-online';
  /** Limitless format id, upper case (`EXPANDED`, `EX`, `RMEP`, `CUSTOM`). */
  format: string;
  organizerId?: number;
  /** Keep only events whose name contains this text. */
  nameIncludes?: string;
};

export interface FormatScope {
  id: string;
  label: string;
  /** Short description of the window, shown beside the label. */
  windowLabel: string;
  window: FormatWindow;
  source: FormatSource;
  /** Smallest field (players with a placing) that contributes decks. */
  minFieldPlayers: number;
  /** Smallest field whose pairings feed the matchup matrix. */
  minMatchupFieldPlayers: number;
}

export const FORMAT_SCOPES: readonly FormatScope[] = [
  {
    id: 'expanded',
    label: 'Expanded',
    windowLabel: 'last 4 sets',
    window: { kind: 'sets', count: 4 },
    source: { kind: 'limitless-online', format: 'EXPANDED' },
    minFieldPlayers: 4,
    minMatchupFieldPlayers: 8
  },
  {
    id: 'rspk',
    label: 'RS-PK',
    windowLabel: 'last 60 days',
    window: { kind: 'days', days: 60 },
    source: { kind: 'limitless-online', format: 'EX' },
    minFieldPlayers: 4,
    minMatchupFieldPlayers: 8
  },
  {
    id: 'efg',
    label: 'EFG',
    windowLabel: 'all time',
    window: { kind: 'all', since: '2022-01-01' },
    source: { kind: 'limitless-online', format: 'RMEP' },
    minFieldPlayers: 4,
    minMatchupFieldPlayers: 8
  },
  {
    id: 'eternal',
    label: 'Eternal',
    windowLabel: 'last 12 months',
    window: { kind: 'days', days: 365 },
    source: { kind: 'limitless-online', format: 'CUSTOM', organizerId: 90, nameIncludes: 'Eternal' },
    minFieldPlayers: 0,
    minMatchupFieldPlayers: 0
  }
];

/** R2 root every format folder sits under. */
export const FORMATS_ROOT = 'reports/Formats';

/** Path of the index listing the published formats. */
export const FORMATS_INDEX_PATH = `${FORMATS_ROOT}/index.json`;

/** R2 folder of a format's report. */
export function formatFolder(id: string): string {
  return `${FORMATS_ROOT}/${id}`;
}

/** One published format, as listed in `reports/Formats/index.json`. */
export interface FormatsIndexEntry {
  id: string;
  label: string;
  window: string;
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
