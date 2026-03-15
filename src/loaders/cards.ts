import { handleLoaderFailure } from './fallback.js';

import('../main.js').catch(error => {
  handleLoaderFailure('Cards page', error);
});
