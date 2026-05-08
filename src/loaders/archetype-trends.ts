import { handleLoaderFailure } from './fallback.js';

import('../archetype-trends.js').catch(error => {
  handleLoaderFailure('Archetype trends', error);
});
