import { logger } from '../utils/logger.js';

import('../archetype-analysis.js').catch(error => {
  logger.exception('Failed to load archetypes module', error);
});
