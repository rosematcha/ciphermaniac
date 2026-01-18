import { logger } from '../utils/logger.js';

import('../feedback.js').catch(error => {
  logger.exception('Failed to load feedback module', error);
});
