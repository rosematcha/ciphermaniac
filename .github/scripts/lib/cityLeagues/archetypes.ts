/**
 * City League decks named by Limitless's Standard deck rules.
 *
 * Limitless labels City League decks only with Pokémon icons, which split one
 * deck across names ("Mega Kangaskhan Slowking" is Slowking). Japan runs a few
 * months ahead of Standard, so most of its decks are Standard decks, and
 * Limitless's own rules name them as Standard names them. Our rules in
 * config/archetypes/city-leagues.json cover what Japan has and Standard does
 * not yet; a deck no rule names keeps its icon name.
 * @module .github/scripts/lib/cityLeagues/archetypes
 */
import cityLeagueRules from '../../../../config/archetypes/city-leagues.json' with { type: 'json' };
import {
  type CompiledDeckRules,
  compileDeckRules,
  type DeckRule,
  deckRuleIcons,
  matchDeckRules
} from '../../../../shared/formats/deckRules';
import type { GatheredDeck } from '../../../../shared/onlineMeta/types';

const ARCHETYPE_SOURCE = 'limitless-rules';
const OWN_RULES: readonly DeckRule[] = cityLeagueRules.rules;

/**
 * Limitless's rules with ours among them. When Limitless can't be read, ours
 * alone, so the report still builds and most decks keep their icon names.
 * @param fetchRules - Reads `/games/PTCG/decks`
 * @param warn - Told when Limitless's rules are missing
 */
export async function loadCityLeagueRules(
  fetchRules: () => Promise<unknown>,
  warn: (message: string) => void
): Promise<CompiledDeckRules> {
  try {
    const limitless = await fetchRules();
    if (!Array.isArray(limitless)) {
      throw new Error('deck rules are not a list');
    }
    return compileDeckRules(limitless as DeckRule[], OWN_RULES);
  } catch (error) {
    warn(`[city-leagues] Limitless deck rules unavailable, naming by icons: ${(error as Error)?.message || error}`);
    return compileDeckRules([], OWN_RULES);
  }
}

/** Decks renamed by the rules, and the icons of the names they gave. */
export function nameCityLeagueDecks(
  decks: readonly GatheredDeck[],
  rules: CompiledDeckRules
): { decks: GatheredDeck[]; icons: Record<string, string[]> } {
  const named = decks.map(deck => {
    const match = matchDeckRules(deck.cards, rules);
    return match ? { ...deck, archetype: match.name, archetypeId: match.id, archetypeSource: ARCHETYPE_SOURCE } : deck;
  });
  return { decks: named, icons: deckRuleIcons(rules) };
}
