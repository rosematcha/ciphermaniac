const DEFAULT_SET_SELECT_ID = 'set-filter';
const DEFAULT_SET_HIDDEN_ID = 'set-filter-data';
const DEFAULT_CARD_TYPE_SELECT_ID = 'card-type';
const ALL_CARD_TYPES = '__all__';

/**
 * Normalize a set code string into uppercase trimmed form.
 * @param {string} value
 * @returns {string}
 */
export function normalizeSetCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase();
}

/**
 * Read selected set codes from a multi-select element.
 * @param {HTMLSelectElement|null} selectEl
 * @returns {string[]}
 */
function readSelectedSetsFromSelect(selectEl) {
  if (!(selectEl instanceof HTMLSelectElement)) {
    return [];
  }

  return Array.from(selectEl.selectedOptions)
    .map(option => normalizeSetCode(option.value))
    .filter(Boolean);
}

/**
 * Read selected set codes from a hidden comma-delimited input.
 * @param {HTMLInputElement|null} hiddenInput
 * @returns {string[]}
 */
function readSelectedSetsFromHidden(hiddenInput) {
  if (!hiddenInput || typeof hiddenInput.value !== 'string' || !hiddenInput.value) {
    return [];
  }

  return hiddenInput.value
    .split(',')
    .map(value => normalizeSetCode(value))
    .filter(Boolean);
}

/**
 * Resolve currently selected sets from the DOM.
 * @param {{selectId?: string, hiddenId?: string}} [options]
 * @returns {string[]}
 */
export function readSelectedSets({ selectId = DEFAULT_SET_SELECT_ID, hiddenId = DEFAULT_SET_HIDDEN_ID } = {}) {
  const selectEl = /** @type {HTMLSelectElement|null} */ (document.getElementById(selectId));
  const hiddenInput = /** @type {HTMLInputElement|null} */ (document.getElementById(hiddenId));

  const fromSelect = readSelectedSetsFromSelect(selectEl);
  if (fromSelect.length > 0) {
    return fromSelect;
  }

  return readSelectedSetsFromHidden(hiddenInput);
}

/**
 * Resolve the card type filter value.
 * @param {{selectId?: string}} [options]
 * @returns {string}
 */
export function readCardType({ selectId = DEFAULT_CARD_TYPE_SELECT_ID } = {}) {
  const selectEl = /** @type {HTMLSelectElement|null} */ (document.getElementById(selectId));
  if (!(selectEl instanceof HTMLSelectElement)) {
    return ALL_CARD_TYPES;
  }

  return selectEl.value || ALL_CARD_TYPES;
}

/**
 * Normalize an arbitrary selection into sanitized set codes.
 * @param {unknown} selection
 * @returns {string[]}
 */
export function normalizeSetValues(selection) {
  if (!Array.isArray(selection)) {
    return [];
  }
  return selection.map(normalizeSetCode).filter(Boolean);
}

/**
 * Parse a comma-delimited list of set codes.
 * @param {unknown} value
 * @returns {string[]}
 */
export function parseSetList(value) {
  if (!value || typeof value !== 'string') {
    return [];
  }
  return value.split(',').map(normalizeSetCode).filter(Boolean);
}

/**
 * Persist the selected set codes into the hidden input.
 * @param {unknown} selected
 * @param {{hiddenId?: string}} [options]
 * @returns {void}
 */
export function writeSelectedSets(selected, { hiddenId = DEFAULT_SET_HIDDEN_ID } = {}) {
  const hiddenInput = /** @type {HTMLInputElement|null} */ (document.getElementById(hiddenId));
  if (!hiddenInput) {
    return;
  }

  const values = Array.isArray(selected) ? selected : [];
  hiddenInput.value = values.join(',');
}
