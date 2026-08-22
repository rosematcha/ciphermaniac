/**
 * The tournament-key format, and the pure functions that read it.
 *
 * A tournament key is `YYYY-MM-DD, Event Name` — it doubles as the R2 folder
 * name and as the identifier the UI passes around, so parsing it is a shared
 * concern rather than a display concern. The rolling online meta is the one key
 * that does not follow the format; every function here special-cases it.
 *
 * Lives in `shared` because the daily majors-trends pipeline classifies and
 * dates events exactly the way the selector does, and it was reaching up into
 * `src/lib/data.ts` to do it — a producer depending on the browser layer, which
 * is the dependency direction inverted.
 * @module shared/data/tournamentKeys
 */

/**
 * Folder key for the rolling online-meta aggregate. Matches the upstream
 * `reports/{name}/` path on R2 exactly, so it doubles as a tournament-list
 * entry and a fetch path. `src/lib/constants` re-exports it for the frontend.
 */
export const ONLINE_META_NAME = 'Online - Last 14 Days';

/**
 * Display label for the online meta. Purely cosmetic — the storage key is the
 * plain string above; nothing parses this label back into a key.
 */
export const ONLINE_META_LABEL = 'Online ladder · last 14 days';

const ONLINE = ONLINE_META_NAME;

/**
 * Build a local-midnight Date, rejecting components that are out of range.
 *
 * `new Date(2026, 12, 45)` does not produce an Invalid Date — JS silently rolls
 * it over to 2027-02-14. That matters here because {@link tournamentDate} feeds
 * the majors window's chronological sort, where a rolled-over date lands the
 * event in the wrong place instead of being skipped. Round-tripping the
 * components is the cheapest way to tell a real date from a normalized one.
 * @param year - Four-digit year
 * @param month - 1-based month
 * @param day - Day of month
 * @returns The date, or null when the components do not describe a real day
 */
function toLocalDate(year: number, month: number, day: number): Date | null {
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const roundTrips = date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  return roundTrips ? date : null;
}

/**
 * Tournament keys look like "2026-05-08, Regional Championship Los Angeles".
 * Pretty form for display: "Regional Championship Los Angeles · May 8, 2026"
 * Returns the input unchanged if the format doesn't match.
 */
export function prettyTournamentName(key: string): string {
  if (key === ONLINE) {
    return ONLINE_META_LABEL;
  }
  const m = key.match(/^(\d{4})-(\d{2})-(\d{2}),\s*(.+)$/);
  if (!m) {
    return key;
  }
  const [, y, mo, d, rest] = m;
  const date = toLocalDate(Number(y), Number(mo), Number(d));
  if (!date) {
    return key;
  }
  const dateLabel = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return `${rest} · ${dateLabel}`;
}

/**
 * Tournament type classification (regional / international / online / special).
 * Used to group + filter in the selector.
 */
export function classifyTournament(key: string): 'online' | 'regional' | 'international' | 'special' | 'other' {
  if (key === ONLINE) {
    return 'online';
  }
  const lower = key.toLowerCase();
  if (lower.includes('international championship')) {
    return 'international';
  }
  if (lower.includes('regional championship')) {
    return 'regional';
  }
  if (lower.includes('special event')) {
    return 'special';
  }
  return 'other';
}

/**
 * Parse the date portion of a tournament key like "2026-05-08, Regional Championship Los Angeles".
 */
export function tournamentDate(key: string): Date | null {
  if (key === ONLINE) {
    return null;
  }
  const m = key.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) {
    return null;
  }
  return toLocalDate(Number(m[1]), Number(m[2]), Number(m[3]));
}

/**
 * Filter a tournament list to "majors" (regional / international / special).
 */
export function majorTournaments(list: string[]): string[] {
  return list.filter(t => {
    const c = classifyTournament(t);
    return c === 'regional' || c === 'international' || c === 'special';
  });
}
