import { logger } from '../utils/logger.js';

import('../tools/metaBinder.js').catch(error => {
  logger.exception('Failed to load meta binder module', error);
});
