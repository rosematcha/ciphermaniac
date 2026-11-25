/**
 * Loads what the deck graphics draw, only while one of them is chosen.
 * @module src/pages/socialGraphics/deckData
 */

import { type Accessor, createMemo, createResource } from 'solid-js';
import { fetchMatchupProfiles, fetchParticipants } from '../../lib/data';
import { latestValue } from '../../lib/resource';
import { type DeckConversion, deckConversion, type MatchupGrid, matchupGrid, topDecks } from './decks';
import { isDeckMode, type Mode } from './model';

/** How many of the most played decks each deck graphic shows. */
const CONVERSION_DECKS = 10;
const MATCHUP_DECKS = 8;

export interface DeckData {
  conversion: Accessor<DeckConversion | null>;
  grid: Accessor<MatchupGrid | null>;
  loading: Accessor<boolean>;
  /** Whether the chosen deck graphic has everything it draws. */
  ready: Accessor<boolean>;
}

/**
 * @param mode - The chosen graphic
 * @param event - The chosen tournament, or null for a scope without one event's results
 */
export function createDeckData(mode: Accessor<Mode>, event: Accessor<string | null>): DeckData {
  // Both graphics rank decks by how many players brought them.
  const [participants] = createResource(
    () => (isDeckMode(mode()) ? event() : null),
    key => (key ? fetchParticipants(key) : Promise.resolve(null))
  );
  const [profiles] = createResource(
    () => (mode() === 'matchups' ? event() : null),
    key => (key ? fetchMatchupProfiles(key) : Promise.resolve(null))
  );
  const conversion = createMemo(() => {
    const players = latestValue(participants);
    return players ? deckConversion(players, CONVERSION_DECKS) : null;
  });
  const grid = createMemo(() => {
    const players = latestValue(participants);
    const pairs = latestValue(profiles)?.profiles.all?.byArchetypePair;
    return players && pairs?.length ? matchupGrid(pairs, topDecks(players, MATCHUP_DECKS)) : null;
  });
  const ready = () => (mode() === 'matchups' ? grid() : conversion()) !== null;
  return { conversion, grid, ready, loading: () => participants.loading || profiles.loading };
}
