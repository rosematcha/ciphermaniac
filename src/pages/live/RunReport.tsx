/**
 * Filling in a whole run's decks at once.
 *
 * Players post their matchups round by round when an event ends, which is a
 * deck for every seat they sat across from. Reporting those one at a time means
 * opening and closing a panel per round, so here the run itself becomes the
 * form: one picker per round, nothing sent until the run is saved, and then all
 * of it in one request.
 *
 * A picker starts on whatever is shown for that seat now, this device's report
 * or the published one, so agreeing with what is already there costs nothing
 * and only the rounds actually picked are sent.
 * @module pages/live/RunReport
 */

import { createSignal, For, Show } from 'solid-js';
import type { LiveCut } from '../../../shared/live/types';
import { roundShort } from '../../../shared/live/rounds';
import { type RunSeatEntry, seatKey, type SeatRef, type SeatReport } from '../../../shared/live/view';
import { DeckCombo, type ReportedDeck } from './LiveDeck';

interface RunReportProps {
  seats: readonly RunSeatEntry[];
  cut?: LiveCut;
  /** Every archetype a report may name, the ones in play flagged. */
  decks: readonly ReportedDeck[];
  /** What is shown for a seat now: this device's report, else the published one. */
  shownFor: (seat: SeatRef) => ReportedDeck | undefined;
  onSubmit: (entries: readonly SeatReport[]) => Promise<void>;
  /** Closes the form once the run has gone in; Cancel is the panel's own button. */
  onClose: () => void;
}

export function RunReport(props: RunReportProps) {
  const [picks, setPicks] = createSignal<Record<string, ReportedDeck>>({});
  const [state, setState] = createSignal<'idle' | 'sending' | 'failed'>('idle');
  const picked = (entry: RunSeatEntry) => picks()[seatKey(entry.seat)];
  const chosen = (entry: RunSeatEntry) => picked(entry) ?? props.shownFor(entry.seat);
  const pick = (entry: RunSeatEntry, deck: ReportedDeck) =>
    setPicks(current => ({ ...current, [seatKey(entry.seat)]: deck }));

  const entries = () =>
    props.seats.flatMap(entry => {
      const deck = picked(entry);
      return deck ? [{ seat: entry.seat, archetype: deck.label } satisfies SeatReport] : [];
    });

  const send = async () => {
    setState('sending');
    try {
      await props.onSubmit(entries());
      props.onClose();
    } catch {
      setState('failed');
    }
  };

  return (
    <div class='run-report' classList={{ 'has-cut': Boolean(props.cut) }}>
      <ol class='rounds'>
        <For each={props.seats}>
          {entry => (
            <li class='round run-report-row'>
              <span class='round-n'>{entry.round === 0 ? 'Own' : roundShort(entry.round, props.cut)}</span>
              <span class='round-opp'>{entry.seat.name}</span>
              <span class='live-deck-picker'>
                <DeckCombo
                  placeholder={`Deck for ${entry.seat.name}`}
                  decks={props.decks}
                  selected={chosen(entry)}
                  onPick={deck => pick(entry, deck)}
                  width='100%'
                />
              </span>
            </li>
          )}
        </For>
      </ol>
      <div class='run-report-actions'>
        <button
          type='button'
          class='btn btn-primary'
          disabled={state() === 'sending' || entries().length === 0}
          onClick={() => void send()}
        >
          <Show
            when={state() === 'failed'}
            fallback={`Report ${entries().length} ${entries().length === 1 ? 'deck' : 'decks'}`}
          >
            Try again
          </Show>
        </button>
      </div>
    </div>
  );
}
