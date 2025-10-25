const PANEL_SELECTOR = '#filters';
const TOGGLE_SELECTOR = '#filtersToggle';
const DEFAULT_FOCUS_SELECTOR = 'select, input, button, textarea, [tabindex]:not([tabindex="-1"])';

function getElements() {
  /** @type {HTMLElement|null} */
  const panel = document.querySelector(PANEL_SELECTOR);
  /** @type {HTMLElement|null} */
  const toggle = document.querySelector(TOGGLE_SELECTOR);
  return { panel, toggle };
}

function applyPanelState({ panel, toggle }, isOpen) {
  if (panel) {
    panel.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    panel.classList?.toggle('is-open', isOpen);
  }

  if (toggle) {
    toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    toggle.classList?.toggle('is-active', isOpen);
  }

  document.body?.classList?.toggle('filters-panel-open', isOpen);
}

function focusFirstControlElement(panel, focusSelector) {
  if (!panel) {return;}
  const focusable = panel.querySelector(focusSelector);
  if (focusable && typeof focusable.focus === 'function') {
    focusable.focus();
  }
}

function shouldHandle(ownerAttr, owner) {
  if (!ownerAttr) {return true;}
  if (!owner) {return ownerAttr === 'ui';}
  return ownerAttr === owner;
}

/**
 * Open the filters panel and optionally focus the first focusable control.
 * @param {object} [options]
 * @param {boolean} [options.focusFirstControl]
 * @param {string} [options.focusSelector]
 * @returns {'opened'|'noop'}
 */
export function openFiltersPanel({
  focusFirstControl = false,
  focusSelector = DEFAULT_FOCUS_SELECTOR
} = {}) {
  const { panel, toggle } = getElements();
  if (!panel) {return 'noop';}

  if (panel.getAttribute('aria-hidden') === 'false') {
    return 'noop';
  }

  applyPanelState({ panel, toggle }, true);

  if (focusFirstControl) {
    focusFirstControlElement(panel, focusSelector);
  }

  return 'opened';
}

/**
 * Close the filters panel and optionally restore focus to the toggle button.
 * @param {object} [options]
 * @param {boolean} [options.restoreFocus]
 * @returns {'closed'|'noop'}
 */
export function closeFiltersPanel({ restoreFocus = false } = {}) {
  const { panel, toggle } = getElements();
  if (!panel) {return 'noop';}

  if (panel.getAttribute('aria-hidden') === 'true') {
    return 'noop';
  }

  applyPanelState({ panel, toggle }, false);

  if (restoreFocus && toggle && typeof toggle.focus === 'function') {
    toggle.focus();
  }

  return 'closed';
}

/**
 * Toggle the filters panel open or closed.
 * @param {object} [options]
 * @param {boolean} [options.focusFirstControlOnOpen]
 * @param {string} [options.focusSelector]
 * @param {boolean} [options.restoreFocusOnClose]
 * @returns {'opened'|'closed'|'noop'}
 */
export function toggleFiltersPanel({
  focusFirstControlOnOpen = false,
  focusSelector = DEFAULT_FOCUS_SELECTOR,
  restoreFocusOnClose = false
} = {}) {
  const { panel } = getElements();
  if (!panel) {return 'noop';}

  const isOpen = panel.getAttribute('aria-hidden') === 'false';
  if (isOpen) {
    return closeFiltersPanel({ restoreFocus: restoreFocusOnClose });
  }

  return openFiltersPanel({
    focusFirstControl: focusFirstControlOnOpen,
    focusSelector
  });
}

/**
 * Initialize the filters toggle button interactions.
 * @param {object} [options]
 * @param {string} [options.owner]
 * @param {boolean} [options.focusFirstControlOnOpen]
 * @param {boolean} [options.restoreFocusOnClose]
 * @param {string} [options.focusSelector]
 * @returns {void}
 */
export function initFiltersToggle({
  owner = 'ui',
  focusFirstControlOnOpen = true,
  restoreFocusOnClose = true,
  focusSelector = DEFAULT_FOCUS_SELECTOR
} = {}) {
  const { panel, toggle } = getElements();
  if (!panel || !toggle) {return;}

  const configuredOwner = toggle.dataset?.cmFiltersOwner || panel.dataset?.cmFiltersOwner;
  if (!shouldHandle(configuredOwner, owner)) {return;}

  const isSmallScreen = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 899px)').matches;

  if (!panel.hasAttribute('aria-hidden') && isSmallScreen) {
    applyPanelState({ panel, toggle }, false);
  } else if (!isSmallScreen) {
    panel.setAttribute('aria-hidden', 'false');
    panel.classList?.add('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.classList?.remove('is-active');
    document.body?.classList?.remove('filters-panel-open');
  }

  toggle.addEventListener('click', () => {
    toggleFiltersPanel({
      focusFirstControlOnOpen,
      focusSelector,
      restoreFocusOnClose
    });
  });

  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closeFiltersPanel({ restoreFocus: restoreFocusOnClose });
    }
  });
}
