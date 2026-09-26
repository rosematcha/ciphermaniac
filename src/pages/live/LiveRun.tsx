import { A } from '@solidjs/router';
import { createMemo, createResource, createSignal, For, Show } from 'solid-js';
import type { LiveCut, LiveSeat } from '../../../shared/live/types';
import { roundShort } from '../../../shared/live/rounds';
import {
  matchStatus,
  playerRun,
  recordLabel,
  type RunRound,
  runSeats,
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
import { RunReport } from './RunReport';

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
  /** Where the top cut starts, so its rounds are named for it. */
  cut?: LiveCut;
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
 * current one, under the index hash.
 */
export function LiveRun(props: LiveRunProps) {
  const [rounds] = createResource(
    () => [props.slug, props.rounds, props.version] as const,
    ([slug, count, version]) => fetchPostedRounds(slug, count, version)
  );
  const run = createMemo(() => {
    const loaded = latestValue(rounds);
    if (!loaded) {
      return undefined;
    }
    // A player is paired every round until they are out, so the rounds after
    // their last pairing are the event carrying on without them, not blanks.
    const played = playerRun(loaded, props.names, props.countries);
    const last = played.map(round => Boolean(round.view)).lastIndexOf(true);
    return played.slice(0, last + 1);
  });
  /** The seat as the data has it, not as a URL spelled it: follows and reports key off this. */
  const seat = () => [...(run() ?? [])].reverse().find(round => round.view)?.view?.seat;
  /** Whether any round shown is a top cut one, whose name needs the wider column. */
  const reachedCut = () => Boolean(props.cut && run()?.some(round => round.round >= props.cut!.from));
  const [filling, setFilling] = createSignal(false);
  const seats = createMemo(() => {
    const current = seat();
    return current ? runSeats(current, run() ?? []) : [];
  });
  const shownFor = (entry: SeatRef) => props.reports.myDeck(entry) ?? props.reports.deckOf(entry);

  return (
    <div class='live-run'>
      <Show when={seat()}>
        {current => (
          <RunActions
            seat={current()}
            reports={props.reports}
            filling={filling()}
            onFill={seats().length > 1 ? () => setFilling(open => !open) : undefined}
          />
        )}
      </Show>
      <Show when={run()} fallback={<Skeleton height='140px' />}>
        <Show
          when={filling()}
          fallback={
            <ol class='rounds live-rounds' classList={{ 'has-cut': reachedCut() }}>
              <For each={run()}>
                {round => (
                  <RunRow
                    round={round}
                    cut={props.cut}
                    slug={props.slug}
                    reports={props.reports}
                    profileOf={props.profileOf}
                  />
                )}
              </For>
            </ol>
          }
        >
          <RunReport
            seats={seats()}
            decks={props.reports.decks()}
            cut={reachedCut() ? props.cut : undefined}
            shownFor={shownFor}
            onSubmit={props.reports.reportMany}
            onClose={() => setFilling(false)}
          />
        </Show>
      </Show>
    </div>
  );
}

/**
 * Record, reported deck, follow and report — one wrapping row, never a crushed
 * line. While the whole run is being filled in, the single-seat reporter steps
 * aside for the form's own Cancel.
 */
function RunActions(props: { seat: LiveSeat; reports: DeckReports; filling: boolean; onFill?: () => void }) {
  const { follows, toggle } = useLiveFollows();
  const key = () => seatKey(props.seat);
  const followed = () => follows().has(key());
  const reportable = () => props.reports.decks().length > 0;
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
        <Show when={reportable() && !props.filling}>
          <DeckReporter
            decks={props.reports.decks()}
            mine={props.reports.myDeck(props.seat)}
            onReport={archetype => props.reports.report(props.seat, archetype)}
          />
        </Show>
        <Show when={reportable() && props.onFill}>
          {fill => (
            <button type='button' class='btn btn-secondary' onClick={() => fill()()}>
              {props.filling ? 'Cancel' : 'Report run'}
            </button>
          )}
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
  cut?: LiveCut;
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
      <span class='round-n'>{roundShort(props.round.round, props.cut)}</span>
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
