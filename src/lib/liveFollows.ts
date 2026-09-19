import { type Accessor, createSignal } from 'solid-js';

const STORAGE_KEY = 'cm-live-follows';
const VOTER_KEY = 'cm-live-voter';

/** Stored follows, or none for anything that is not a list of seat keys. */
export function parseStoredFollows(raw: string | null): string[] {
  try {
    const stored: unknown = JSON.parse(raw ?? '[]');
    return Array.isArray(stored) ? stored.filter((key): key is string => typeof key === 'string') : [];
  } catch {
    return [];
  }
}

export function toggled(follows: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(follows);
  if (!next.delete(key)) {
    next.add(key);
  }
  return next;
}

function readStored(): string[] {
  try {
    return parseStoredFollows(localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

const [follows, setFollows] = createSignal<ReadonlySet<string>>(new Set(readStored()));

/**
 * Players followed on this device, by seat key (`shared/live/view.ts`). Kept by
 * name rather than by event, so a follow carries over to the next event.
 */
export function useLiveFollows(): { follows: Accessor<ReadonlySet<string>>; toggle: (key: string) => void } {
  return {
    follows,
    toggle: key => {
      const next = setFollows(current => toggled(current, key));
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        /* storage unavailable */
      }
    }
  };
}

/**
 * This device's reporter ID for deck reports: random, minted on first use, and
 * tied to nothing. Without storage every report gets a fresh one.
 */
export function liveVoterId(): string {
  try {
    const stored = localStorage.getItem(VOTER_KEY);
    if (stored) {
      return stored;
    }
    const minted = crypto.randomUUID();
    localStorage.setItem(VOTER_KEY, minted);
    return minted;
  } catch {
    return crypto.randomUUID();
  }
}
