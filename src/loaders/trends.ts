import { handleLoaderFailure } from './fallback.js';

import('../trends/index.js').catch(error => {
  handleLoaderFailure('Trends page', error);
});
