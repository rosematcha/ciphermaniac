/**
 * The controls that move a round along besides pairing the next one (the
 * console's head does that): the top cut, the clock, re-pairing, deleting a
 * round nobody has played, and the champion. Each shows only in the state it
 * belongs to, and anything that cannot be taken back asks first, in place.
 */

import { createSignal, For, Show } from 'solid-js';
import { TOP_CUT_SIZES } from '../../../shared/tournament/commands';
import { type Division, DIVISION_LABELS, DIVISIONS, type Pod, type Round } from '../../../shared/tournament/types';
import { clockLabel, recommendedStructure } from '../../lib/tournament/present';
import { Clock } from './Clock';
import { ConfirmAction } from './ConfirmAction';
import type { ManageState } from './manageState';

const combinedPod = (pod: Pod) => !(DIVISIONS as readonly string[]).includes(pod.category);

export function TopCutControl(props: { state: ManageState; pod: Pod; active: number }) {
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

/**
 * Re-pairing, asked in place with whether to keep the results already
 * reported: the open tables only, or every table.
 */
export function RepairControl(props: {
  state: ManageState;
  pod: Pod;
  label: string;
  question?: string;
  class?: string;
}) {
  const [keep, setKeep] = createSignal(true);
  return (
    <ConfirmAction
      class={props.class ?? 'btn btn-ghost tm-small'}
      label={props.label}
      question={props.question ?? (keep() ? 'Re-pair the open tables?' : 'Re-pair every table?')}
      confirmLabel='Re-pair'
      disabled={props.state.busy()}
      extra={
        <label class='tm-check'>
          <input type='checkbox' checked={keep()} onChange={e => setKeep(e.currentTarget.checked)} />
          <span>Keep reported results</span>
        </label>
      }
      onConfirm={() => void props.state.send({ type: 'repairRound', pod: props.pod.category, keepReported: keep() })}
    />
  );
}

/** Deleting a round nobody has reported a result in, asked in place. */
export function DeleteRound(props: { state: ManageState; pod: Pod; round: Round }) {
  return (
    <ConfirmAction
      class='btn btn-ghost tm-small'
      label='Delete round'
      question={`Delete round ${props.round.number}?`}
      confirmLabel='Delete'
      danger
      disabled={props.state.busy()}
      onConfirm={() => void props.state.send({ type: 'deleteRound', pod: props.pod.category })}
    />
  );
}

/** Who won; closing the event is the console head's next step once there is a champion. */
export function ChampionLine(props: { name: string }) {
  return (
    <div class='tm-strip tm-champion' role='status'>
      <span class='tm-champion-label'>Champion</span>
      <strong class='tm-champion-name'>{props.name}</strong>
    </div>
  );
}
