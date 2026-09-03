/**
 * The exported image, held on screen.
 *
 * A phone gets this instead of a download. An in-app browser has nowhere to put
 * a download and navigates to the file instead — which the user reads as the
 * page reloading — and even where a download would land, the picture someone
 * made should be looked at before it is filed. The share sheet is behind a
 * button of its own rather than opened from the export: a render can outlast
 * the gesture that started it, and the sheet needs one.
 * @module pages/tierList/Shot
 */

import { type JSX, onCleanup, onMount, Show } from 'solid-js';
import { canShareFile, shareFile } from '../../lib/download';

interface ShotProps {
  file: File;
  onClose: () => void;
}

export function Shot(props: ShotProps): JSX.Element {
  // Read once, untracked: the parent renders this behind a `keyed` Show, so a
  // new export is a new component rather than a new prop on this one.
  /* eslint-disable solid/reactivity */
  const url = URL.createObjectURL(props.file);
  const shareable = canShareFile(props.file);
  /* eslint-enable solid/reactivity */
  onCleanup(() => URL.revokeObjectURL(url));

  onMount(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        props.onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    onCleanup(() => document.removeEventListener('keydown', onKey));
  });

  return (
    <div
      class='tl-shot'
      role='dialog'
      aria-label='Exported image'
      onClick={event => {
        if (event.target === event.currentTarget) {
          props.onClose();
        }
      }}
    >
      <img src={url} alt='Your tier list' />
      <div class='tl-shot-bar'>
        <Show when={!shareable}>
          <span>Press and hold the image to save it</span>
        </Show>
        <Show when={shareable}>
          <button type='button' class='tl-btn primary' onClick={() => void shareFile(props.file)}>
            Save image
          </button>
        </Show>
        <button type='button' class='tl-btn' onClick={() => props.onClose()}>
          Done
        </button>
      </div>
    </div>
  );
}
