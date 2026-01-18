import { logger } from '../utils/logger.js';

import('../archetypeHome.js').catch(error => {
  logger.exception('Failed to load archetype home module', error);
});
