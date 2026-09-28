/**
 * The archetypes a deck picker offers: the online meta first, ranked by share
 * and marked as being played, then every other archetype the site has an icon
 * for. Loaded once per page and shared by every picker on it.
 */

import { createResource, createRoot } from 'solid-js';
import { fetchArchetypeLabels, fetchOnlineArchetypes } from '../../lib/data';
import type { ReportedDeck } from '../live/LiveDeck';

async function loadDecks(): Promise<ReportedDeck[]> {
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

const [deckOptions] = createRoot(() => createResource(loadDecks));

export { deckOptions };
