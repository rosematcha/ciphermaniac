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
import { MAX_REPORTS_PER_REQUEST, reportableArchetypes } from '../../../shared/live/reports';
import type { LiveIndex } from '../../../shared/live/types';
import { seatKey, type SeatRef, type SeatReport } from '../../../shared/live/view';
import { fetchArchetypeLabels, fetchOnlineArchetypes } from '../../lib/data';
import { type DeckReportAnswer, fetchLiveReports, submitDeckReports } from '../../lib/data/live';
import { liveVoterId } from '../../lib/liveFollows';
import { createPolled, liveDelay } from '../../lib/livePoll';
import { reportKey, shownDeck, useMyReports } from '../../lib/liveReports';
import { latestValue, resolved } from '../../lib/resource';
import type { ReportedDeck } from './LiveDeck';

export interface DeckReports {
  /** Every reportable archetype, the online meta's first and the ones in play flagged. */
  decks: () => ReportedDeck[];
  /** The archetype published for a seat, or the endpoint's answer to this device's report until the published copy has it. */
  deckOf: (seat: SeatRef) => ReportedDeck | undefined;
  /** What this device has reported for a seat. */
  myDeck: (seat: SeatRef) => ReportedDeck | undefined;
  report: (seat: SeatRef, archetype: string | null) => Promise<void>;
  /** Several seats in one request, as a whole run is reported. */
  reportMany: (entries: readonly SeatReport[]) => Promise<void>;
}

/**
 * The endpoint's answers to this session's reports, by event: every seat
 * answered, and the time of the file carrying the latest. Held here rather than
 * per page, so a report made on a career page still shows on the live page
 * opened straight after it, before the edge has the file that carries it.
 */
const [answered, setAnswered] = createSignal<Record<string, DeckReportAnswer>>({});

/**
 * Deck reports for one event.
 * @param slug - Event slug accessor
 * @param index - The event's index, whose pace the reports are read at
 * @returns The reportable archetypes and the read/write pair for a seat
 */
export function useDeckReports(slug: () => string, index: () => LiveIndex | null | undefined): DeckReports {
  const reports = createPolled(slug, fetchLiveReports, () => liveDelay(index()));
  const [archetypes] = createResource(fetchOnlineArchetypes);
  const [iconLabels] = createResource(fetchArchetypeLabels);

  // Most played first; the index's own icons beat the icon map's for a label both carry.
  const indexed = createMemo(() =>
    [...(resolved(archetypes) ?? [])].sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0))
  );
  // A deck counts as played if the online meta has it or this event has already
  // seen it, which is what puts the regional-only decks the online index never
  // shows — Rocket's Honchkrow, Basic Box — in front of the icon map's long
  // tail of dead archetypes.
  const decks = createMemo<ReportedDeck[]>(() => {
    const byLabel = new Map(indexed().map(entry => [entry.label, entry]));
    const here = new Set(Object.values(latestValue(reports)?.decks ?? {}));
    return reportableArchetypes([...byLabel.keys()], resolved(iconLabels) ?? []).map(label => ({
      label,
      icons: byLabel.get(label)?.icons,
      percent: byLabel.get(label)?.percent,
      played: byLabel.has(label) || here.has(label)
    }));
  });
  const deckByLabel = createMemo(() => new Map(decks().map(deck => [deck.label, deck])));
  const known = (label: string | null | undefined): ReportedDeck | undefined =>
    label ? (deckByLabel().get(label) ?? { label }) : undefined;

  const { mine, remember } = useMyReports();
  // One request whether it is a single seat or a whole run; the answer is what
  // each seat now shows, which a lone report need not be. Longer than a request
  // takes only if an event ever plays more rounds than a batch holds.
  const reportMany = async (entries: readonly SeatReport[]) => {
    const voter = liveVoterId();
    for (let from = 0; from < entries.length; from += MAX_REPORTS_PER_REQUEST) {
      const batch = entries.slice(from, from + MAX_REPORTS_PER_REQUEST);
      const answer = await submitDeckReports(
        batch.map(entry => ({ slug: slug(), seat: seatKey(entry.seat), archetype: entry.archetype, voter }))
      );
      for (const entry of batch) {
        remember(reportKey(slug(), seatKey(entry.seat)), entry.archetype);
      }
      setAnswered(current => ({
        ...current,
        [slug()]: { ...answer, archetypes: { ...current[slug()]?.archetypes, ...answer.archetypes } }
      }));
    }
  };
  return {
    decks,
    deckOf: seat => {
      const key = seatKey(seat);
      return known(shownDeck(answered()[slug()], latestValue(reports), key));
    },
    myDeck: seat => known(mine()[reportKey(slug(), seatKey(seat))]),
    report: (seat, archetype) => reportMany([{ seat, archetype }]),
    reportMany
  };
}
