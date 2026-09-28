/**
 * Decklists as players paste them: PTCGL's export text, or anything close to
 * it. Section headers ("Pokémon: 12") and the "Total Cards" footer are read
 * when present and ignored when not; each card line is a count, a name, and
 * optionally a set code and collector number.
 *
 * Checking is deliberately shallow. A deck's total and the four-copy rule can
 * be read from the text alone; legality by set, ACE SPEC and Radiant limits
 * need card data this module does not carry, so the organizer still reads the
 * list. Problems are reported, never fixed, so what the organizer sees is what
 * the player sent.
 */

export type DeckSection = 'pokemon' | 'trainer' | 'energy';

export interface DeckCard {
  count: number;
  name: string;
  set: string;
  number: string;
  section: DeckSection;
}

export interface ParsedDeck {
  cards: DeckCard[];
  total: number;
  /** Lines that were neither a header, a footer nor a card. */
  unread: string[];
  problems: string[];
}

export const DECK_SIZE = 60;
export const MAX_COPIES = 4;
/** Long enough for any real list with notes; short enough to store per player. */
export const MAX_DECKLIST_CHARS = 6000;

const HEADER_RE = /^(pok[eé]mon|trainers?|energy)\s*(?:[:-]\s*\d*)?$/i;
const FOOTER_RE = /^total\s+cards\s*:?\s*\d*$/i;
const LINE_RE = /^(?:\*\s*)?(\d{1,2})x?\s+(.+?)(?:\s+([A-Z][A-Z0-9-]{1,5})\s+([A-Z]{0,4}\d{1,4}[a-z]?))?$/;

const BASIC_ENERGY_NAMES = new Set(
  ['grass', 'fire', 'water', 'lightning', 'psychic', 'fighting', 'darkness', 'metal', 'fairy'].flatMap(type => [
    `${type} energy`,
    `basic ${type} energy`
  ])
);

/** Basic energy is exempt from the copy limit; PTCGL writes it both as "Psychic Energy" and "Basic {P} Energy". */
export function isBasicEnergy(name: string): boolean {
  const normalized = name.toLowerCase().trim();
  return BASIC_ENERGY_NAMES.has(normalized) || /^basic \{[a-z]\} energy$/.test(normalized);
}

function sectionOf(header: string): DeckSection {
  const lower = header.toLowerCase();
  if (lower.startsWith('trainer')) {
    return 'trainer';
  }
  return lower.startsWith('energy') ? 'energy' : 'pokemon';
}

function readCard(line: string, section: DeckSection): DeckCard | null {
  const match = LINE_RE.exec(line);
  if (!match) {
    return null;
  }
  const count = Number(match[1]);
  const name = (match[2] ?? '').trim();
  if (count < 1 || !name) {
    return null;
  }
  // A line with no header above it that names an energy is still energy.
  const inferred = section === 'pokemon' && isBasicEnergy(name) ? 'energy' : section;
  return { count, name, set: match[3] ?? '', number: match[4] ?? '', section: inferred };
}

function copyProblems(cards: readonly DeckCard[]): string[] {
  const byName = new Map<string, number>();
  for (const card of cards) {
    if (!isBasicEnergy(card.name)) {
      byName.set(card.name, (byName.get(card.name) ?? 0) + card.count);
    }
  }
  return [...byName]
    .filter(([, count]) => count > MAX_COPIES)
    .map(([name, count]) => `${count} copies of ${name} (the limit is ${MAX_COPIES})`);
}

/** Reads a pasted decklist and lists what is wrong with it. */
export function parseDecklist(text: string): ParsedDeck {
  const cards: DeckCard[] = [];
  const unread: string[] = [];
  let section: DeckSection = 'pokemon';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || FOOTER_RE.test(line)) {
      continue;
    }
    if (HEADER_RE.test(line)) {
      section = sectionOf(line);
      continue;
    }
    const card = readCard(line, section);
    if (card) {
      cards.push(card);
    } else {
      unread.push(line);
    }
  }
  const total = cards.reduce((sum, card) => sum + card.count, 0);
  const problems = [
    ...(total === DECK_SIZE ? [] : [`${total} cards (a deck is ${DECK_SIZE})`]),
    ...copyProblems(cards),
    ...(unread.length > 0 ? [`${unread.length} line${unread.length === 1 ? '' : 's'} not read as a card`] : [])
  ];
  return { cards, total, unread, problems };
}
