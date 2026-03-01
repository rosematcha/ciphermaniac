import { handleLoaderFailure } from './fallback.js';

import('../trends.js').catch(error => {
  handleLoaderFailure('Trends page', error);
});
