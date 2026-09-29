import { createSignal, onCleanup, onMount } from 'solid-js';

/** The time, ticking each second while the component is mounted: for clocks and status lines. */
export function createNow() {
  const [now, setNow] = createSignal(Date.now());
  onMount(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    onCleanup(() => clearInterval(timer));
  });
  return now;
}
