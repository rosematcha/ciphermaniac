import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ASSETS_SEGMENT = `${path.sep}assets${path.sep}js${path.sep}`;

/**
 * Ensure browser-targeted modules in assets/js are treated as ESM when running Node tests.
 */
export async function resolve(specifier, context, defaultResolve) {
  const resolved = await defaultResolve(specifier, context, defaultResolve);

  if (resolved.url.startsWith('file:')) {
    const filePath = path.normalize(fileURLToPath(resolved.url));
    if (filePath.includes(ASSETS_SEGMENT)) {
      return { ...resolved, format: 'module' };
    }
  }

  return resolved;
}

export async function load(url, context, defaultLoad) {
  return defaultLoad(url, context, defaultLoad);
}
