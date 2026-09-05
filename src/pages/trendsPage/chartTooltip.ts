/**
 * Hover-tooltip placement for the Trends chart.
 *
 * The tooltip's width depends on which archetype labels are in view, so the
 * flip decision has to be made against a measured width rather than a guess.
 */

import { createMemo, createSignal, type JSX, onCleanup } from 'solid-js';

/** Space between the crosshair and the hover tooltip, in px. */
export const CHART_TOOLTIP_GAP = 12;

/**
 * Horizontal placement for the chart's hover tooltip, in px from the left edge
 * of the chart box.
 *
 * The tooltip sits to the right of the crosshair and flips to the left only
 * when it would actually overflow the box — flipping on the midpoint instead
 * (the old rule) put the card on the outside of the crosshair while there was
 * still room, and still overflowed once the card grew past half the chart.
 * @param cx - Crosshair x, in px from the box's left edge
 * @param tipW - Measured tooltip width in px
 * @param boxW - Chart box width in px
 * @param gap - Space between crosshair and tooltip
 * @returns Left offset in px, always inside the box when the tooltip fits
 */
export function placeChartTooltip(cx: number, tipW: number, boxW: number, gap = CHART_TOOLTIP_GAP): number {
  const right = cx + gap;
  if (right + tipW <= boxW) {
    return right;
  }
  const left = cx - gap - tipW;
  if (left >= 0) {
    return left;
  }
  // Wider than the room on either side: keep it in the box.
  return Math.max(0, boxW - tipW);
}

/**
 * Track the rendered tooltip's width and derive its offset inside the chart box.
 * @param wrap - The chart box the tooltip is positioned inside
 * @param svgWidth - The svg's width in user units
 * @param crosshairX - Crosshair x in svg user units, or null when nothing is hovered
 * @returns A ref callback for the tooltip element and the style that positions it
 */
export function createChartTooltipPlacement(
  wrap: () => HTMLElement | undefined,
  svgWidth: () => number,
  crosshairX: () => number | null
): { observeTooltip: (el: HTMLElement) => void; style: () => JSX.CSSProperties } {
  const [tooltipW, setTooltipW] = createSignal(0);

  function observeTooltip(el: HTMLElement): void {
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        setTooltipW((entry.target as HTMLElement).offsetWidth);
      }
    });
    ro.observe(el);
    onCleanup(() => ro.disconnect());
  }

  const left = createMemo<number | null>(() => {
    const svgX = crosshairX();
    const tipW = tooltipW();
    const svgW = svgWidth();
    const box = wrap();
    if (svgX === null || tipW === 0 || !box) {
      return null;
    }
    const boxW = box.clientWidth;
    // The crosshair is in svg user units; the svg is stretched to the box's css width.
    const cx = boxW > 0 && svgW > 0 ? (svgX / svgW) * boxW : svgX;
    return placeChartTooltip(cx, tipW, boxW);
  });

  // Hidden until the first measurement lands, rather than flashing on the wrong
  // side of the crosshair for a frame.
  const style = (): JSX.CSSProperties => {
    const px = left();
    return {
      left: `${px ?? (crosshairX() ?? 0) + CHART_TOOLTIP_GAP}px`,
      visibility: px === null ? 'hidden' : 'visible'
    };
  };

  return { observeTooltip, style };
}
