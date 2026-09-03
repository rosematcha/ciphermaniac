/**
 * Choosing the width the board is exported at.
 *
 * On screen the board takes the width the page gives it, which is correct
 * there: the tray sits under it and the rows should line up with the rest of
 * the layout. In an exported image that width is a liability. A card-art list
 * four tiles across came out 1116px wide with 700 of them empty, because
 * nothing about the width of a browser window has anything to do with the shape
 * of the artwork.
 *
 * So the export picks its own width. The board is narrowed through a series of
 * candidates, each wrapping roughly one more tile out of its longest row, and
 * every candidate is *measured* rather than predicted — icon chips are as wide
 * as the archetype's name, so there is no arithmetic that gets this right for
 * all three views.
 *
 * Two rules pick the winner, and both exist because the obvious version of this
 * got it wrong:
 *
 * - **Widest target first, not nearest target.** Scoring every candidate
 *   against every ratio and taking the closest match turned a two-tier list of
 *   fourteen cards into a 4:5 portrait four cards wide, because wrapping a wide
 *   board eventually passes near enough to some ratio to win on points. A
 *   two-tier list is short and wide, and the row-is-a-tier reading is the whole
 *   point of the image. So the targets are tried widest first and the first one
 *   anything comes close to wins.
 * - **Padding towards a ratio is capped at one tile's worth.** A tall narrow
 *   list — ten tiers holding one card each — has no width to give, and padding
 *   it out to 4:5 would be a worse version of the void this exists to remove.
 *   Up to one tile, the gap reads as a row that could have held one more card,
 *   which is what every tier list looks like anyway.
 * @module lib/tierList/exportFit
 */

/**
 * Aspect ratios (width ÷ height) the export aims for, widest first. A tie goes
 * to the wider candidate, which is the one that wrapped less.
 */
export const EXPORT_RATIOS: readonly number[] = [16 / 9, 4 / 3, 5 / 4, 1, 4 / 5];

/** The narrowest ratio worth padding out to. */
const NARROWEST = EXPORT_RATIOS[EXPORT_RATIOS.length - 1]!;

/** Breathing room to the right of the last tile, in CSS px. */
export const SLACK = 18;

/**
 * How far off a target a candidate may sit and still count as hitting it.
 * Fifteen percent: close enough that nobody reads the image as a different
 * shape, loose enough that a discrete set of wrap points can land on it.
 */
const TOLERANCE = Math.log(1.15);

/**
 * Widths to measure, as fractions of the width the content needs unwrapped.
 *
 * Geometric rather than one-tile-at-a-time, because the thing being matched is
 * a ratio: even steps in width are wildly uneven steps in shape. Stepping by a
 * tile also stepped straight over the wide end of the target list — an
 * eighteen-chip board went from 3:1 to 1.4:1 in one move, missing both 16:9 and
 * 4:3, and settled for a square.
 *
 * Nothing below one tile wide is reachable: a flex row will not shrink under
 * its own min-content, so an over-narrow constraint measures the same shape as
 * the last usable one and is discarded as a duplicate.
 */
const SWEEP: readonly number[] = [
  1, 0.88, 0.78, 0.69, 0.61, 0.54, 0.48, 0.42, 0.37, 0.33, 0.29, 0.25, 0.22, 0.19, 0.16
];

/** One shape the board can take, as measured at some width. */
export interface LayoutSample {
  /** The width the board was constrained to for this measurement. */
  constraint: number;
  height: number;
  /** Board left edge to the right edge of the rightmost tile. */
  used: number;
}

/**
 * How far a ratio sits from the nearest target.
 *
 * Log distance, not linear: 2.0 is as far from 16:9 as 1.58 is, and a linear
 * difference would call the first one closer purely because ratios above 1 have
 * more room to spread out.
 */
export function ratioDistance(ratio: number): number {
  if (!(ratio > 0)) {
    return Infinity;
  }
  return Math.min(...EXPORT_RATIOS.map(target => Math.abs(Math.log(ratio / target))));
}

/**
 * The width to export a measured layout at.
 *
 * The content plus {@link SLACK}, then padded towards {@link NARROWEST} — but
 * never by more than one tile's stride, past which the padding stops reading as
 * an unfilled row and starts reading as a void.
 * @param sample - A measured layout.
 * @param tileStride - One tile's width plus the gap after it.
 * @returns The width in CSS px.
 */
export function exportWidth(sample: LayoutSample, tileStride: number): number {
  const tight = sample.used + SLACK;
  return Math.min(Math.max(tight, sample.height * NARROWEST), tight + Math.max(0, tileStride));
}

/**
 * Walks a board down through progressively narrower widths, measuring each.
 *
 * Takes the measurement as a callback so the walk can be exercised without a
 * DOM; the caller supplies whatever applying a width really costs. Candidates
 * that came out the same shape as the one before are dropped, so the result is
 * one entry per distinct wrapping.
 * @param natural - The board measured at its own unconstrained width.
 * @param measureAt - Applies a width and returns what the board became.
 * @returns Distinct candidates, widest first.
 */
export function sampleLayouts(natural: LayoutSample, measureAt: (width: number) => LayoutSample): LayoutSample[] {
  const tight = natural.used + SLACK;
  const samples: LayoutSample[] = [];
  for (const fraction of SWEEP) {
    const sample = measureAt(tight * fraction);
    const previous = samples[samples.length - 1];
    if (!previous || sample.used < previous.used) {
      samples.push(sample);
    }
  }
  return samples;
}

/**
 * The candidate to export.
 *
 * Targets are tried widest first and the first one any candidate comes within
 * {@link TOLERANCE} of wins — "aim wide, narrow only as needed". Nothing within
 * tolerance of anything falls back to the nearest miss, which is the tall
 * narrow list that simply has no width to give.
 * @param samples - Measured layouts, widest first.
 * @param tileStride - One tile's width plus the gap after it.
 * @returns The best sample, or null when there is nothing to choose between.
 */
export function bestLayout(samples: readonly LayoutSample[], tileStride: number): LayoutSample | null {
  const ratioOf = (sample: LayoutSample): number => exportWidth(sample, tileStride) / sample.height;
  const nearest = (target: number | null): LayoutSample | null => {
    let best: LayoutSample | null = null;
    let bestDistance = Infinity;
    for (const sample of samples) {
      const ratio = ratioOf(sample);
      const distance = target === null ? ratioDistance(ratio) : Math.abs(Math.log(ratio / target));
      // Strictly less than, so a tie keeps the earlier — and therefore wider —
      // candidate rather than wrapping for nothing.
      if (distance < bestDistance) {
        bestDistance = distance;
        best = sample;
      }
    }
    return best;
  };

  for (const target of EXPORT_RATIOS) {
    const hit = nearest(target);
    if (hit && Math.abs(Math.log(ratioOf(hit) / target)) <= TOLERANCE) {
      return hit;
    }
  }
  return nearest(null);
}

/**
 * Narrows `board` to the width it should be exported at.
 *
 * Measures its own way there, so it works the same in all three views and
 * survives any later change to tile sizes. A board with no tiles is left alone:
 * there is no content to fit and nothing to measure it from.
 * @param board - The node the exporter will rasterise.
 * @returns A teardown restoring the board's own width. Always call it.
 */
export function fitBoardForExport(board: HTMLElement): () => void {
  // Aliased, not written through the parameter: this function owns the board's
  // width for the duration of an export and nothing else.
  const { style } = board;
  const original = style.width;
  const restore = (): void => {
    style.width = original;
  };

  const tiles = (): HTMLElement[] => [...board.querySelectorAll<HTMLElement>('.tl-item')];
  if (tiles().length === 0) {
    return restore;
  }

  const measure = (): LayoutSample => {
    const box = board.getBoundingClientRect();
    let used = 0;
    for (const tile of tiles()) {
      used = Math.max(used, tile.getBoundingClientRect().right - box.left);
    }
    return { constraint: box.width, height: box.height, used: Math.ceil(used) };
  };

  const sampleAt = (constraint: number): LayoutSample => {
    style.width = `${Math.round(constraint)}px`;
    return { ...measure(), constraint };
  };

  const stride = tileStride(board, tiles());
  const best = bestLayout(sampleLayouts(measure(), sampleAt), stride);
  if (!best) {
    restore();
    return restore;
  }
  // Re-apply and re-measure: the chosen width comes from the sample's own
  // usage, and the sample was taken at a width that may have been slightly
  // wider than the tiles ended up needing.
  style.width = `${Math.round(exportWidth(sampleAt(best.constraint), stride))}px`;
  return restore;
}

/** One tile's width plus the gap that follows it, taken from the widest tile on the board. */
function tileStride(board: HTMLElement, tiles: readonly HTMLElement[]): number {
  const widest = Math.max(...tiles.map(tile => tile.getBoundingClientRect().width));
  const zone = board.querySelector('.tl-zone');
  const gap = zone ? Number.parseFloat(getComputedStyle(zone).columnGap) : NaN;
  return widest + (Number.isFinite(gap) ? gap : 0);
}
