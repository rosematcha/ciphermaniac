/**
 * Age rules. Ciphermaniac holds no accounts for minors: an account is for
 * someone 18 or older, checked against a full birth date once, before the
 * account exists, and only the year is kept. Everywhere else the site knows a
 * birth year at most, so a year is judged by the youngest its holder could
 * be: someone born in 2008 is 17 or 18 during 2026.
 *
 * Players under 13 do not hand the site anything themselves at sanctioned
 * events (COPPA covers what a site collects online from children it knows
 * are under 13), so staff report their results and take their lists on paper.
 */

export const ADULT_AGE = 18;
export const CHILD_AGE = 13;

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A YYYY-MM-DD birth date as its parts, or null when it is no real date. */
function partsOf(value: string): { year: number; month: number; day: number } | null {
  const match = ISO_DATE_RE.exec(value.trim());
  if (!match) {
    return null;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  const real = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return real ? { year, month, day } : null;
}

/** The year of a YYYY-MM-DD birth date that is a real day in the past, or null. */
export function birthYearOfDate(value: string, now: Date): number | null {
  const parts = partsOf(value);
  if (!parts || Date.UTC(parts.year, parts.month - 1, parts.day) > now.getTime() || parts.year < 1900) {
    return null;
  }
  return parts.year;
}

/** Whether someone born on `value` (YYYY-MM-DD) is at least 18 on `now`'s UTC date. */
export function isAdult(value: string, now: Date): boolean {
  const parts = partsOf(value);
  if (!parts || birthYearOfDate(value, now) === null) {
    return false;
  }
  const birthday = Date.UTC(parts.year + ADULT_AGE, parts.month - 1, parts.day);
  return birthday <= Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/** The youngest someone born in `year` can be during `now`'s year. */
function youngestAge(year: number, now: Date): number {
  return now.getUTCFullYear() - year - 1;
}

/** Whether someone born in `year` may still be under 18; an unknown year says nothing. */
export function mayBeMinor(year: number | null, now: Date): boolean {
  return year !== null && youngestAge(year, now) < ADULT_AGE;
}

/** Whether someone born in `year` may still be under 13; an unknown year says nothing. */
export function mayBeUnder13(year: number | null, now: Date): boolean {
  return year !== null && youngestAge(year, now) < CHILD_AGE;
}

/**
 * Whether an account may say it was born in `year`: a year an adult can have
 * been born in by the end of `now`'s year. The exact date was checked when the
 * account was made; this only keeps a profile from naming a minor's year.
 */
export function adultYear(year: number | null, now: Date): boolean {
  return year !== null && year >= 1900 && now.getUTCFullYear() - year >= ADULT_AGE;
}

/** What a player under 13 is told where they would hand the site their details. */
export const UNDER_13 = 'Players under 13 report to staff, and hand in decklists on paper.';
