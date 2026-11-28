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
  { id: 'teu-evs', label: 'TEU-EVS', cards: ['CEC/156', 'SSH/138', 'BST/088'] },
  { id: '2017', label: '2017', cards: ['BUS/093', 'GRI/051', 'BUS/017'] },
  { id: '2006', label: '2006', cards: ['LM/088', 'UF/105', 'RG/107'] },
  { id: 'hs-nvi', label: 'HS-NVI', cards: ['NVI/040', 'NVI/060', 'NVI/083'] },
  { id: 'sum-unb', label: 'SUM-UNB', cards: ['UNB/020', 'TEU/033', 'TEU/040'] },
  { id: 'bkt-cin', label: 'BKT-CIN', cards: ['CIN/057', 'SLG/053', 'GRI/074'] },
  { id: 'ssh-sit', label: 'SSH-SIT', cards: ['SIT/139', 'LOR/079', 'FST/185'] },
  { id: 'xy-evo', label: 'XY-EVO', cards: ['XY/079', 'ROS/076', 'FFI/020'] },
  { id: 'base-fossil', label: 'Base-Fossil', cards: ['JU/038', 'BS/002', 'BS/007'] },
  { id: '2014', label: '2014', cards: ['PLB/009', 'PLS/108', 'FLF/020'] },
  { id: '2004', label: '2004', cards: ['DR/096', 'MA/009', 'RS/003'] },
  { id: 'prop-15-3', label: 'Prop 15/3', cards: ['JU/016', 'G2/015', 'G2/033'] },
  { id: '2018', label: '2018', cards: ['CES/109', 'FLI/077', 'FLI/073'] },
  { id: '2015', label: '2015', cards: ['PLB/016', 'PRC/086', 'PHF/033'] },
  { id: '2009', label: '2009', cards: ['RR/108', 'RR/105', 'GE/015'] }
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
