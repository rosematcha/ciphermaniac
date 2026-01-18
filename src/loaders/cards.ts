import { logger } from '../utils/logger.js';

Promise.all([import('../main.js'), import('../ui.js')]).catch(error => {
  logger.exception('Failed to load cards page modules', error);
});
