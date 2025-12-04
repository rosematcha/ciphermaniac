import './utils/buildVersion.js';
import { initFiltersToggle } from './utils/filtersPanel.js';

// Auto-init for pages that use the 'ui' owner (not 'main' which is handled by main.ts)
// This provides filter toggle functionality for pages that don't have main.ts loaded
initFiltersToggle({
    // Only handle filters with owner='ui' (default), skip owner='main' handled by main.ts
    owner: 'ui',
    focusFirstControlOnOpen: true,
    restoreFocusOnClose: true
});
