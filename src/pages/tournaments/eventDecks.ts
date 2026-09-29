/**
 * A format's archetypes with the event's own decks laid over them: a deck
 * already entered at the event counts as played, so it is offered with the
 * format's, and one the format's list lacks (typed in by hand) joins it.
 */

/** What a deck picker's list needs of an entry (see ReportedDeck). */
interface Listed {
  label: string;
  played?: boolean;
}

export function withEventDecks<T extends Listed>(decks: readonly T[], labels: readonly string[]): (T | Listed)[] {
  const used = new Set(labels);
  const known = new Set(decks.map(deck => deck.label));
  const typed = [...used].filter(label => !known.has(label)).map(label => ({ label, played: true }));
  return [...decks.map(deck => (used.has(deck.label) && !deck.played ? { ...deck, played: true } : deck)), ...typed];
}

let last: { decks: readonly Listed[]; key: string; result: Listed[] } | null = null;

/**
 * As withEventDecks, kept from the last call while the list and the event's
 * decks are the same: the pairings draw a picker per seat, and every one of
 * them asks for the same list.
 */
export function eventDecks<T extends Listed>(decks: readonly T[], labels: readonly string[]): (T | Listed)[] {
  const key = labels.join('\n');
  if (last?.decks !== decks || last.key !== key) {
    last = { decks, key, result: withEventDecks(decks, labels) };
  }
  return last.result as (T | Listed)[];
}
