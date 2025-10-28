import './utils/buildVersion.js';
import { initFiltersToggle } from './utils/filtersPanel.js';

// Auto-init when module loads (scripts are at end of body)
initFiltersToggle({
  owner: 'ui',
  focusFirstControlOnOpen: true,
  restoreFocusOnClose: true
});
