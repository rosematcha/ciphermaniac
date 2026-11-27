/**
 * The formats the Formats tab ranks, each drawn as three cards that stand for
 * it. A hand-picked list rather than data: which cards say "this is 2010" is an
 * editorial call no report makes, and the list changes about as often as a new
 * format gets popular.
 * @module pages/tierList/formats
 */

import type { CustomFormat, TierItem } from './model';

interface RankedFormat {
  /** Rides in shared links, so never rename one. */
  id: string;
  label: string;
  /** `SET/NUMBER`, fanned left to right. */
  cards: [string, string, string];
}

const FORMATS: readonly RankedFormat[] = [
  { id: 'standard', label: 'Standard', cards: ['TWM/130', 'MEG/104', 'PRE/037'] },
  { id: 'svi-asc', label: 'SVI-ASC', cards: ['SVI/086', 'PAR/139', 'TWM/130'] },
  { id: 'efg', label: 'EFG', cards: ['LOR/131', 'OBF/125', 'FST/114'] },
  { id: 'glc', label: 'GLC', cards: ['SCR/118', 'SIT/068', 'SSH/056'] },
  { id: 'expanded', label: 'Expanded', cards: ['SIT/136', 'PGO/055', 'CRE/075'] },
  { id: 'eternal', label: 'Eternal', cards: ['BRS/123', 'FLI/024', 'SCR/128'] },
  { id: 'unlimited', label: 'Unlimited', cards: ['SF/048', 'GE/081', 'FLF/098'] },
  { id: '2010', label: '2010', cards: ['RR/109', 'SV/145', 'SF/019'] },
  { id: 'rs-pk', label: 'RS-PK', cards: ['TRR/019', 'DF/093', 'DF/097'] },
  { id: 'base-rocket', label: 'Base-Rocket', cards: ['WP/003', 'JU/005', 'FO/013'] },
  { id: '2011', label: '2011', cards: ['TM/098', 'TM/096', 'BLW/026'] },
  { id: 'nxd-xy', label: 'NXD-XY', cards: ['DEX/063', 'PLB/011', 'BCR/031'] },
  { id: '2016', label: '2016', cards: ['BKP/040', 'PHF/026', 'AOR/010'] },
  { id: 'prc-gri', label: 'PRC-GRI', cards: ['GRI/060', 'SUM/012', 'STS/026'] },
  { id: 'sum-lot', label: 'SUM-LOT', cards: ['SLG/053', 'FLI/051', 'LOT/052'] },
  { id: 'teu-evs', label: 'TEU-EVS', cards: ['TEU/033', 'SSH/138', 'BST/088'] }
];

export const FORMAT_ITEMS: readonly TierItem[] = FORMATS.map(format => ({
  id: format.id,
  label: format.label,
  kind: 'format',
  thumbs: format.cards
}));

/** Lowercased, for refusing a typed name the list already has. */
export const FORMAT_LABELS: readonly string[] = FORMATS.map(format => format.label.toLowerCase());

/**
 * A typed format drawn as the Substitute doll under its name. Its id is
 * prefixed so a typed "2010" can never be mistaken for the listed one in a
 * placement or a shared link.
 */
export function customFormatItem(format: CustomFormat): TierItem {
  return { id: `custom:${format.name}`, label: format.name, kind: 'format', thumbs: [], customId: format.id };
}

/** Names already sent this session, so retyping one counts it once. */
const reported = new Set<string>();

/**
 * Tells the site a format was typed in, so the list can grow toward what people
 * actually rank. Fire and forget: nothing about it may slow down or fail the
 * board.
 */
export function reportCustomFormat(name: string): void {
  const key = name.toLowerCase();
  if (reported.has(key)) {
    return;
  }
  reported.add(key);
  fetch('/api/format-request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
    keepalive: true
  }).catch(() => undefined);
}
