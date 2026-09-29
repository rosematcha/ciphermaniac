import { For } from 'solid-js';

const SQUARE_CLASS: Record<string, string> = { W: 'is-win', T: 'is-tie', L: 'is-loss' };

/**
 * A player's rounds as squares: a win filled, a loss and a tie outlined (a
 * tie half-filled), a round still to play dashed. `marks` holds W, L, T or ''
 * per round played; `rounds` pads the row out to the rounds so far.
 */
export function Squares(props: { marks: readonly string[]; rounds?: number }) {
  const cells = () => [
    ...props.marks,
    ...Array.from({ length: Math.max(0, (props.rounds ?? 0) - props.marks.length) }, () => '')
  ];
  return (
    <span class='tm-squares' role='img' aria-label={`Rounds: ${props.marks.filter(Boolean).join(' ') || 'none yet'}`}>
      <For each={cells()}>
        {mark => (
          <span class={`tm-sq ${SQUARE_CLASS[mark] ?? 'is-open'}`} aria-hidden='true'>
            {mark}
          </span>
        )}
      </For>
    </span>
  );
}
