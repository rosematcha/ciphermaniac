/**
 * Reset, Share and Export — and, on a phone, the strip they share with the
 * tap-to-place prompt.
 *
 * They have two homes. On a desktop they sit at the right of the toolbar. On a
 * phone the toolbar is two rows of what is being ranked and the actions ride
 * the dock instead, because a strip pinned to the bottom edge is the one place
 * always in reach — they used to sit under the tray, eight hundred pixels below
 * the board, which is where "there is no reset button" comes from.
 *
 * The prompt takes the same slot rather than a bar of its own: two fixed strips
 * competing for the bottom edge means the prompt covers the buttons it is
 * standing in for.
 * @module pages/tierList/Actions
 */

import { createSignal, type JSX, Show } from 'solid-js';

interface ActionsProps {
  /** An export in flight. The button says so and refuses a second one. */
  busy: boolean;
  onReset: () => void;
  onShare: () => void;
  onExport: () => void;
}

export function Actions(props: ActionsProps): JSX.Element {
  // Reset throws away work and cannot be undone, so it asks first. Local, not
  // page state: nothing outside this row can arm it or needs to read it.
  const [armed, setArmed] = createSignal(false);
  return (
    <div class='tl-actions'>
      <button
        type='button'
        class='tl-btn'
        classList={{ warn: armed() }}
        onClick={() => {
          if (armed()) {
            props.onReset();
          }
          setArmed(was => !was);
        }}
        onBlur={() => setArmed(false)}
      >
        {armed() ? 'Reset everything?' : 'Reset'}
      </button>
      <button type='button' class='tl-btn' onClick={() => props.onShare()}>
        Share
      </button>
      <button type='button' class='tl-btn primary' disabled={props.busy} onClick={() => props.onExport()}>
        {props.busy ? 'Rendering…' : 'Export JPG'}
      </button>
    </div>
  );
}

interface DockStripProps extends ActionsProps {
  /** What a tap has picked up, if anything. */
  held?: string;
  onCancel: () => void;
}

export function DockStrip(props: DockStripProps): JSX.Element {
  return (
    <div class='tl-dockbar'>
      <Show when={props.held} fallback={<Actions {...props} />}>
        {label => (
          <>
            <span>Place {label()} in a tier</span>
            <button type='button' class='tl-btn' onClick={() => props.onCancel()}>
              Cancel
            </button>
          </>
        )}
      </Show>
    </div>
  );
}
