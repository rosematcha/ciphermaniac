import { resolveScopePath } from '../../../shared/data/build/release.js';
import { EMBEDDED_RELEASE } from '../../../shared/generated/release.js';

/** R2 key of the online-meta archetype index the deployed site is reading. */
export const ARCHETYPE_INDEX_KEY = EMBEDDED_RELEASE
  ? resolveScopePath(EMBEDDED_RELEASE, 'online', 'archetypes/index.json').replace(/^\/+/, '')
  : 'reports/Online - Last 14 Days/archetypes/index.json';
