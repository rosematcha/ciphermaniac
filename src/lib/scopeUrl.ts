import { ONLINE_META_NAME, resolveScopeSlug, scopeSlug } from '../../shared/data/tournamentKeys';

export interface InitialScope {
  key: string;
  removeInvalidParam: boolean;
}

export function resolveInitialScope(
  urlSlug: string | undefined,
  storedKey: string | null,
  publishedKeys: readonly string[]
): InitialScope {
  const fromUrl = urlSlug ? resolveScopeSlug(urlSlug, publishedKeys) : null;
  if (fromUrl) {
    return { key: fromUrl, removeInvalidParam: false };
  }
  const fromStorage = storedKey && publishedKeys.includes(storedKey) ? storedKey : ONLINE_META_NAME;
  return { key: fromStorage, removeInvalidParam: Boolean(urlSlug) };
}

export function isScopeAwarePath(pathname: string): boolean {
  return (
    pathname === '/' ||
    pathname === '/cards' ||
    pathname.startsWith('/cards/') ||
    pathname === '/archetypes' ||
    pathname.startsWith('/archetypes/') ||
    pathname === '/tournaments'
  );
}

export function scopeParam(key: string): string | undefined {
  if (key === ONLINE_META_NAME || key.startsWith('snapshot:')) {
    return undefined;
  }
  return scopeSlug(key);
}

export function writeScopeParam(params: URLSearchParams, key: string): void {
  const value = scopeParam(key);
  if (value) {
    params.set('scope', value);
  } else {
    params.delete('scope');
  }
}
