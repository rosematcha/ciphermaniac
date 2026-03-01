import { handleLoaderFailure } from './fallback.js';

import('../archetype-analysis.js').catch(error => {
  handleLoaderFailure('Archetypes list', error);
});
