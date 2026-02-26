import { handleLoaderFailure } from './fallback.js';

import('../archetype.js').catch(error => {
  handleLoaderFailure('Archetype analysis', error);
});
