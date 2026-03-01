import { handleLoaderFailure } from './fallback.js';

import('../feedback.js').catch(error => {
  handleLoaderFailure('Feedback page', error);
});
