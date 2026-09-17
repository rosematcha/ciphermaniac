import { type Accessor, createEffect, createSignal, on, onCleanup } from 'solid-js';
import { prefersReducedMotion } from './juice';

/** How long a figure takes to count to its new total, as `ease_chips` does. */
const COUNT_MS = 500;

/** Where a count stands `t` (0 to 1) of the way through: fast out, settling in. */
export function countAt(from: number, to: number, t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return from + (to - from) * (1 - (1 - clamped) ** 3);
}

/** A number that counts to each new value of `target` instead of jumping to it. */
export function createCount(target: Accessor<number>): Accessor<number> {
  const [shown, setShown] = createSignal(0);
  let frame = 0;
  onCleanup(() => cancelAnimationFrame(frame));
  createEffect(
    on(target, to => {
      cancelAnimationFrame(frame);
      if (prefersReducedMotion()) {
        setShown(to);
        return;
      }
      const from = shown();
      const start = performance.now();
      const tick = (now: number) => {
        const t = (now - start) / COUNT_MS;
        setShown(countAt(from, to, t));
        if (t < 1) {
          frame = requestAnimationFrame(tick);
        }
      };
      frame = requestAnimationFrame(tick);
    })
  );
  return shown;
}
