import { handleLoaderFailure } from './fallback.js';

import('../archetypeHome.js').catch(error => {
  handleLoaderFailure('Archetype overview', error);
});
