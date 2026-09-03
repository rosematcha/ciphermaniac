/**
 * The four controls a tier carries, drawn rather than typed.
 *
 * Unicode arrows and a pencil character borrow whatever the system font
 * happens to ship: different weights, different baselines, and nothing that
 * matches the rest of the interface. One 16px box, one stroke width, one cap
 * style.
 * @module pages/tierList/icons
 */

import type { JSX } from 'solid-js';

type IconName = 'up' | 'down' | 'edit' | 'close';

const PATHS: Record<IconName, string> = {
  up: 'M8 12.5V3.5M4.5 7L8 3.5L11.5 7',
  down: 'M8 3.5v9M4.5 9l3.5 3.5L11.5 9',
  edit: 'M11.2 3.3a1.4 1.4 0 0 1 2 2L6.6 11.9l-2.7.8.8-2.7 6.5-6.7Z',
  close: 'M4.5 4.5l7 7M11.5 4.5l-7 7'
};

/** A 16px stroked glyph inheriting `currentColor`. Decorative by default. */
export function Icon(props: { name: IconName }): JSX.Element {
  return (
    <svg
      viewBox='0 0 16 16'
      fill='none'
      stroke='currentColor'
      stroke-width='1.75'
      stroke-linecap='round'
      stroke-linejoin='round'
      aria-hidden='true'
    >
      <path d={PATHS[props.name]} />
    </svg>
  );
}
