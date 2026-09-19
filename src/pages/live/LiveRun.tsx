import { A } from '@solidjs/router';
import { createMemo, createResource, For, Show } from 'solid-js';
import type { LiveSeat } from '../../../shared/live/types';
import {
  matchStatus,
  playerRun,
  recordLabel,
  type RunRound,
  seatKey,
  type SeatOutcome,
  seatOutcome,
  type SeatProfile,
  type SeatRef
} from '../../../shared/live/view';
import { Skeleton } from '../../components/Skeleton';
import { useLiveFollows } from '../../lib/liveFollows';
import { fetchPostedRounds } from '../../lib/liveRounds';
import { latestValue } from '../../lib/resource';
import type { DeckReports } from './deckReports';
import { DeckReporter, LiveDeck } from './LiveDeck';
import { seatHref, seatName } from './links';

const RESULT_LETTER = { win: 'W', loss: 'L', tie: 'T' } as const;
/** Shared with the pairings table's status column. */
export const STATUS_LABEL = { final: 'Final', submitted: 'Submitted', playing: 'Playing' } as const;

interface LiveRunProps {
  slug: string;
  /** Every name the player may be registered under, their own first. */
  names: readonly string[];
  countries: readonly string[];
  /** Rounds posted so far, and the index hash, which moves whenever the current round does. */
  rounds: number;
  version: string;
  reports: DeckReports;
  /** Career for an opponent's seat, so their row leads to the right page. */
  profileOf: (seat: SeatRef) => SeatProfile | null;
}

/**
 * One player's rounds in the event so far: the deck reported for them, their
 * record, a follow toggle, and a row per round.
 *
 * Every posted round is read, since a round file is the only place a pairing
 * lives. Finished rounds are held for the session, so a poll only refetches the
 * current one.
 */
export function LiveRun(props: LiveRunProps) {
  const [rounds] = createResource(
    () => [props.slug, props.rounds, props.version] as const,
    ([slug, count]) => fetchPostedRounds(slug, count)
  );
  const run = createMemo(() => {
    const loaded = latestValue(rounds);
    return loaded ? playerRun(loaded, props.names, props.countries) : undefined;
  });
  /** The seat as the data has it, not as a URL spelled it: follows and reports key off this. */
  const seat = () => [...(run() ?? [])].reverse().find(round => round.view)?.view?.seat;

  return (
    <div class='live-run'>
      <Show when={seat()}>{current => <RunActions seat={current()} reports={props.reports} />}</Show>
      <Show when={run()} fallback={<Skeleton height='140px' />}>
        <ol class='rounds live-rounds'>
          <For each={run()}>
            {round => <RunRow round={round} slug={props.slug} reports={props.reports} profileOf={props.profileOf} />}
          </For>
        </ol>
      </Show>
    </div>
  );
}

/** Record, reported deck, follow and report — one wrapping row, never a crushed line. */
function RunActions(props: { seat: LiveSeat; reports: DeckReports }) {
  const { follows, toggle } = useLiveFollows();
  const key = () => seatKey(props.seat);
  const followed = () => follows().has(key());
  return (
    <div class='live-run-actions'>
      <span class='live-run-meta'>
        <span class='live-run-record'>{recordLabel(props.seat)}</span>
        <Show when={props.reports.deckOf(props.seat)}>{deck => <LiveDeck deck={deck()} />}</Show>
      </span>
      <span class='live-run-buttons'>
        <button type='button' class='btn btn-secondary' aria-pressed={followed()} onClick={() => toggle(key())}>
          {followed() ? 'Following' : 'Follow'}
        </button>
        <Show when={props.reports.decks().length > 0}>
          <DeckReporter
            decks={props.reports.decks()}
            leading={props.reports.leading()}
            mine={props.reports.myDeck(props.seat)}
            onReport={archetype => props.reports.report(props.seat, archetype)}
          />
        </Show>
      </span>
    </div>
  );
}

/**
 * W, L or T. A confirmed result takes its colour; one only submitted so far is
 * set in plain ink and marked with a question mark, since colour alone cannot
 * carry "staff have not signed this off" and a `title` does not exist on touch.
 */
export function OutcomeMark(props: { outcome: SeatOutcome }) {
  return (
    <b
      class={`round-outcome ${props.outcome.provisional ? 'provisional' : props.outcome.result}`}
      title={props.outcome.provisional ? 'Submitted, not yet confirmed' : undefined}
    >
      {RESULT_LETTER[props.outcome.result]}
      <Show when={props.outcome.provisional}>
        <span aria-label=', submitted, not yet confirmed'>?</span>
      </Show>
    </b>
  );
}

function RunRow(props: {
  round: RunRound;
  slug: string;
  reports: DeckReports;
  profileOf: (seat: SeatRef) => SeatProfile | null;
}) {
  const view = () => props.round.view;
  const opponent = (): LiveSeat | undefined => view()?.opponent;
  const outcome = () => {
    const current = view();
    return current ? seatOutcome(current.match, current.match.seats.indexOf(current.seat)) : null;
  };
  const finish = () => {
    const current = view();
    if (!current) {
      return '';
    }
    const status = matchStatus(current.match);
    return status === 'final' ? `Table ${current.match.table || '—'}` : STATUS_LABEL[status];
  };
  return (
    <li class='round'>
      <span class='round-n'>R{props.round.round}</span>
      <Show when={outcome()} fallback={<b class='round-outcome'>·</b>}>
        {current => <OutcomeMark outcome={current()} />}
      </Show>
      <span class='round-opp'>
        <Show when={opponent()} fallback={<span class='muted-cell'>{view() ? 'No opponent' : 'Not found'}</span>}>
          {seat => (
            <A href={seatHref(props.slug, seat(), props.profileOf(seat()))}>
              {seatName(seat(), props.profileOf(seat()))}
            </A>
          )}
        </Show>
      </span>
      {/* The placeholder holds the row's fourth grid cell: without it the
          finish column slides left whenever no deck is known, so rows of one
          run land in different columns. It collapses on a phone. */}
      <Show when={opponent() && props.reports.deckOf(opponent()!)} fallback={<span class='round-deck' />}>
        {deck => <LiveDeck deck={deck()} class='round-deck' />}
      </Show>
      <span class='round-finish'>{finish()}</span>
    </li>
  );
}
