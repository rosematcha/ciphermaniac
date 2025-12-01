const DEFAULT_SET_SELECT_ID = 'set-filter';
const DEFAULT_SET_HIDDEN_ID = 'set-filter-data';
const DEFAULT_CARD_TYPE_SELECT_ID = 'card-type';
const ALL_CARD_TYPES = '__all__';
/**
 * Normalize a set code string into uppercase trimmed form.
 * @param value
 * @returns
 */
export function normalizeSetCode(value) {
    return String(value || '')
        .trim()
        .toUpperCase();
}
/**
 * Read selected set codes from a multi-select element.
 * @param selectEl
 * @returns
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
 * @param hiddenInput
 * @returns
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
 * @param options
 * @returns
 */
export function readSelectedSets({ selectId = DEFAULT_SET_SELECT_ID, hiddenId = DEFAULT_SET_HIDDEN_ID } = {}) {
    const selectEl = document.getElementById(selectId);
    const hiddenInput = document.getElementById(hiddenId);
    const fromSelect = readSelectedSetsFromSelect(selectEl);
    if (fromSelect.length > 0) {
        return fromSelect;
    }
    return readSelectedSetsFromHidden(hiddenInput);
}
/**
 * Resolve the card type filter value.
 * @param options
 * @returns
 */
export function readCardType({ selectId = DEFAULT_CARD_TYPE_SELECT_ID } = {}) {
    const selectEl = document.getElementById(selectId);
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
export function normalizeSetValues(selection) {
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
export function parseSetList(value) {
    if (!value || typeof value !== 'string') {
        return [];
    }
    return value.split(',').map(normalizeSetCode).filter(Boolean);
}
/**
 * Persist the selected set codes into the hidden input.
 * @param selected
 * @param options
 * @returns
 */
export function writeSelectedSets(selected, { hiddenId = DEFAULT_SET_HIDDEN_ID } = {}) {
    const hiddenInput = document.getElementById(hiddenId);
    if (!hiddenInput) {
        return;
    }
    const values = Array.isArray(selected) ? selected : [];
    hiddenInput.value = values.join(',');
}
