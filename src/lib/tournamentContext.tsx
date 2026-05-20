import { type Accessor, createContext, createSignal, type ParentComponent, useContext } from 'solid-js';
import { ONLINE_META_NAME } from './constants';

interface TournamentContextValue {
  /** Currently-selected tournament key (e.g. `"Online - Last 14 Days"`). */
  tournament: Accessor<string>;
  /** Switch the active tournament. Persists to localStorage. */
  setTournament: (key: string) => void;
}

const TournamentContext = createContext<TournamentContextValue>();

const STORAGE_KEY = 'cm:tournament';

function readStored(): string {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v && v.length > 0 ? v : ONLINE_META_NAME;
  } catch {
    return ONLINE_META_NAME;
  }
}

/**
 * Global tournament context. Defaults to the rolling Online meta but can be
 * switched to any historical tournament via the topnav selector.
 */
export const TournamentProvider: ParentComponent = props => {
  const [tournament, setTournamentSig] = createSignal(readStored());

  const setTournament = (key: string) => {
    setTournamentSig(key);
    try {
      localStorage.setItem(STORAGE_KEY, key);
    } catch {
      /* localStorage unavailable */
    }
  };

  return (
    <TournamentContext.Provider value={{ tournament, setTournament }}>{props.children}</TournamentContext.Provider>
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
