import { useLocation, useNavigate } from '@solidjs/router';
import {
  type Accessor,
  createContext,
  createEffect,
  createResource,
  createSignal,
  type ParentComponent,
  untrack,
  useContext
} from 'solid-js';
import { ONLINE_META_NAME } from './constants';
import { fetchTournamentsList } from './data/reports';
import { isScopeAwarePath, resolveInitialScope, scopeParam, writeScopeParam } from './scopeUrl';

interface TournamentContextValue {
  /** Currently-selected tournament key (e.g. `"Online - Last 14 Days"`). */
  tournament: Accessor<string>;
  /** Switch the active tournament. Persists to localStorage. */
  setTournament: (key: string, options?: { history?: 'push' | 'replace' }) => void;
}

const TournamentContext = createContext<TournamentContextValue>();

const STORAGE_KEY = 'cm:tournament';

function readStored(): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

function persist(key: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, key);
  } catch {
    /* localStorage unavailable */
  }
}

/**
 * Global tournament context. Defaults to the rolling Online meta but can be
 * switched to any historical tournament via the topnav selector.
 */
export const TournamentProvider: ParentComponent = props => {
  const location = useLocation();
  const navigate = useNavigate();
  const storedAtMount = readStored();
  const [tournament, setTournamentSig] = createSignal(storedAtMount ?? ONLINE_META_NAME);
  const [ready, setReady] = createSignal(false);
  const [tournaments] = createResource(async () => {
    try {
      return await fetchTournamentsList();
    } catch {
      return [ONLINE_META_NAME];
    }
  });
  let previousPath = location.pathname;
  let initialized = false;
  let allowedFreshKey: string | undefined;

  function replaceUrl(key: string, removeTour = false): void {
    if (!isScopeAwarePath(location.pathname)) {
      return;
    }
    const params = new URLSearchParams(location.search);
    writeScopeParam(params, key);
    if (removeTour) {
      params.delete('tour');
    }
    const search = params.toString();
    const target = `${location.pathname}${search ? `?${search}` : ''}${location.hash}`;
    if (target !== `${location.pathname}${location.search}${location.hash}`) {
      navigate(target, { replace: true });
    }
  }

  function adopt(key: string): void {
    setTournamentSig(key);
    persist(key);
  }

  createEffect(() => {
    const keys = tournaments();
    if (!keys) {
      return;
    }
    const params = new URLSearchParams(location.search);
    const legacyTour = location.pathname.startsWith('/archetypes/') ? params.get('tour')?.trim() : undefined;
    if (legacyTour) {
      allowedFreshKey = legacyTour;
      adopt(legacyTour);
      replaceUrl(legacyTour, true);
      initialized = true;
      setReady(true);
      previousPath = location.pathname;
      return;
    }
    const slug = isScopeAwarePath(location.pathname) ? (params.get('scope') ?? undefined) : undefined;
    if (!initialized) {
      const initial = resolveInitialScope(slug, storedAtMount, keys);
      adopt(initial.key);
      replaceUrl(initial.key);
      initialized = true;
      setReady(true);
    } else if (slug) {
      if (allowedFreshKey && scopeParam(allowedFreshKey) === slug) {
        adopt(allowedFreshKey);
        previousPath = location.pathname;
        return;
      }
      const resolved = resolveInitialScope(slug, untrack(tournament), keys);
      adopt(resolved.key);
      replaceUrl(resolved.key);
    } else if (location.pathname === previousPath) {
      adopt(ONLINE_META_NAME);
    } else {
      replaceUrl(untrack(tournament));
    }
    previousPath = location.pathname;
  });

  const setTournament = (key: string, options?: { history?: 'push' | 'replace' }) => {
    const keys = tournaments();
    allowedFreshKey = keys?.includes(key) === false ? key : undefined;
    adopt(key);
    if (!isScopeAwarePath(location.pathname)) {
      return;
    }
    const params = new URLSearchParams(location.search);
    writeScopeParam(params, key);
    params.delete('tour');
    const search = params.toString();
    const target = `${location.pathname}${search ? `?${search}` : ''}${location.hash}`;
    navigate(target, { replace: options?.history !== 'push' });
  };

  return (
    <TournamentContext.Provider value={{ tournament, setTournament }}>
      {ready() ? props.children : null}
    </TournamentContext.Provider>
  );
};

/**
 * Hook accessor for the tournament context. Throws if used outside a provider.
 */
export function useTournament(): TournamentContextValue {
  const ctx = useContext(TournamentContext);
  if (!ctx) {
    throw new Error('useTournament must be used inside <TournamentProvider>');
  }
  return ctx;
}
