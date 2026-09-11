import { mergeConfig } from 'vite';
import base from '../../vite.config';
import { fixtureRelease } from './release-fixture';

export default mergeConfig(base, {
  plugins: [
    {
      name: 'embedded-release-fixture',
      enforce: 'pre',
      load(id: string) {
        if (id.endsWith('/shared/generated/release.ts')) {
          return `export const EMBEDDED_RELEASE = ${JSON.stringify(fixtureRelease)};`;
        }
        return null;
      }
    }
  ]
});
