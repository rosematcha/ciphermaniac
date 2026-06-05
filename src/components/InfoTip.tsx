import type { JSX } from 'solid-js';

/**
 * Small inline tooltip trigger. Renders a marker (asterisk by default) that
 * reveals a styled bubble on hover or keyboard focus. Used for caveats and
 * metric explanations where a full sentence would clutter the surrounding row.
 *
 * The `label` is exposed to assistive tech via `aria-label` so the note is
 * announced without needing to render the bubble visually.
 */
export function InfoTip(props: { children: JSX.Element; label?: string; marker?: string }) {
  return (
    <span class='info-tip' tabindex='0' role='note' aria-label={props.label}>
      <span class='info-tip-marker' aria-hidden='true'>
        {props.marker ?? '*'}
      </span>
      <span class='info-tip-bubble' role='tooltip'>
        {props.children}
      </span>
    </span>
  );
}
