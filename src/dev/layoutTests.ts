// Quick layout invariants tests, run optionally in tests.html or console
import { AppError, ErrorTypes } from '../utils/errorHandler.js';
import { computeLayout } from '../layoutHelper.js';

/**
 *
 */
export function runLayoutSmoke(): boolean {
  const widths = [0, 200, 320, 480, 600, 900, 1200];
  for (const width of widths) {
    const metrics = computeLayout(width);
    if (metrics.perRowBig < 1) {
      throw new AppError(ErrorTypes.RENDER, `perRowBig < 1 for width ${width}`);
    }
    if (metrics.base < 100 || metrics.base > 200) {
      throw new AppError(ErrorTypes.RENDER, `base out of expected bounds for width ${width}: ${metrics.base}`);
    }
    // Ensure small rows do not exceed big row width when using computed scale
    const smallTotal = metrics.targetSmall * metrics.base + Math.max(0, metrics.targetSmall - 1) * metrics.gap;
    if (Math.round(smallTotal) > Math.round(metrics.bigRowContentWidth) + 1) {
      throw new AppError(ErrorTypes.RENDER, `small row width exceeds big row width for ${width}`);
    }
  }
  return true;
}
