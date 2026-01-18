export function setupFilterCollapse(): void {
  const filtersLabel = document.querySelector('.archetype-filters-label');
  const filtersContainer = document.querySelector('.archetype-filters');

  if (!filtersLabel || !filtersContainer) {
    return;
  }

  filtersLabel.addEventListener('click', () => {
    filtersContainer.classList.toggle('collapsed');
  });
}

export function setupControlsToggle(): void {
  const toggleBtn = document.getElementById('controls-toggle');
  const body = document.getElementById('controls-body');

  if (!toggleBtn || !body) {
    return;
  }

  toggleBtn.setAttribute('aria-controls', 'controls-body');

  toggleBtn.addEventListener('click', () => {
    const isExpanded = toggleBtn.getAttribute('aria-expanded') === 'true';
    toggleBtn.setAttribute('aria-expanded', String(!isExpanded));
    body.hidden = isExpanded;
  });
}
