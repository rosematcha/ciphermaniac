import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import type { Round } from '../../../shared/tournament/types';
import { clockLabel } from '../../lib/tournament/present';

/** The round's time left, ticking while the clock runs. */
export function Clock(props: { round: Round; class?: string }) {
  const [now, setNow] = createSignal(Date.now());
  onMount(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    onCleanup(() => clearInterval(timer));
  });
  const running = () => props.round.clockStartedAt != null;
  return (
    <Show when={running() || props.round.startTime}>
      <span
        class={`tm-clock num ${props.class ?? ''}`}
        classList={{ 'is-paused': !running(), 'is-over': clockLabel(props.round, now()).startsWith('-') }}
        role='timer'
        aria-label='Time left in the round'
      >
        {clockLabel(props.round, now())}
      </span>
    </Show>
  );
}
