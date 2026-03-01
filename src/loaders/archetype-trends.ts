import { handleLoaderFailure } from './fallback.js';

import('../archetypeTrends.js').catch(error => {
  handleLoaderFailure('Archetype trends', error);
});
