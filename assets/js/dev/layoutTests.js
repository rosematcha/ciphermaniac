// Quick layout invariants tests, run optionally in tests.html or console
import { computeLayout } from '../layoutHelper.js';

/**
 *
 */
export function runLayoutSmoke() {
  const widths = [0, 200, 320, 480, 600, 900, 1200];
  for (const w of widths) {
    const m = computeLayout(w);
    if (m.perRowBig < 1) {throw new Error(`perRowBig < 1 for width ${w}`);}
    if (m.base < 100 || m.base > 200) {throw new Error(`base out of expected bounds for width ${w}: ${m.base}`);}
    // Ensure small rows do not exceed big row width when using computed scale
    const smallTotal = m.targetSmall * m.base + Math.max(0, m.targetSmall - 1) * m.gap;
    if (Math.round(smallTotal) > Math.round(m.bigRowContentWidth) + 1) {
      throw new Error(`small row width exceeds big row width for ${w}`);
    }
  }
  return true;
}
