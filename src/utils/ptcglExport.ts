/**
 * Pokémon TCG Live (PTCGL) decklist text generation.
 *
 * Turns a flat list of cards (already counted by copies) into the text format
 * PTCGL's "Import" accepts: three sections (Pokémon / Trainer / Energy), each
 * `"<Label>: <section total>"` followed by `"<count> <name> <SET> <number>"`
 * lines, then a `"Total Cards: <n>"` footer.
 *
 * Pure module — no DOM. The caller handles clipboard/download.
 */
import { type CardSupercategory, cardSupercategory } from '../lib/cardStats';

export interface PtcglEntry {
  name: string;
  set?: string;
  number?: string | number;
  /** Category path (e.g. "pokemon", "trainer/supporter", "energy/basic"). */
  category?: string;
  /** Pokémon TCG supertype, used as a fallback when category is absent. */
  supertype?: string;
  /** Copies of this card in the list (already rounded). */
  count: number;
}

export type PtcglSection = CardSupercategory;

/**
 * Strip leading zeros from a collector number while preserving any letter
 * suffix: "002" → "2", "118A" → "118A", "118" → "118".
 */
export function ptcglNumber(n: string | number | null | undefined): string {
  const raw = String(n ?? '').trim();
  if (!raw) {
    return '';
  }
  return raw.replace(/^0+(?=\d)/, '');
}

/**
 * Map a card to one of PTCGL's three sections. Mirrors `classify()` in
 * SocialGraphicsPage — prefix-match `category` (which is heterogeneous: flat
 * "trainer" in live data, deep "trainer/supporter" in snapshots) or fall back
 * to `supertype`. Unknown cards default to Pokémon.
 */
export function ptcglSection(entry: { category?: string; supertype?: string }): PtcglSection {
  return cardSupercategory(entry);
}

function formatLine(entry: PtcglEntry): string {
  const num = ptcglNumber(entry.number);
  const set = entry.set ? String(entry.set).toUpperCase() : '';
  if (set && num) {
    return `${entry.count} ${entry.name} ${set} ${num}`;
  }
  // Basic energy occasionally arrives without a set/number; emit a bare line.
  return `${entry.count} ${entry.name}`;
}

const SECTION_ORDER: { label: string; key: PtcglSection }[] = [
  { label: 'Pokémon', key: 'pokemon' },
  { label: 'Trainer', key: 'trainer' },
  { label: 'Energy', key: 'energy' }
];

/**
 * Build the PTCGL decklist text plus per-section and grand totals.
 */
export function buildPtcglDeck(entries: PtcglEntry[]): {
  text: string;
  total: number;
  sections: Record<PtcglSection, number>;
} {
  const buckets: Record<PtcglSection, PtcglEntry[]> = { pokemon: [], trainer: [], energy: [] };
  for (const entry of entries) {
    if (!entry || !Number.isFinite(entry.count) || entry.count <= 0) {
      continue;
    }
    buckets[ptcglSection(entry)].push(entry);
  }

  const sections: Record<PtcglSection, number> = { pokemon: 0, trainer: 0, energy: 0 };
  const blocks: string[] = [];
  let total = 0;

  for (const { label, key } of SECTION_ORDER) {
    const list = [...buckets[key]].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    const sectionTotal = list.reduce((sum, e) => sum + e.count, 0);
    sections[key] = sectionTotal;
    total += sectionTotal;
    if (!list.length) {
      continue;
    }
    blocks.push(`${label}: ${sectionTotal}\n${list.map(formatLine).join('\n')}`);
  }

  const body = blocks.join('\n\n');
  const text = body ? `${body}\n\nTotal Cards: ${total}` : `Total Cards: ${total}`;
  return { text, total, sections };
}
