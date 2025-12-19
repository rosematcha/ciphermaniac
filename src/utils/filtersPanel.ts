const PANEL_SELECTOR = '#filters';
const TOGGLE_SELECTOR = '#filtersToggle';
const DEFAULT_FOCUS_SELECTOR = 'select, input, button, textarea, [tabindex]:not([tabindex="-1"])';

interface Elements {
  panel: HTMLElement | null;
  toggle: HTMLElement | null;
}

function getElements(): Elements {
  const panel = document.querySelector<HTMLElement>(PANEL_SELECTOR);
  const toggle = document.querySelector<HTMLElement>(TOGGLE_SELECTOR);
  return { panel, toggle };
}

function applyPanelState({ panel, toggle }: Elements, isOpen: boolean): void {
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

function focusFirstControlElement(panel: HTMLElement | null, focusSelector: string): void {
  if (!panel) {
    return;
  }
  const focusable = panel.querySelector<HTMLElement>(focusSelector);
  if (focusable && typeof focusable.focus === 'function') {
    focusable.focus();
  }
}

function shouldHandle(ownerAttr: string | undefined, owner: string | undefined): boolean {
  if (!ownerAttr) {
    return true;
  }
  if (!owner) {
    return ownerAttr === 'ui';
  }
  return ownerAttr === owner;
}

interface OpenFiltersPanelOptions {
  focusFirstControl?: boolean;
  focusSelector?: string;
}

/**
 * Open the filters panel and optionally focus the first focusable control.
 * @param options
 * @param options.focusFirstControl
 * @param options.focusSelector
 * @returns
 */
export function openFiltersPanel({
  focusFirstControl = false,
  focusSelector = DEFAULT_FOCUS_SELECTOR
}: OpenFiltersPanelOptions = {}): 'opened' | 'noop' {
  const { panel, toggle } = getElements();
  if (!panel) {
    return 'noop';
  }

  if (panel.getAttribute('aria-hidden') === 'false') {
    return 'noop';
  }

  applyPanelState({ panel, toggle }, true);

  if (focusFirstControl) {
    focusFirstControlElement(panel, focusSelector);
  }

  return 'opened';
}

interface CloseFiltersPanelOptions {
  restoreFocus?: boolean;
}

/**
 * Close the filters panel and optionally restore focus to the toggle button.
 * @param options
 * @param options.restoreFocus
 * @returns
 */
export function closeFiltersPanel({ restoreFocus = false }: CloseFiltersPanelOptions = {}): 'closed' | 'noop' {
  const { panel, toggle } = getElements();
  if (!panel) {
    return 'noop';
  }

  if (panel.getAttribute('aria-hidden') === 'true') {
    return 'noop';
  }

  applyPanelState({ panel, toggle }, false);

  if (restoreFocus && toggle && typeof toggle.focus === 'function') {
    toggle.focus();
  }

  return 'closed';
}

interface ToggleFiltersPanelOptions {
  focusFirstControlOnOpen?: boolean;
  focusSelector?: string;
  restoreFocusOnClose?: boolean;
}

/**
 * Toggle the filters panel open or closed.
 * @param options
 * @param options.focusFirstControlOnOpen
 * @param options.focusSelector
 * @param options.restoreFocusOnClose
 * @returns
 */
export function toggleFiltersPanel({
  focusFirstControlOnOpen = false,
  focusSelector = DEFAULT_FOCUS_SELECTOR,
  restoreFocusOnClose = false
}: ToggleFiltersPanelOptions = {}): 'opened' | 'closed' | 'noop' {
  const { panel } = getElements();
  if (!panel) {
    return 'noop';
  }

  const isOpen = panel.getAttribute('aria-hidden') === 'false';
  if (isOpen) {
    return closeFiltersPanel({ restoreFocus: restoreFocusOnClose });
  }

  return openFiltersPanel({
    focusFirstControl: focusFirstControlOnOpen,
    focusSelector
  });
}

interface InitFiltersToggleOptions {
  owner?: string;
  focusFirstControlOnOpen?: boolean;
  restoreFocusOnClose?: boolean;
  focusSelector?: string;
}

/**
 * Initialize the filters toggle button interactions.
 * @param options
 * @param options.owner
 * @param options.focusFirstControlOnOpen
 * @param options.restoreFocusOnClose
 * @param options.focusSelector
 * @returns
 */
export function initFiltersToggle({
  owner = 'ui',
  focusFirstControlOnOpen = true,
  restoreFocusOnClose = true,
  focusSelector = DEFAULT_FOCUS_SELECTOR
}: InitFiltersToggleOptions = {}): void {
  const { panel, toggle } = getElements();
  if (!panel || !toggle) {
    return;
  }

  const configuredOwner = toggle.dataset?.cmFiltersOwner || panel.dataset?.cmFiltersOwner;
  if (!shouldHandle(configuredOwner, owner)) {
    return;
  }

  const isSmallScreen = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 899px)').matches;

  if (isSmallScreen) {
    // On mobile: start with filters collapsed (toggle to show)
    applyPanelState({ panel, toggle }, false);
  } else {
    // On desktop: start with filters expanded (visible by default)
    applyPanelState({ panel, toggle }, true);
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
