import { handleLoaderFailure } from './fallback.js';

import('../in-loving-memory.js').catch(error => {
  handleLoaderFailure('In Loving Memory', error);
});
