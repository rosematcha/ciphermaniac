import { logger } from '../utils/logger.js';

import('../archetype.js').catch(error => {
  logger.exception('Failed to load archetype page module', error);
});
