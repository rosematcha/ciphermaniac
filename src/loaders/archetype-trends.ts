import { logger } from '../utils/logger.js';

import('../archetypeTrends.js').catch(error => {
  logger.exception('Failed to load archetype trends module', error);
});
