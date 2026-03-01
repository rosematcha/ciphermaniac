import { handleLoaderFailure } from './fallback.js';

import('../player.js').catch(error => {
  handleLoaderFailure('Player page', error);
});
