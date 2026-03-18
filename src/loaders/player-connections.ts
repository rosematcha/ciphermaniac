import { handleLoaderFailure } from './fallback.js';

import('../player-connections.js').catch(error => {
  handleLoaderFailure('Player connections tool', error);
});
