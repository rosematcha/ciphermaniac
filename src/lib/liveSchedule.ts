import { type Accessor, createSignal } from 'solid-js';
import type { LiveSchedule } from '../../shared/live/types';
import { fetchLiveSchedule } from './data/live';

const STORAGE_KEY = 'cm-live-schedule';
/** Events are listed weeks ahead, so a stored schedule is good for hours. */
const REFRESH_MS = 6 * 60 * 60 * 1000;

interface StoredSchedule {
  fetchedAt: number;
  schedule: LiveSchedule;
}

/** A stored schedule, or null for anything that is not one. */
export function parseStoredSchedule(raw: string | null): StoredSchedule | null {
  try {
    const stored = JSON.parse(raw ?? 'null') as Partial<StoredSchedule> | null;
    return typeof stored?.fetchedAt === 'number' && Array.isArray(stored.schedule?.events)
      ? (stored as StoredSchedule)
      : null;
  } catch {
    return null;
  }
}

export function isStoredScheduleFresh(stored: StoredSchedule | null, now: number): boolean {
  return stored !== null && now - stored.fetchedAt < REFRESH_MS;
}

function readStored(): StoredSchedule | null {
  try {
    return parseStoredSchedule(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

const stored = readStored();
const [schedule, setSchedule] = createSignal<LiveSchedule | null>(stored?.schedule ?? null);
let requested = isStoredScheduleFresh(stored, Date.now());

async function refresh(): Promise<void> {
  const fetched = await fetchLiveSchedule().catch(() => null);
  if (!fetched) {
    return;
  }
  setSchedule(fetched);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ fetchedAt: Date.now(), schedule: fetched }));
  } catch {
    /* storage unavailable */
  }
}

/**
 * The live schedule, shared by every reader. It comes out of storage, so on a
 * return visit the banner is there at first paint and shifts nothing; the copy
 * is refreshed in the background once it is a few hours old.
 */
export function useLiveSchedule(): Accessor<LiveSchedule | null> {
  if (!requested) {
    requested = true;
    void refresh();
  }
  return schedule;
}
