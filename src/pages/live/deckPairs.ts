/**
 * A deck named for two Pokémon, typed into the one box: the first Pokémon's
 * whole name, a space, then the second, found the way the first was. The
 * archetypes the site already names come first, so "Dragapult D" still leads
 * with Dragapult Dusknoir, and a pair the site already names in either order
 * is offered as that archetype rather than a second copy of it.
 */

import { rankByQuery, SUGGESTION_LIMIT } from '@ciphermaniac/design/lib/rankByQuery';
import type { ReportedDeck } from './reportedDeck';

type Species = typeof import('../../../shared/pokemon/species');

/** How many of the site's own archetypes lead the list, leaving the rest of it to pairs. */
const NAMED_LIMIT = 4;

interface Ranking {
  weight: (deck: ReportedDeck) => number;
  tier: (deck: ReportedDeck) => number;
}

/** The decks the list already names as two Pokémon, by the label such a pair is saved under. */
function namedPairs(decks: readonly ReportedDeck[], species: Species): Map<string, ReportedDeck> {
  return new Map(
    decks.flatMap(deck => {
      const pair = species.speciesPair(deck.label);
      return pair ? [[species.pairLabel(...pair), deck] as const] : [];
    })
  );
}

/**
 * The list for a query that opens with a whole Pokémon and a space, or
 * undefined for any other query, which the box ranks as usual.
 */
export function pairSearch(
  decks: readonly ReportedDeck[],
  query: string,
  species: Species,
  ranking: Ranking
): ReportedDeck[] | undefined {
  const typed = species.pairLead(query);
  if (!typed) {
    return undefined;
  }
  const { lead, tail } = typed;
  const named = rankByQuery(decks, query, deck => deck.label, { ...ranking, limit: NAMED_LIMIT });
  const known = namedPairs(decks, species);
  const seconds = species.SPECIES_LABELS.filter(label => label !== lead);
  const pairs = rankByQuery(seconds, tail, label => label, { limit: SUGGESTION_LIMIT }).map(second => {
    const saved = species.pairLabel(lead, second);
    return known.get(saved) ?? { label: `${lead} ${second}`, pair: saved };
  });
  const shown = new Set(named);
  return [...named, ...pairs.filter(deck => !shown.has(deck) && Boolean(shown.add(deck)))].slice(0, SUGGESTION_LIMIT);
}
