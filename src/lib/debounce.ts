import { type Accessor, createEffect, createSignal, on, onCleanup } from 'solid-js';

/**
 * A trailing-edge debounced view of a reactive accessor: tracks `source` but
 * only propagates its latest value after it has been stable for `delayMs`.
 * Lets an input stay perfectly live (bind the raw signal) while the expensive
 * derived work downstream (filter → sort → render) reads the debounced one.
 */
export function debounced<T>(source: Accessor<T>, delayMs: number): Accessor<T> {
  const [value, setValue] = createSignal(source());
  let timer: ReturnType<typeof setTimeout> | undefined;
  createEffect(
    on(
      source,
      next => {
        clearTimeout(timer);
        timer = setTimeout(() => setValue(() => next), delayMs);
      },
      { defer: true }
    )
  );
  onCleanup(() => clearTimeout(timer));
  return value;
}
