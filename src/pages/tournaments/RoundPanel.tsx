/**
 * The console's round view: the current round's tables with result entry,
 * and every action that moves the event on. What Slowpoke could not do lives
 * here: when a player is added after pairing, the panel says who is not
 * seated and re-pairs the round around the results already in.
 */

import { createEffect, createMemo, createSignal, For, on, Show } from 'solid-js';
import {
  type Division,
  DIVISION_LABELS,
  DIVISIONS,
  type Match,
  type Outcome,
  type Pod,
  type Round
} from '../../../shared/tournament/types';
import type { Manage } from '../../lib/tournament/api';
import { TOP_CUT_SIZES } from '../../../shared/tournament/commands';
import {
  currentRound,
  namesById,
  recommendedStructure,
  roundLabel,
  STATUS_LABELS,
  unseated
} from '../../lib/tournament/present';
import { activeIds, roundComplete } from '../../../shared/tournament/rounds';
import { Clock } from './Clock';
import type { ManageState } from './manageState';
import { MatchTable } from './MatchTable';

function RoundPicker(props: { pod: Pod; selected: number; onSelect: (n: number) => void }) {
  return (
    <select
      class='tm-select'
      aria-label='Round'
      value={props.selected}
      onChange={e => props.onSelect(Number(e.currentTarget.value))}
    >
      <For each={props.pod.rounds}>
        {round => (
          <option value={round.number} selected={round.number === props.selected}>
            {roundLabel(round)}
          </option>
        )}
      </For>
    </select>
  );
}

function ResultExtras(props: { match: Match; elimination: boolean; onReport: (outcome: Outcome) => void }) {
  return (
    <Show when={props.match.p2 !== null}>
      <span class='tm-row-actions'>
        <Show when={!props.elimination}>
          <button
            type='button'
            class='btn btn-ghost tm-small'
            aria-pressed={props.match.outcome === 'tie'}
            onClick={() => props.onReport('tie')}
          >
            Tie
          </button>
          <button
            type='button'
            class='btn btn-ghost tm-small'
            aria-pressed={props.match.outcome === 'double-loss'}
            onClick={() => props.onReport('double-loss')}
          >
            Double loss
          </button>
        </Show>
        <Show when={props.match.outcome !== 'pending'}>
          <button type='button' class='btn btn-ghost tm-small' onClick={() => props.onReport('pending')}>
            Clear
          </button>
        </Show>
      </span>
    </Show>
  );
}

const combinedPod = (pod: Pod) => !(DIVISIONS as readonly string[]).includes(pod.category);

function TopCutControl(props: { state: ManageState; pod: Pod; active: number }) {
  // eslint-disable-next-line solid/reactivity -- a starting suggestion; the organizer's pick wins from then on
  const [size, setSize] = createSignal(recommendedStructure(props.active).cut || 8);
  const [division, setDivision] = createSignal<Division>('masters');
  function start() {
    const cut = { type: 'startTopCut' as const, pod: props.pod.category, size: size() };
    void props.state.send(combinedPod(props.pod) ? { ...cut, division: division() } : cut);
  }
  return (
    <span class='tm-inline-form'>
      <Show when={combinedPod(props.pod)}>
        <select
          class='tm-select'
          aria-label='Division to cut'
          onChange={e => setDivision(e.currentTarget.value as Division)}
        >
          <For each={DIVISIONS}>
            {d => (
              <option value={d} selected={d === division()}>
                {DIVISION_LABELS[d]}
              </option>
            )}
          </For>
        </select>
      </Show>
      <select
        class='tm-select'
        aria-label='Top cut size'
        value={size()}
        onChange={e => setSize(Number(e.currentTarget.value))}
      >
        <For each={TOP_CUT_SIZES.filter(n => n <= props.active)}>
          {n => (
            <option value={n} selected={n === size()}>
              Top {n}
            </option>
          )}
        </For>
      </select>
      <button type='button' class='btn btn-secondary' disabled={props.state.busy()} onClick={start}>
        Start top cut
      </button>
    </span>
  );
}

function ClockControls(props: { state: ManageState; pod: Pod; round: Round }) {
  const send = (type: 'startClock' | 'stopClock') => props.state.send({ type, pod: props.pod.category });
  const adjust = (seconds: number) => props.state.send({ type: 'adjustClock', pod: props.pod.category, seconds });
  return (
    <span class='tm-clock-controls'>
      <Clock round={props.round} />
      <Show
        when={props.round.clockStartedAt != null}
        fallback={
          <button type='button' class='btn btn-secondary' onClick={() => void send('startClock')}>
            Start clock
          </button>
        }
      >
        <button type='button' class='btn btn-secondary' onClick={() => void send('stopClock')}>
          Pause clock
        </button>
      </Show>
      <button type='button' class='btn btn-ghost' onClick={() => void adjust(60)}>
        +1 min
      </button>
      <button type='button' class='btn btn-ghost' onClick={() => void adjust(-60)}>
        −1 min
      </button>
    </span>
  );
}

function PairingActions(props: { state: ManageState; pod: Pod; round: Round | undefined; active: number }) {
  const [keep, setKeep] = createSignal(true);
  const complete = () => !props.round || roundComplete(props.round);
  const nothingReported = () => !props.round?.matches.some(m => m.p2 !== null && m.outcome !== 'pending');
  const swissDone = () => props.round?.kind === 'swiss' && complete();
  const pod = () => props.pod.category;
  return (
    <div class='tm-toolbar'>
      <Show when={complete()}>
        <button
          type='button'
          class='btn btn-primary'
          disabled={props.state.busy()}
          onClick={() => void props.state.send({ type: 'pairRound', pod: pod() })}
        >
          Pair {props.round ? 'next round' : 'round 1'}
        </button>
      </Show>
      <Show when={swissDone() && props.active >= 4}>
        <TopCutControl state={props.state} pod={props.pod} active={props.active} />
      </Show>
      <Show when={props.round?.kind === 'swiss' && !complete()}>
        <span class='tm-inline-form'>
          <button
            type='button'
            class='btn btn-secondary'
            disabled={props.state.busy()}
            onClick={() => void props.state.send({ type: 'repairRound', pod: pod(), keepReported: keep() })}
          >
            Re-pair round
          </button>
          <label class='tm-check'>
            <input type='checkbox' checked={keep()} onChange={e => setKeep(e.currentTarget.checked)} />
            <span>Keep reported results</span>
          </label>
        </span>
      </Show>
      <Show when={props.round && nothingReported()}>
        <button
          type='button'
          class='btn btn-ghost'
          disabled={props.state.busy()}
          onClick={() => void props.state.send({ type: 'deleteRound', pod: pod() })}
        >
          Delete round
        </button>
      </Show>
    </div>
  );
}

export function RoundPanel(props: { state: ManageState; manage: Manage; pod: Pod }) {
  const tom = () => props.manage.mode === 'tom';
  const latest = () => currentRound(props.pod);
  const [picked, setPicked] = createSignal<number | null>(null);
  const [swapMode, setSwapMode] = createSignal(false);
  const [swapPick, setSwapPick] = createSignal<string | null>(null);
  const round = createMemo(() => props.pod.rounds.find(r => r.number === picked()) ?? latest());
  const names = createMemo(() => namesById(props.manage.tournament));
  const waiting = () => unseated(props.manage.tournament, props.pod);
  const active = () => activeIds(props.manage.tournament, props.pod).length;
  const isLatest = () => round()?.number === latest()?.number;
  // A new round, or another division, starts on its current round again.
  createEffect(on([() => latest()?.number, () => props.pod.category], () => setPicked(null), { defer: true }));

  function report(match: Match, outcome: Outcome) {
    const r = round();
    if (!r) {
      return;
    }
    void props.state.send({
      type: 'reportResult',
      pod: props.pod.category,
      round: r.number,
      table: match.table,
      p1: match.p1,
      p2: match.p2,
      outcome
    });
  }

  function pickForSwap(id: string) {
    const first = swapPick();
    if (first === null) {
      setSwapPick(id);
      return;
    }
    setSwapPick(null);
    setSwapMode(false);
    void props.state.send({ type: 'swapPlayers', pod: props.pod.category, a: first, b: id });
  }

  return (
    <div class='tm-panel'>
      <Show when={!tom()}>
        <PairingActions state={props.state} pod={props.pod} round={latest()} active={active()} />
      </Show>
      <Show when={!tom() && waiting().length > 0 && latest()?.kind === 'swiss'}>
        <p class='tm-note' role='status'>
          {waiting().length === 1 ? '1 player is' : `${waiting().length} players are`} not seated this round:{' '}
          {waiting()
            .map(id => names().get(id) ?? id)
            .join(', ')}
          . Re-pair the round to seat them.
        </p>
      </Show>
      <Show when={round()} fallback={<p class='muted'>No rounds yet.</p>}>
        {r => (
          <>
            <div class='tm-round-head'>
              <RoundPicker pod={props.pod} selected={r().number} onSelect={setPicked} />
              <span class='muted'>{STATUS_LABELS[r().status]}</span>
              <Show when={!tom() && isLatest()}>
                <ClockControls state={props.state} pod={props.pod} round={r()} />
                <Show when={r().kind === 'swiss' && r().status !== 'finished'}>
                  <button
                    type='button'
                    class='btn btn-ghost'
                    aria-pressed={swapMode()}
                    onClick={() => {
                      setSwapMode(!swapMode());
                      setSwapPick(null);
                    }}
                  >
                    {swapMode() ? 'Cancel swap' : 'Swap players'}
                  </button>
                </Show>
              </Show>
            </div>
            <Show when={swapMode()}>
              <p class='tm-note'>Pick two players to trade seats.</p>
            </Show>
            <MatchTable
              pod={props.pod}
              round={r()}
              matches={r().matches}
              names={names()}
              decks={props.manage.decks}
              pending={props.manage.pending}
              selected={new Set(swapPick() ? [swapPick() as string] : [])}
              onReport={swapMode() ? undefined : report}
              onPlayer={swapMode() ? pickForSwap : undefined}
              extra={match => (
                <ResultExtras match={match} elimination={r().kind === 'elimination'} onReport={o => report(match, o)} />
              )}
            />
          </>
        )}
      </Show>
    </div>
  );
}
