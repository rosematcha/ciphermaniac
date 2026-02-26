import { handleLoaderFailure } from './fallback.js';

import('../card.js').catch(error => {
  handleLoaderFailure('Card details page', error);
});
