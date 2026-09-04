/**
 * Device-independent export fitting. Measure a geometric width sweep, prefer
 * the widest acceptable target, and pad sparse boards to at least 4:5.
 */

/** Target aspect ratios, widest first. */
export const EXPORT_RATIOS: readonly number[] = [16 / 9, 4 / 3, 5 / 4, 1, 4 / 5];

const NARROWEST = EXPORT_RATIOS[EXPORT_RATIOS.length - 1]!;

export const SLACK = 18;

/** Desktop board width in CSS pixels, used as the device-independent starting point. */
export const WIDEST = 1116;

/** A candidate within 15% of a target counts as a hit. */
const TOLERANCE = Math.log(1.15);

/**
 * Geometric constraints sample aspect ratios evenly. Constraints below one
 * tile are omitted because flex min-content makes them duplicate measurements.
 */
const SWEEP: readonly number[] = [
  1, 0.88, 0.78, 0.69, 0.61, 0.54, 0.48, 0.42, 0.37, 0.33, 0.29, 0.25, 0.22, 0.19, 0.16
];

export interface LayoutSample {
  constraint: number;
  height: number;
  /** Board left edge to the right edge of the rightmost tile. */
  used: number;
}

/** Log distance treats proportional misses above and below a target equally. */
export function ratioDistance(ratio: number): number {
  if (!(ratio > 0)) {
    return Infinity;
  }
  return Math.min(...EXPORT_RATIOS.map(target => Math.abs(Math.log(ratio / target))));
}

/** Pads content by `SLACK` and enforces the narrowest target ratio. */
export function exportWidth(sample: LayoutSample): number {
  return Math.max(sample.used + SLACK, sample.height * NARROWEST);
}

/**
 * Measures progressively narrower widths and drops consecutive duplicate
 * layouts. The callback keeps this logic independent of the DOM.
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
 * Chooses a candidate by target precedence, then proximity. With no target hit,
 * uses the closest candidate overall.
 */
export function bestLayout(samples: readonly LayoutSample[]): LayoutSample | null {
  const ratioOf = (sample: LayoutSample): number => exportWidth(sample) / sample.height;
  const nearest = (target: number | null): LayoutSample | null => {
    let best: LayoutSample | null = null;
    let bestDistance = Infinity;
    for (const sample of samples) {
      const ratio = ratioOf(sample);
      const distance = target === null ? ratioDistance(ratio) : Math.abs(Math.log(ratio / target));
      // A strict comparison preserves the earlier, wider candidate on ties.
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

/** Returns the export width from a device-independent measurement sweep. */
export function fitWidth(measureAt: (width: number) => LayoutSample): number | null {
  const best = bestLayout(sampleLayouts(measureAt(WIDEST), measureAt));
  if (!best) {
    return null;
  }
  // Re-measure because the chosen constraint can exceed the tiles' used width.
  return Math.round(exportWidth(measureAt(best.constraint)));
}

/** Fits a board for export and returns a function that restores its width. */
export function fitBoardForExport(board: HTMLElement): () => void {
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

  const width = fitWidth(sampleAt);
  if (width === null) {
    restore();
    return restore;
  }
  style.width = `${width}px`;
  return restore;
}
