import { logger } from '../utils/logger.js';

import('../trends.js').catch(error => {
  logger.exception('Failed to load trends module', error);
});
