import { logger } from '../utils/logger.js';

import('../card.js').catch(error => {
  logger.exception('Failed to load card page module', error);
});
