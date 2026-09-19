import { A } from '@solidjs/router';
import { createMemo, createResource, For, Show } from 'solid-js';
import type { LiveSeat } from '../../../shared/live/types';
import {
  matchStatus,
  playerRun,
  recordLabel,
  type RunRound,
  seatKey,
  seatOutcome,
  type SeatOutcome
} from '../../../shared/live/view';
import { Section } from '../../components/Section';
import { Skeleton } from '../../components/Skeleton';
import { fetchLiveRound } from '../../lib/data/live';
import { DeckReporter, LiveDeck, type ReportedDeck } from './LiveDeck';
import { useLiveFollows } from '../../lib/liveFollows';
import { latestValue } from '../../lib/resource';

const RESULT_LETTER = { win: 'W', loss: 'L', tie: 'T' } as const;
/** Shared with the pairings table's status column. */
export const STATUS_LABEL = { final: 'Final', submitted: 'Submitted', playing: 'Playing' } as const;

export interface RunPlayer {
  name: string;
  country: string;
}

interface LiveRunProps {
  slug: string;
  player: RunPlayer;
  /** Rounds posted so far, and the index hash, which moves whenever the current round does. */
  rounds: number;
  version: string;
  playerId: string | null;
  hrefFor: (seat: RunPlayer) => string;
  closeHref: string;
  /** Reportable archetypes; the first `leading` are the online meta's. */
  decks: readonly ReportedDeck[];
  leading: number;
  /** The archetype reported for a seat, if one leads. */
  deckOf: (seat: RunPlayer) => ReportedDeck | undefined;
  /** What this device has reported for the player. */
  mine?: ReportedDeck;
  onReport: (archetype: string | null) => Promise<void>;
}

/**
 * One player's rounds in the event so far. Every posted round is read, since a
 * round file is the only place a pairing lives; finished rounds never change,
 * so after the first open they revalidate to nothing.
 */
export function LiveRun(props: LiveRunProps) {
  const { follows, toggle } = useLiveFollows();
  const [rounds] = createResource(
    () => [props.slug, props.rounds, props.version] as const,
    ([slug, count]) => Promise.all(Array.from({ length: count }, (_, i) => fetchLiveRound(slug, i + 1)))
  );
  const run = createMemo(() => {
    const loaded = latestValue(rounds);
    return loaded ? playerRun(loaded, props.player.name, [props.player.country].filter(Boolean)) : undefined;
  });
  const latest = () => [...(run() ?? [])].reverse().find(round => round.view)?.view?.seat;
  const key = () => seatKey(props.player);

  return (
    <Section
      title={props.player.name}
      right={
        <span class='live-run-actions'>
          <Show when={props.deckOf(props.player)}>{deck => <LiveDeck deck={deck()} />}</Show>
          <Show when={latest()}>{seat => <span>{recordLabel(seat())}</span>}</Show>
          <Show when={props.playerId}>
            <A href={`/players/${encodeURIComponent(props.playerId!)}`}>Career</A>
          </Show>
          <Show when={props.decks.length > 0}>
            <DeckReporter decks={props.decks} leading={props.leading} mine={props.mine} onReport={props.onReport} />
          </Show>
          <button
            type='button'
            class='btn btn-secondary'
            aria-pressed={follows().has(key())}
            onClick={() => toggle(key())}
          >
            {follows().has(key()) ? 'Following' : 'Follow'}
          </button>
          <A href={props.closeHref} class='btn btn-secondary'>
            Close
          </A>
        </span>
      }
    >
      <Show when={run()} fallback={<Skeleton height='120px' />}>
        <ol class='rounds'>
          <For each={run()}>{round => <RunRow round={round} hrefFor={props.hrefFor} deckOf={props.deckOf} />}</For>
        </ol>
      </Show>
    </Section>
  );
}

/**
 * W, L or T. A confirmed result takes its colour; one only submitted so far is
 * set in plain ink, so the colour itself says staff have signed it off.
 */
export function OutcomeMark(props: { outcome: SeatOutcome }) {
  return (
    <b
      class={`round-outcome ${props.outcome.provisional ? '' : props.outcome.result}`}
      title={props.outcome.provisional ? 'Submitted, not yet confirmed' : undefined}
    >
      {RESULT_LETTER[props.outcome.result]}
    </b>
  );
}

function RunRow(props: {
  round: RunRound;
  hrefFor: (seat: RunPlayer) => string;
  deckOf: (seat: RunPlayer) => ReportedDeck | undefined;
}) {
  const view = () => props.round.view;
  const opponent = (): LiveSeat | undefined => view()?.opponent;
  const outcome = () => {
    const current = view();
    return current ? seatOutcome(current.match, current.match.seats.indexOf(current.seat)) : null;
  };
  return (
    <li class='round'>
      <span class='round-n'>R{props.round.round}</span>
      <Show when={outcome()} fallback={<b class='round-outcome'>·</b>}>
        {current => <OutcomeMark outcome={current()} />}
      </Show>
      <span class='round-opp'>
        <Show when={opponent()} fallback={<span class='muted-cell'>{view() ? 'No opponent' : 'Not found'}</span>}>
          {seat => <A href={props.hrefFor(seat())}>{seat().name}</A>}
        </Show>
      </span>
      <Show when={opponent() && props.deckOf(opponent()!)} fallback={<span class='round-deck' />}>
        {deck => <LiveDeck deck={deck()} />}
      </Show>
      <span class='round-finish'>
        <Show when={view()}>
          {current =>
            matchStatus(current().match) === 'final'
              ? current().match.table || ''
              : STATUS_LABEL[matchStatus(current().match)]
          }
        </Show>
      </span>
    </li>
  );
}
