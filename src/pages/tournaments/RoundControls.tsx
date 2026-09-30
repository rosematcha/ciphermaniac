/**
 * The controls that move a round along besides pairing the next one (the
 * console's head does that, and offers the top cut once the Swiss rounds are
 * played): the clock, re-pairing, deleting a round nobody has played, and the
 * champion. Each shows only in the state it belongs to, and anything that
 * cannot be taken back asks first, in place.
 */

import { createSignal, For, Show } from 'solid-js';
import { TOP_CUT_SIZES } from '../../../shared/tournament/commands';
import { type Division, DIVISION_LABELS, type Pod, type Round } from '../../../shared/tournament/types';
import { clockLabel, type DivisionCut } from '../../lib/tournament/present';
import { Clock } from './Clock';
import { ConfirmAction } from './ConfirmAction';
import type { ManageState } from './manageState';

/** With no cut planned, the biggest one the players still in can fill, up to a top 8. */
const largestCut = (active: number) => TOP_CUT_SIZES.filter(n => n <= Math.min(8, active)).at(-1) ?? 2;

/** The size to offer first for a division: its planned cut, else the biggest it can fill. */
const suggestedCut = (entry: DivisionCut | undefined) => (entry ? entry.cut || largestCut(entry.active) : 2);

/**
 * The top cut's size, then the button that starts it. `cuts` are the
 * divisions the pod plays that have yet to cut (see divisionCuts); in a pod
 * of several (`divided`), each cuts on its own, so the division is named too,
 * asked when more than one is left, and picking one offers its own cut first.
 */
export function TopCutControl(props: {
  state: ManageState;
  pod: Pod;
  cuts: readonly DivisionCut[];
  divided: boolean;
  primary?: boolean;
}) {
  // eslint-disable-next-line solid/reactivity -- a starting suggestion; the organizer's pick wins from then on
  const [division, setDivision] = createSignal<Division>(props.cuts.at(-1)?.division ?? 'masters');
  // The pick, while it is still a division left to cut; the last one left otherwise.
  const entry = () => props.cuts.find(c => c.division === division()) ?? props.cuts.at(-1);

  // A size picked stays with the division it was picked for; another division offers its own first.
  const [picked, setPicked] = createSignal<{ division: Division | undefined; size: number } | null>(null);
  const size = () => {
    const choice = picked();
    return choice && choice.division === entry()?.division ? choice.size : suggestedCut(entry());
  };
  const setSize = (next: number) => setPicked({ division: entry()?.division, size: next });
  const several = () => props.cuts.length > 1;
  const pickDivision = (next: Division) => setDivision(next);
  function start() {
    const cut = { type: 'startTopCut' as const, pod: props.pod.category, size: size() };
    const picked = entry()?.division;
    void props.state.send(props.divided && picked ? { ...cut, division: picked } : cut);
  }
  return (
    <span class='tm-inline-form'>
      <Show when={several()}>
        <select
          class='tm-select'
          aria-label='Division to cut'
          onChange={e => pickDivision(e.currentTarget.value as Division)}
        >
          <For each={props.cuts}>
            {c => (
              <option value={c.division} selected={c.division === entry()?.division}>
                {DIVISION_LABELS[c.division]}
              </option>
            )}
          </For>
        </select>
      </Show>
      <select class='tm-select' aria-label='Top cut size' onChange={e => setSize(Number(e.currentTarget.value))}>
        <For each={TOP_CUT_SIZES.filter(n => n <= (entry()?.active ?? 0))}>
          {n => (
            <option value={n} selected={n === size()}>
              Top {n}
            </option>
          )}
        </For>
      </select>
      <button
        type='button'
        class={props.primary ? 'btn btn-primary' : 'btn btn-secondary'}
        disabled={props.state.busy()}
        onClick={start}
      >
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

/** Who won; ending the event is the console head's next step once there is a champion. */
export function ChampionLine(props: { name: string }) {
  return (
    <div class='tm-strip tm-champion' role='status'>
      <span class='tm-champion-label'>Champion</span>
      <strong class='tm-champion-name'>{props.name}</strong>
    </div>
  );
}
