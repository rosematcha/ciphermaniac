import { handleLoaderFailure } from './fallback.js';

import('../players.js').catch(error => {
  handleLoaderFailure('Players page', error);
});
