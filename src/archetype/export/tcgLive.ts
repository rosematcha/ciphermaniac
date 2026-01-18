import type { SkeletonExportEntry } from '../types.js';

const TCG_LIVE_SECTION_ORDER = [
  { key: 'pokemon', label: 'Pok\u00E9mon' },
  { key: 'trainer', label: 'Trainer' },
  { key: 'energy', label: 'Energy' }
];

/**
 * Build a TCG Live compatible deck list string.
 * @param entries - Skeleton export entries.
 */
export function buildTcgliveExportString(entries: SkeletonExportEntry[]): string {
  if (!Array.isArray(entries) || entries.length === 0) {
    return '';
  }

  const sections: Record<string, SkeletonExportEntry[]> = {
    pokemon: [],
    trainer: [],
    energy: []
  };

  entries.forEach(entry => {
    if (!entry || !Number.isFinite(entry.copies) || entry.copies <= 0) {
      return;
    }
    const key =
      entry.primaryCategory === 'trainer' ? 'trainer' : entry.primaryCategory === 'energy' ? 'energy' : 'pokemon';
    sections[key].push(entry);
  });

  const lines: string[] = [];

  TCG_LIVE_SECTION_ORDER.forEach(({ key, label }) => {
    const cards = sections[key];
    if (!cards || cards.length === 0) {
      return;
    }
    const sectionTotal = cards.reduce((total, card) => total + card.copies, 0);
    lines.push(`${label}: ${sectionTotal}`);
    cards.forEach(card => {
      const parts = [String(card.copies), card.name];
      if (card.set) {
        parts.push(card.set);
      }
      if (card.number) {
        parts.push(card.number);
      }
      lines.push(parts.join(' '));
    });
    lines.push('');
  });

  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  return lines.join('\n');
}
