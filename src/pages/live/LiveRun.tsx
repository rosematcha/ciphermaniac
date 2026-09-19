import { A } from '@solidjs/router';
import { createMemo, createResource, For, Show } from 'solid-js';
import type { LiveSeat } from '../../../shared/live/types';
import { matchStatus, playerRun, recordLabel, type RunRound, seatKey } from '../../../shared/live/view';
import { Section } from '../../components/Section';
import { Skeleton } from '../../components/Skeleton';
import { fetchLiveRound } from '../../lib/data/live';
import { useLiveFollows } from '../../lib/liveFollows';
import { latestValue } from '../../lib/resource';

const RESULT_LETTER = { win: 'W', loss: 'L', tie: 'T' } as const;

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
          <Show when={latest()}>{seat => <span>{recordLabel(seat())}</span>}</Show>
          <Show when={props.playerId}>
            <A href={`/players/${encodeURIComponent(props.playerId!)}`}>Career</A>
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
          <For each={run()}>{round => <RunRow round={round} hrefFor={props.hrefFor} />}</For>
        </ol>
      </Show>
    </Section>
  );
}

function RunRow(props: { round: RunRound; hrefFor: (seat: RunPlayer) => string }) {
  const view = () => props.round.view;
  const opponent = (): LiveSeat | undefined => view()?.opponent;
  return (
    <li class='round'>
      <span class='round-n'>R{props.round.round}</span>
      <b class={`round-outcome ${view()?.seat.result ?? ''}`}>
        {view()?.seat.result ? RESULT_LETTER[view()!.seat.result!] : '·'}
      </b>
      <span class='round-opp'>
        <Show when={opponent()} fallback={<span class='muted-cell'>{view() ? 'No opponent' : 'Not found'}</span>}>
          {seat => <A href={props.hrefFor(seat())}>{seat().name}</A>}
        </Show>
      </span>
      <span class='round-deck'>
        <Show when={opponent()}>{seat => <span>{recordLabel(seat())}</span>}</Show>
      </span>
      <span class='round-finish'>
        <Show when={view()}>
          {current => (matchStatus(current().match) === 'final' ? current().match.table || '' : 'Playing')}
        </Show>
      </span>
    </li>
  );
}
