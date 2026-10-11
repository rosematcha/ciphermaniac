import { createMemo, type JSX, Show } from 'solid-js';
import { awaitingMark, type SeatState } from '../../lib/tournament/awaitingMarks';

const labels: Record<string, string> = { W: 'Win', L: 'Loss', T: 'Tie' };

export function PendingSeatMark(props: SeatState & { enabled: boolean; children: JSX.Element }) {
  const state = createMemo(() => awaitingMark(props));
  const label = () => {
    const result = labels[state().mark] ?? '';
    return state().pending ? `${result}, awaiting acceptance` : result;
  };
  return (
    <Show when={props.enabled} fallback={props.children}>
      <span
        class='tm-mark tm-pending-mark'
        classList={{
          'is-win': state().mark === 'W',
          'is-loss': state().mark === 'L',
          'is-awaiting': state().pending,
          'is-problem': state().problem
        }}
        title={label()}
      >
        <span aria-hidden='true'>
          {state().mark}
          {state().pending ? '?' : ''}
        </span>
        <span class='sr-only'>{label()}</span>
      </span>
    </Show>
  );
}
