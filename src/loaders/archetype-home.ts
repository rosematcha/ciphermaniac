import { handleLoaderFailure } from './fallback.js';

import('../archetype-home.js').catch(error => {
  handleLoaderFailure('Archetype overview', error);
});
