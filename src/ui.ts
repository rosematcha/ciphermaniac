import { initFiltersToggle } from './utils/filtersPanel.js';

// Auto-init for pages that use the 'ui' owner (not 'main' which is handled by main.ts)
// This provides filter toggle functionality for pages that don't have main.ts loaded
// Note: buildVersion is NOT imported here to keep this module lightweight
initFiltersToggle({
  // Only handle filters with owner='ui' (default), skip owner='main' handled by main.ts
  owner: 'ui',
  focusFirstControlOnOpen: true,
  restoreFocusOnClose: true
});
