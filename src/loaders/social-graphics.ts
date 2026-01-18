import { logger } from '../utils/logger.js';

import('../social-graphics.js').catch(error => {
  logger.exception('Failed to load social graphics module', error);
});
