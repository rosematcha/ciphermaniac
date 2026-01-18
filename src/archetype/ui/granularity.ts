import { GRANULARITY_DEFAULT_PERCENT, GRANULARITY_MIN_PERCENT, GRANULARITY_STEP_PERCENT } from '../constants.js';
import { getUsagePercent } from '../cardCategories.js';
import { normalizeThreshold } from '../filters/utils.js';
import { getState } from '../state.js';
import { elements } from './elements.js';
import { renderCardsWithThreshold } from './render.js';

export function syncGranularityOutput(threshold: number): void {
  const safeValue = Number.isFinite(threshold) ? Math.max(GRANULARITY_MIN_PERCENT, threshold) : GRANULARITY_MIN_PERCENT;
  const step = elements.granularityRange
    ? Math.max(1, Number((elements.granularityRange as HTMLInputElement).step) || GRANULARITY_STEP_PERCENT)
    : 1;
  const roundedValue = Math.round(safeValue / step) * step;
  const clampedValue = Math.max(GRANULARITY_MIN_PERCENT, roundedValue);
  const value = `${Math.round(clampedValue)}%`;
  if (elements.granularityRange) {
    elements.granularityRange.value = String(Math.round(clampedValue));
  }
  if (elements.granularityOutput) {
    elements.granularityOutput.textContent = value;
  }
}

export function configureGranularity(items: ReturnType<typeof getState>['items']): void {
  const state = getState();
  const range = elements.granularityRange;
  if (!range || items.length === 0) {
    state.thresholdPercent = GRANULARITY_MIN_PERCENT;
    syncGranularityOutput(GRANULARITY_MIN_PERCENT);
    return;
  }

  const percents = items.map(getUsagePercent);
  const computedMax = Math.max(...percents, GRANULARITY_MIN_PERCENT);

  const minValue = GRANULARITY_MIN_PERCENT;
  const maxValue = Math.min(100, Math.ceil(computedMax / GRANULARITY_STEP_PERCENT) * GRANULARITY_STEP_PERCENT);
  range.min = String(minValue);
  range.max = String(maxValue);
  range.step = String(GRANULARITY_STEP_PERCENT);

  const desired =
    typeof state.thresholdPercent === 'number' && Number.isFinite(state.thresholdPercent)
      ? state.thresholdPercent
      : GRANULARITY_DEFAULT_PERCENT;
  const normalized = normalizeThreshold(desired, minValue, maxValue);
  state.thresholdPercent = normalized;

  syncGranularityOutput(normalized);
}

export function handleGranularityInput(event: Event): void {
  const state = getState();
  const target = (event.currentTarget || event.target) as HTMLInputElement | null;
  if (!target || !Array.isArray(state.items) || state.items.length === 0) {
    return;
  }

  const percents = state.items.map(getUsagePercent);
  const computedMax = Math.max(...percents, GRANULARITY_MIN_PERCENT);

  if (computedMax <= GRANULARITY_STEP_PERCENT) {
    state.thresholdPercent = computedMax;
    syncGranularityOutput(computedMax);
    renderCardsWithThreshold(computedMax);
    return;
  }

  const rawValue = Number(target.value);
  const maxPercent = Math.min(100, Math.ceil(computedMax / GRANULARITY_STEP_PERCENT) * GRANULARITY_STEP_PERCENT);
  const normalized = normalizeThreshold(rawValue, GRANULARITY_MIN_PERCENT, maxPercent);
  state.thresholdPercent = normalized;
  syncGranularityOutput(normalized);
  renderCardsWithThreshold(normalized);
}

export function setupGranularityListeners(): void {
  const range = elements.granularityRange;
  if (!range) {
    return;
  }
  range.addEventListener('input', handleGranularityInput);
}
