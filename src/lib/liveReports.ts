import { type Accessor, createSignal } from 'solid-js';

const STORAGE_KEY = 'cm-live-reports';

/** Stored reports, or none for anything that is not a map of strings. */
export function parseStoredReports(raw: string | null): Record<string, string> {
  try {
    const stored: unknown = JSON.parse(raw ?? '{}');
    if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) {
      return {};
    }
    return Object.fromEntries(Object.entries(stored).filter(([, label]) => typeof label === 'string')) as Record<
      string,
      string
    >;
  } catch {
    return {};
  }
}

export const reportKey = (slug: string, seat: string): string => `${slug}|${seat}`;

function readStored(): Record<string, string> {
  try {
    return parseStoredReports(localStorage.getItem(STORAGE_KEY));
  } catch {
    return {};
  }
}

const [mine, setMine] = createSignal<Record<string, string>>(readStored());

/**
 * The deck reports made from this device, by `reportKey`. The server only ever
 * publishes the archetype a seat's reports settle on, so this is how a reporter
 * sees, changes, or takes back their own.
 */
export function useMyReports(): {
  mine: Accessor<Record<string, string>>;
  remember: (key: string, label: string | null) => void;
} {
  return {
    mine,
    remember: (key, label) => {
      const { [key]: _previous, ...rest } = mine();
      const next = setMine(label === null ? rest : { ...rest, [key]: label });
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
    }
  };
}
