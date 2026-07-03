import { createEffect, createSignal, type JSX, onCleanup } from 'solid-js';

/**
 * Small inline tooltip trigger. Renders a marker (asterisk by default) that
 * reveals a styled bubble on hover, keyboard focus, or tap. Used for caveats
 * and metric explanations where a full sentence would clutter the row.
 *
 * Tap support matters: on touch devices there is no hover, so without the
 * click toggle these notes simply didn't exist on phones. While open, the
 * bubble is clamped inside the viewport (near screen edges the centered
 * position used to push half the bubble offscreen) and closes on outside
 * tap or Escape.
 *
 * The `label` is exposed to assistive tech via `aria-label` so the note is
 * announced without needing to render the bubble visually.
 */
export function InfoTip(props: { children: JSX.Element; label?: string; marker?: string }) {
  const [open, setOpen] = createSignal(false);
  const [shift, setShift] = createSignal(0);
  let root: HTMLSpanElement | undefined;
  let bubble: HTMLSpanElement | undefined;

  createEffect(() => {
    if (!open()) {
      setShift(0);
      return;
    }
    // Clamp after paint: measure where the centered bubble landed and nudge
    // it back inside the viewport if it hangs off either edge.
    requestAnimationFrame(() => {
      if (!bubble) {
        return;
      }
      const r = bubble.getBoundingClientRect();
      const pad = 8;
      if (r.left < pad) {
        setShift(pad - r.left);
      } else if (r.right > window.innerWidth - pad) {
        setShift(window.innerWidth - pad - r.right);
      }
    });
    const onDocPointer = (e: PointerEvent) => {
      if (root && e.target instanceof Node && !root.contains(e.target)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onDocPointer);
    document.addEventListener('keydown', onKey);
    onCleanup(() => {
      document.removeEventListener('pointerdown', onDocPointer);
      document.removeEventListener('keydown', onKey);
    });
  });

  return (
    <span
      ref={root}
      class='info-tip'
      classList={{ open: open() }}
      tabindex='0'
      role='note'
      aria-label={props.label}
      onClick={() => setOpen(!open())}
    >
      <span class='info-tip-marker' aria-hidden='true'>
        {props.marker ?? '*'}
      </span>
      <span ref={bubble} class='info-tip-bubble' role='tooltip' style={{ '--tip-shift': `${shift()}px` }}>
        {props.children}
      </span>
    </span>
  );
}
