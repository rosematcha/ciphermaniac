const DEFAULT_SET_SELECT_ID = 'set-filter';
const DEFAULT_SET_HIDDEN_ID = 'set-filter-data';
const DEFAULT_CARD_TYPE_SELECT_ID = 'card-type';
const DEFAULT_CARD_TYPE_HIDDEN_ID = 'card-type-filter-data';
const ALL_CARD_TYPES = '__all__';

/**
 * Normalize a set code string into uppercase trimmed form.
 * @param value
 * @returns
 */
export function normalizeSetCode(value: unknown): string {
  return String(value || '')
    .trim()
    .toUpperCase();
}

/**
 * Read selected set codes from a multi-select element.
 * @param selectEl
 * @returns
 */
function readSelectedSetsFromSelect(selectEl: HTMLSelectElement | null): string[] {
  if (!(selectEl instanceof HTMLSelectElement)) {
    return [];
  }

  return Array.from(selectEl.selectedOptions)
    .map(option => normalizeSetCode(option.value))
    .filter(Boolean);
}

/**
 * Read selected set codes from a hidden comma-delimited input.
 * @param hiddenInput
 * @returns
 */
function readSelectedSetsFromHidden(hiddenInput: HTMLInputElement | null): string[] {
  if (!hiddenInput || typeof hiddenInput.value !== 'string' || !hiddenInput.value) {
    return [];
  }

  return hiddenInput.value
    .split(',')
    .map(value => normalizeSetCode(value))
    .filter(Boolean);
}

interface ReadSelectedSetsOptions {
  selectId?: string;
  hiddenId?: string;
}

/**
 * Resolve currently selected sets from the DOM.
 * @param options
 * @param options.selectId
 * @param options.hiddenId
 * @returns
 */
export function readSelectedSets({
  selectId = DEFAULT_SET_SELECT_ID,
  hiddenId = DEFAULT_SET_HIDDEN_ID
}: ReadSelectedSetsOptions = {}): string[] {
  const selectEl = document.getElementById(selectId) as HTMLSelectElement | null;
  const hiddenInput = document.getElementById(hiddenId) as HTMLInputElement | null;

  const fromSelect = readSelectedSetsFromSelect(selectEl);
  if (fromSelect.length > 0) {
    return fromSelect;
  }

  return readSelectedSetsFromHidden(hiddenInput);
}

interface ReadCardTypeOptions {
  selectId?: string;
}

/**
 * Resolve the card type filter value.
 * @param options
 * @param options.selectId
 * @returns
 */
export function readCardType({ selectId = DEFAULT_CARD_TYPE_SELECT_ID }: ReadCardTypeOptions = {}): string {
  const selectEl = document.getElementById(selectId) as HTMLSelectElement | null;
  if (!(selectEl instanceof HTMLSelectElement)) {
    return ALL_CARD_TYPES;
  }

  return selectEl.value || ALL_CARD_TYPES;
}

/**
 * Normalize an arbitrary selection into sanitized set codes.
 * @param selection
 * @returns
 */
export function normalizeSetValues(selection: unknown): string[] {
  if (!Array.isArray(selection)) {
    return [];
  }
  return selection.map(normalizeSetCode).filter(Boolean);
}

/**
 * Parse a comma-delimited list of set codes.
 * @param value
 * @returns
 */
export function parseSetList(value: unknown): string[] {
  if (!value || typeof value !== 'string') {
    return [];
  }
  return value.split(',').map(normalizeSetCode).filter(Boolean);
}

interface WriteSelectedSetsOptions {
  hiddenId?: string;
}

/**
 * Persist the selected set codes into the hidden input.
 * @param selected
 * @param options
 * @param options.hiddenId
 * @returns
 */
export function writeSelectedSets(
  selected: unknown,
  { hiddenId = DEFAULT_SET_HIDDEN_ID }: WriteSelectedSetsOptions = {}
): void {
  const hiddenInput = document.getElementById(hiddenId) as HTMLInputElement | null;
  if (!hiddenInput) {
    return;
  }

  const values = Array.isArray(selected) ? selected : [];
  hiddenInput.value = values.join(',');
}

/**
 * Normalize a card type filter value
 * @param value
 * @returns
 */
export function normalizeCardTypeValue(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase();
}

/**
 * Read selected card types from a hidden comma-delimited input.
 * @param hiddenInput
 * @returns
 */
function readCardTypesFromHidden(hiddenInput: HTMLInputElement | null): string[] {
  if (!hiddenInput || typeof hiddenInput.value !== 'string' || !hiddenInput.value) {
    return [];
  }

  return hiddenInput.value
    .split(',')
    .map(value => normalizeCardTypeValue(value))
    .filter(Boolean);
}

interface ReadSelectedCardTypesOptions {
  hiddenId?: string;
}

/**
 * Resolve currently selected card types from the DOM (for multi-select).
 * @param options
 * @param options.hiddenId
 * @returns Array of selected card type filters (e.g., ['pokemon:basic', 'trainer:supporter'])
 */
export function readSelectedCardTypes({
  hiddenId = DEFAULT_CARD_TYPE_HIDDEN_ID
}: ReadSelectedCardTypesOptions = {}): string[] {
  const hiddenInput = document.getElementById(hiddenId) as HTMLInputElement | null;
  return readCardTypesFromHidden(hiddenInput);
}

/**
 * Normalize an arbitrary selection into sanitized card type values.
 * @param selection
 * @returns
 */
export function normalizeCardTypeValues(selection: unknown): string[] {
  if (!Array.isArray(selection)) {
    return [];
  }
  return selection.map(normalizeCardTypeValue).filter(Boolean);
}

/**
 * Parse a comma-delimited list of card type filters.
 * @param value
 * @returns
 */
export function parseCardTypeList(value: unknown): string[] {
  if (!value || typeof value !== 'string') {
    return [];
  }
  return value.split(',').map(normalizeCardTypeValue).filter(Boolean);
}

interface WriteSelectedCardTypesOptions {
  hiddenId?: string;
}

/**
 * Persist the selected card type filters into the hidden input.
 * @param selected
 * @param options
 * @param options.hiddenId
 * @returns
 */
export function writeSelectedCardTypes(
  selected: unknown,
  { hiddenId = DEFAULT_CARD_TYPE_HIDDEN_ID }: WriteSelectedCardTypesOptions = {}
): void {
  const hiddenInput = document.getElementById(hiddenId) as HTMLInputElement | null;
  if (!hiddenInput) {
    return;
  }

  const values = Array.isArray(selected) ? selected : [];
  hiddenInput.value = values.join(',');
}
