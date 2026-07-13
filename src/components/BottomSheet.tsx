import { createEffect, createSignal, type JSX, onCleanup, type ParentComponent, Show } from 'solid-js';
import { Portal } from 'solid-js/web';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  /** Header title, also the default accessible name. */
  title: string;
  ariaLabel?: string;
  /** Sticky footer row (e.g. Clear + primary action). */
  footer?: JSX.Element;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => !el.hasAttribute('disabled'));
}

/**
 * Mobile bottom sheet: a scrim + a panel that slides up from the bottom edge.
 * Portalled to <body> so its `position: fixed` layer escapes the page's
 * stacking/transform context. Purely presentational — callers own the open
 * signal and the body content; visibility on desktop is a CSS concern (the
 * only trigger that opens it lives in a mobile-only control row).
 */
export const BottomSheet: ParentComponent<BottomSheetProps> = props => {
  let dialogRef: HTMLDivElement | undefined;

  // Mount/animation split: `mounted` keeps the DOM alive through both
  // transitions; `shown` drives the .open classes. Opening mounts closed and
  // flips .open a frame later so the slide-up/scrim-fade actually plays
  // (mounting with .open already applied paints directly in the end state);
  // closing removes .open first and unmounts after the transition finishes.
  const [mounted, setMounted] = createSignal(false);
  const [shown, setShown] = createSignal(false);
  const UNMOUNT_DELAY_MS = 220; // just past --ms-base (180ms)

  createEffect(() => {
    if (props.open) {
      setMounted(true);
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      onCleanup(() => cancelAnimationFrame(raf));
    } else if (mounted()) {
      setShown(false);
      const timer = setTimeout(() => setMounted(false), UNMOUNT_DELAY_MS);
      onCleanup(() => clearTimeout(timer));
    }
  });

  createEffect(() => {
    if (!props.open) {
      return;
    }

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const onKey = (e: KeyboardEvent) => {
      const dialog = dialogRef;
      if (!dialog) {
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        props.onClose();
        return;
      }
      if (e.key !== 'Tab') {
        return;
      }
      const nodes = focusableIn(dialog);
      if (nodes.length === 0) {
        e.preventDefault();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);

    queueMicrotask(() => {
      const dialog = dialogRef;
      if (!dialog) {
        return;
      }
      const nodes = focusableIn(dialog);
      (nodes[0] ?? dialog).focus();
    });

    onCleanup(() => {
      document.removeEventListener('keydown', onKey);
      previouslyFocused?.focus?.();
    });
  });

  return (
    <Show when={mounted()}>
      <Portal>
        <div class='sheet-scrim' classList={{ open: shown() }} aria-hidden='true' onClick={() => props.onClose()} />
        <div
          ref={dialogRef}
          class='sheet'
          classList={{ open: shown() }}
          role='dialog'
          aria-modal='true'
          aria-label={props.ariaLabel ?? props.title}
        >
          <div class='sheet-grip' aria-hidden='true' />
          <div class='sheet-head'>
            <h2>{props.title}</h2>
            <button class='sheet-close' type='button' onClick={() => props.onClose()}>
              Close
            </button>
          </div>
          <div class='sheet-body'>{props.children}</div>
          <Show when={props.footer}>
            <div class='sheet-foot'>{props.footer}</div>
          </Show>
        </div>
      </Portal>
    </Show>
  );
};
