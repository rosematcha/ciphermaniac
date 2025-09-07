// Wires up the mobile filters toggle button
export function initFiltersToggle() {
  const btn = document.getElementById('filtersToggle');
  const panel = document.getElementById('filters');
  if (!btn || !panel) {return;}
  // initialize hidden state on small screens; on desktop CSS shows filters regardless
  const isSmall = window.matchMedia('(max-width: 899px)').matches;
  if (!panel.hasAttribute('aria-hidden') && isSmall) {
    panel.setAttribute('aria-hidden', 'true');
  } else if (!isSmall) {
    // Ensure ARIA matches visible state on desktop
    panel.setAttribute('aria-hidden', 'false');
    btn.setAttribute('aria-expanded', 'false');
  }
  const openPanel = () => {
    btn.setAttribute('aria-expanded', 'true');
    panel.setAttribute('aria-hidden', 'false');
    // Move focus to first control inside panel for accessibility
    const focusable = panel.querySelector('select, input, button');
    if (focusable) {focusable.focus();}
  };
  const closePanel = () => {
    btn.setAttribute('aria-expanded', 'false');
    panel.setAttribute('aria-hidden', 'true');
    btn.focus();
  };
  btn.addEventListener('click', () => {
    const expanded = btn.getAttribute('aria-expanded') === 'true';
    if (expanded) { closePanel(); } else { openPanel(); }
  });
  // Close on Escape when focus is within the panel
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closePanel();
    }
  });
}

// Auto-init when module loads (scripts are at end of body)
initFiltersToggle();
