/**
 * Placement math for the floating card hover preview.
 *
 * Kept pure (rects in, coordinates out) so the flip/clamp behavior is
 * unit-testable without a DOM — the component just feeds it
 * `getBoundingClientRect()` and the viewport size.
 * @module utils/hoverPreviewPlacement
 */

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PreviewPlacement {
  /** Viewport coordinates for a `position: fixed` layer. */
  left: number;
  top: number;
  /** Which side of the anchor the preview ended up on. */
  side: 'above' | 'below';
}

/** Gap between the anchor and the preview, in px. */
const GAP = 10;
/** Minimum distance the preview keeps from any viewport edge, in px. */
const EDGE_PAD = 8;

/**
 * Positions the preview above the anchor and horizontally centered on it,
 * flipping below when there isn't room above, and clamping to the viewport so
 * it never hangs off an edge. Clamping wins over centering: a preview that is
 * slightly off-center still reads, one that is half offscreen does not.
 * @param anchor - The hovered element's viewport rect.
 * @param preview - The preview's rendered size.
 * @param viewport - The visible viewport size.
 * @returns Fixed-position coordinates and the chosen side.
 */
export function placeHoverPreview(
  anchor: Rect,
  preview: { width: number; height: number },
  viewport: { width: number; height: number }
): PreviewPlacement {
  const roomAbove = anchor.top;
  const roomBelow = viewport.height - (anchor.top + anchor.height);
  const needed = preview.height + GAP + EDGE_PAD;

  // Prefer above (the card reads as rising out of the row). Flip only when
  // above genuinely doesn't fit AND below fits better, so a preview taller
  // than the viewport stays put instead of oscillating.
  const side: 'above' | 'below' = roomAbove >= needed || roomAbove >= roomBelow ? 'above' : 'below';

  const rawTop = side === 'above' ? anchor.top - GAP - preview.height : anchor.top + anchor.height + GAP;
  const maxTop = Math.max(EDGE_PAD, viewport.height - EDGE_PAD - preview.height);
  const top = Math.min(Math.max(rawTop, EDGE_PAD), maxTop);

  const rawLeft = anchor.left + anchor.width / 2 - preview.width / 2;
  const maxLeft = Math.max(EDGE_PAD, viewport.width - EDGE_PAD - preview.width);
  const left = Math.min(Math.max(rawLeft, EDGE_PAD), maxLeft);

  return { left, top, side };
}
