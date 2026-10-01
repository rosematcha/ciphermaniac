/**
 * The archetypes a deck picker offers for an event's format, as the Tier List
 * Maker knows them: for Standard, the online meta ranked by share and marked
 * as being played, then every other archetype the site has an icon for; for
 * a past format the Tier List Maker covers, that format's own archetypes; for
 * any other format, the long tail alone. Every Pokémon the format's list
 * lacks follows it, so a niche deck still has a name and a sprite. Decks
 * already entered at the event count as played, so a deck typed in once is
 * offered with the rest from then on. Anything missing is typed in (see
 * DeckCombo's `custom`).
 *
 * Loaded once per format per page and shared by every picker on it.
 */

import { type Accessor, createMemo, createResource } from 'solid-js';
import { fetchArchetypeLabels, fetchOnlineArchetypes } from '../../lib/data';
import { fetchFormatArchetypes, loadTierFormats, STANDARD_FORMAT_ID, tierFormats } from '../../lib/data/formats';
import { loadSpecies } from '../../lib/deckIcons';
import { latestValue } from '../../lib/resource';
import type { ReportedDeck } from '../live/LiveDeck';
import { learnDeckIcons } from './DeckIcons';
import { eventDecks } from './eventDecks';

async function standardDecks(): Promise<ReportedDeck[]> {
  const [online, labels] = await Promise.all([
    fetchOnlineArchetypes().catch(() => []),
    fetchArchetypeLabels().catch(() => [])
  ]);
  const seen = new Set(online.map(entry => entry.label));
  return [
    ...online.map(entry => ({ label: entry.label, icons: entry.icons, percent: entry.percent, played: true })),
    ...labels.filter(label => !seen.has(label)).map(label => ({ label }))
  ];
}

/** A past format's archetypes, whose sprites the site's own icon map may not have. */
async function pastDecks(id: string): Promise<ReportedDeck[]> {
  const entries = await fetchFormatArchetypes(id).catch(() => []);
  const decks = entries.map(entry => ({
    label: entry.label,
    icons: entry.icons,
    percent: entry.percent,
    played: true
  }));
  learnDeckIcons(decks);
  return decks;
}

let liveFormats: Promise<void> | null = null;

/** The Tier List Maker's entry for a format label, once the live list has been asked for (once a page). */
async function tierFormatOf(format: string) {
  // The live list names formats the snapshot shipped with the page may not.
  liveFormats ??= loadTierFormats().catch(() => undefined);
  await liveFormats;
  return tierFormats().find(entry => entry.label === format);
}

/** The format's decks, then every Pokémon they do not already name (the decks alone if those fail to load). */
async function withSpecies(decks: ReportedDeck[]): Promise<ReportedDeck[]> {
  const species = await loadSpecies().then(
    module => module.SPECIES_LABELS,
    () => []
  );
  const named = new Set(decks.map(deck => deck.label.toLowerCase()));
  return [...decks, ...species.filter(label => !named.has(label.toLowerCase())).map(label => ({ label }))];
}

async function formatDecks(format: string): Promise<ReportedDeck[]> {
  const known = await tierFormatOf(format);
  if (known && known.id !== STANDARD_FORMAT_ID) {
    return pastDecks(known.id);
  }
  const decks = await standardDecks();
  // A format the site has no meta for: nothing is being played that it knows of.
  return known ? decks : decks.map(({ label, icons }) => ({ label, ...(icons ? { icons } : {}) }));
}

async function load(format: string): Promise<ReportedDeck[]> {
  return withSpecies(await formatDecks(format));
}

const loaded = new Map<string, Promise<ReportedDeck[]>>();

/** The format's archetypes, loading them the first time they are asked for. */
export function decksFor(format: string): Promise<ReportedDeck[]> {
  const cached = loaded.get(format);
  if (cached) {
    return cached;
  }
  const decks = load(format);
  loaded.set(format, decks);
  return decks;
}

/** The picker's options for the event's format, with the decks already entered at the event. */
export function createDeckOptions(
  format: Accessor<string>,
  inEvent: Accessor<readonly string[]> = () => []
): Accessor<ReportedDeck[]> {
  const [decks] = createResource(format, decksFor);
  return createMemo(() => eventDecks(latestValue(decks) ?? [], inEvent()));
}

/**
 * For a page that shows decks but picks none: the sprites of a past format's
 * archetypes, which the site's own icon map may not have. Standard's are in it.
 */
export async function learnFormatIcons(format: string): Promise<void> {
  const known = await tierFormatOf(format);
  if (known && known.id !== STANDARD_FORMAT_ID) {
    await decksFor(format);
  }
}
