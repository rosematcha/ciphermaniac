import { handleLoaderFailure } from './fallback.js';

import('../social-graphics.js').catch(error => {
  handleLoaderFailure('Social graphics tool', error);
});
