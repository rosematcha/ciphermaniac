import { handleLoaderFailure } from './fallback.js';

import('../tools/metaBinder.js').catch(error => {
  handleLoaderFailure('Meta Binder tool', error);
});
