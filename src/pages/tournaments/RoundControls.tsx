/**
 * The controls that move a round along: pairing, the top cut, the clock,
 * re-pairing, and the close of the event once the final is in. Each shows
 * only in the state it belongs to, so the console never offers the next round
 * after the last one or a clock for a round that is over.
 */

import { createSignal, For, Show } from 'solid-js';
import { TOP_CUT_SIZES } from '../../../shared/tournament/commands';
import { eliminationResult } from '../../../shared/tournament/standings';
import { type Division, DIVISION_LABELS, DIVISIONS, type Pod, type Round } from '../../../shared/tournament/types';
import { saveSettings } from '../../lib/tournament/api';
import { clockLabel, recommendedStructure } from '../../lib/tournament/present';
import { Clock } from './Clock';
import { ConfirmAction } from './ConfirmAction';
import type { ManageState } from './manageState';

const combinedPod = (pod: Pod) => !(DIVISIONS as readonly string[]).includes(pod.category);

/** The winner of a finished final, or null while the event is still going. */
export function champion(round: Round | undefined): string | null {
  if (round?.kind !== 'elimination' || round.matches.length !== 1) {
    return null;
  }
  const [final] = round.matches;
  return final ? (eliminationResult(final)?.winner ?? null) : null;
}

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
      <select class='tm-select' aria-label='Top cut size' onChange={e => setSize(Number(e.currentTarget.value))}>
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

/** The clock as one control: time left, then start or pause, then a minute either way. */
export function ClockControls(props: { state: ManageState; pod: Pod; round: Round }) {
  const send = (type: 'startClock' | 'stopClock') => void props.state.send({ type, pod: props.pod.category });
  const adjust = (seconds: number) => void props.state.send({ type: 'adjustClock', pod: props.pod.category, seconds });
  const running = () => props.round.clockStartedAt != null;
  return (
    <span class='tm-clock-group' role='group' aria-label='Round clock'>
      <span class='tm-clock-face'>
        <Clock round={props.round} />
        <Show when={!running() && !props.round.startTime}>
          <span class='tm-clock num is-paused'>{clockLabel(props.round, 0)}</span>
        </Show>
      </span>
      <button type='button' onClick={() => send(running() ? 'stopClock' : 'startClock')}>
        {running() ? 'Pause' : props.round.startTime ? 'Resume' : 'Start clock'}
      </button>
      <button type='button' aria-label='Add a minute' onClick={() => adjust(60)}>
        +1
      </button>
      <button type='button' aria-label='Take a minute off' onClick={() => adjust(-60)}>
        −1
      </button>
    </span>
  );
}

/** Re-pairing, which the seating note offers when someone is waiting and this tucks away otherwise. */
export function RepairControl(props: { state: ManageState; pod: Pod; label?: string }) {
  const [keep, setKeep] = createSignal(true);
  return (
    <span class='tm-inline-form'>
      <label class='tm-check'>
        <input type='checkbox' checked={keep()} onChange={e => setKeep(e.currentTarget.checked)} />
        <span>Keep reported results</span>
      </label>
      <ConfirmAction
        class='btn btn-secondary'
        label={props.label ?? 'Re-pair round'}
        question={keep() ? 'Re-pair the open tables?' : 'Re-pair every table?'}
        confirmLabel='Re-pair'
        disabled={props.state.busy()}
        onConfirm={() => void props.state.send({ type: 'repairRound', pod: props.pod.category, keepReported: keep() })}
      />
    </span>
  );
}

interface ActionsProps {
  state: ManageState;
  pod: Pod;
  round: Round | undefined;
  active: number;
  /** Someone is waiting for a seat: the note carries re-pairing, so this does not. */
  waiting: boolean;
}

function roundOpen(round: Round | undefined): boolean {
  return Boolean(round?.matches.some(m => m.outcome === 'pending'));
}

/** The next step for the round as it stands: pair, cut, re-pair, or delete a round nobody has played. */
export function PairingActions(props: ActionsProps) {
  const pod = () => props.pod.category;
  const nothingReported = () => !props.round?.matches.some(m => m.p2 !== null && m.outcome !== 'pending');
  const canPair = () => !roundOpen(props.round) && champion(props.round) === null;
  const swissDone = () => props.round?.kind === 'swiss' && !roundOpen(props.round);
  return (
    <div class='tm-toolbar tm-actions-bar'>
      <Show when={canPair()}>
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
      <Show when={props.round?.kind === 'swiss' && roundOpen(props.round) && !props.waiting}>
        <details class='tm-disclosure'>
          <summary>Re-pair this round</summary>
          <RepairControl state={props.state} pod={props.pod} />
        </details>
      </Show>
      <Show when={props.round && nothingReported()}>
        <ConfirmAction
          class='btn btn-ghost'
          label='Delete round'
          question={`Delete round ${props.round?.number}?`}
          confirmLabel='Delete'
          disabled={props.state.busy()}
          onConfirm={() => void props.state.send({ type: 'deleteRound', pod: pod() })}
        />
      </Show>
    </div>
  );
}

/** The close of the event: who won, and closing it so final standings and decks can show. */
export function ChampionLine(props: { state: ManageState; code: string; name: string; finished: boolean }) {
  function close() {
    const { code } = props;
    void props.state.run(() => saveSettings(code, { finished: true }));
  }
  return (
    <div class='tm-champion' role='status'>
      <span class='tm-champion-label'>Champion</span>
      <strong class='tm-champion-name'>{props.name}</strong>
      <Show when={!props.finished}>
        <ConfirmAction
          class='btn btn-primary'
          label='Close event'
          question='Close the event?'
          confirmLabel='Close'
          onConfirm={close}
        />
      </Show>
    </div>
  );
}
