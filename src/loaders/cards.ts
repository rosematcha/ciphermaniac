import { handleLoaderFailure } from './fallback.js';

Promise.all([import('../main.js'), import('../ui.js')]).catch(error => {
  handleLoaderFailure('Cards page', error);
});
