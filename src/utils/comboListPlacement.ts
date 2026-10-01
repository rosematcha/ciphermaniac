/**
 * Placement math for a Combo's list.
 *
 * The list floats in the top layer so a table that clips its overflow (every
 * `.table-wrap` does) cannot cut it off, which leaves it to be placed by hand
 * against the field it belongs to. Kept pure, rects in and coordinates out, as
 * the card hover preview's is.
 * @module utils/comboListPlacement
 */

import type { Rect } from './hoverPreviewPlacement';

/** The part of the layout viewport that can be seen, e.g. above a phone's keyboard. */
export interface Band {
  top: number;
  height: number;
}

export interface ListPlacement {
  /** Viewport coordinates for a `position: fixed` layer. */
  left: number;
  width: number;
  /** The list's top edge below the field, its bottom edge above it. */
  top: number;
  maxHeight: number;
  side: 'above' | 'below';
}

/** The tallest the list draws when it has the room. */
export const LIST_MAX_HEIGHT = 296;
/** Gap between the field and the list, in px. */
const GAP = 4;
/** Minimum distance the list keeps from the visible band's edges, in px. */
const EDGE_PAD = 8;

/**
 * Hangs the list under the field, as wide as it, and turns it upward when the
 * room under the field is short of a full list and there is more above. Either
 * way the list is held to the room it has, so the last row can always be
 * scrolled to.
 * @param field - The field's viewport rect.
 * @param band - The visible band of the viewport.
 * @returns Fixed-position coordinates and the chosen side.
 */
export function placeComboList(field: Rect, band: Band): ListPlacement {
  const fieldBottom = field.top + field.height;
  const roomBelow = band.top + band.height - fieldBottom - GAP - EDGE_PAD;
  const roomAbove = field.top - band.top - GAP - EDGE_PAD;
  const below = roomBelow >= LIST_MAX_HEIGHT || roomBelow >= roomAbove;
  return {
    left: field.left,
    width: field.width,
    top: below ? fieldBottom + GAP : field.top - GAP,
    maxHeight: Math.max(0, Math.min(LIST_MAX_HEIGHT, below ? roomBelow : roomAbove)),
    side: below ? 'below' : 'above'
  };
}
