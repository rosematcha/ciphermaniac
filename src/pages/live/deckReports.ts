/**
 * Crowd-sourced deck reports as the pages read and write them.
 *
 * Pulled out of the live page because the run now opens on a career page and on
 * a seat's own page, and all three need the same four things: the archetypes a
 * report may name, the archetype published for a seat, what this device
 * reported, and a way to report.
 * @module src/pages/live/deckReports
 */

import { createMemo, createResource, createSignal } from 'solid-js';
import { reportableArchetypes } from '../../../shared/live/reports';
import { seatKey, type SeatRef } from '../../../shared/live/view';
import { fetchArchetypeLabels, fetchOnlineArchetypes } from '../../lib/data';
import { fetchLiveReports, submitDeckReport } from '../../lib/data/live';
import { liveVoterId } from '../../lib/liveFollows';
import { createPolled } from '../../lib/livePoll';
import { reportKey, useMyReports } from '../../lib/liveReports';
import { latestValue, resolved } from '../../lib/resource';
import type { ReportedDeck } from './LiveDeck';

export interface DeckReports {
  /** Every reportable archetype; the first `leading` are the online meta's, most played first. */
  decks: () => ReportedDeck[];
  leading: () => number;
  /** The archetype published for a seat, or the one this device just reported. */
  deckOf: (seat: SeatRef) => ReportedDeck | undefined;
  /** What this device has reported for a seat. */
  myDeck: (seat: SeatRef) => ReportedDeck | undefined;
  report: (seat: SeatRef, archetype: string | null) => Promise<void>;
}

/**
 * Deck reports for one event.
 * @param slug - Event slug accessor
 * @returns The reportable archetypes and the read/write pair for a seat
 */
export function useDeckReports(slug: () => string): DeckReports {
  const reports = createPolled(slug, fetchLiveReports);
  const [archetypes] = createResource(fetchOnlineArchetypes);
  const [iconLabels] = createResource(fetchArchetypeLabels);
  // Reported here and not published yet, so a report shows at once rather than a poll later.
  const [reported, setReported] = createSignal<Record<string, string | null>>({});

  // Most played first; the index's own icons beat the icon map's for a label both carry.
  const indexed = createMemo(() =>
    [...(resolved(archetypes) ?? [])].sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0))
  );
  const decks = createMemo<ReportedDeck[]>(() => {
    const byLabel = new Map(indexed().map(entry => [entry.label, entry]));
    return reportableArchetypes([...byLabel.keys()], resolved(iconLabels) ?? []).map(label => ({
      label,
      icons: byLabel.get(label)?.icons,
      percent: byLabel.get(label)?.percent
    }));
  });
  const deckByLabel = createMemo(() => new Map(decks().map(deck => [deck.label, deck])));
  const known = (label: string | null | undefined): ReportedDeck | undefined =>
    label ? (deckByLabel().get(label) ?? { label }) : undefined;

  const { mine, remember } = useMyReports();
  return {
    decks,
    leading: () => indexed().length,
    deckOf: seat => {
      const key = seatKey(seat);
      return known(key in reported() ? reported()[key] : latestValue(reports)?.decks[key]);
    },
    myDeck: seat => known(mine()[reportKey(slug(), seatKey(seat))]),
    report: async (seat, archetype) => {
      const key = seatKey(seat);
      const shown = await submitDeckReport({ slug: slug(), seat: key, archetype, voter: liveVoterId() });
      remember(reportKey(slug(), key), archetype);
      setReported(current => ({ ...current, [key]: shown }));
    }
  };
}
