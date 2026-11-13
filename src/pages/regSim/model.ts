/**
 * The fake registration's rules: when it opens, which weekend the event lands
 * on, what it costs locally, and how long a draw lasts on this device.
 *
 * Everything here is pure: the page passes in the clock and the random source,
 * so the rules can be tested without either.
 */

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** How long one draw (city, open time, event code) survives on this device. */
export const DRAW_TTL_MS = 2 * HOUR_MS;

/** How far out the event sits. */
const LEAD_DAYS = 56;

export type Division = 'junior' | 'senior' | 'masters';

export const USD_PRICE: Record<Division, number> = { junior: 40, senior: 40, masters: 80 };

/**
 * Registration opens at the next top of the hour on the visitor's own clock.
 * From the hour's last minute on (7:59 and later), the next one is too close, so
 * it skips ahead an hour.
 */
export function nextOpening(now: Date): number {
  const top = new Date(now);
  top.setMinutes(0, 0, 0);
  const next = top.getTime() + HOUR_MS;
  return next - now.getTime() <= MINUTE_MS ? next + HOUR_MS : next;
}

/** A calendar date with no time zone attached. */
export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

function calendar(date: Date): CalendarDate {
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/** Days after (or before, if negative) a calendar date. */
export function addDays(date: CalendarDate, days: number): CalendarDate {
  return calendar(new Date(Date.UTC(date.year, date.month - 1, date.day) + days * DAY_MS));
}

/**
 * The Saturday of the weekend eight weeks from today, by the visitor's own
 * calendar. A weekday rolls forward to its Saturday; a Sunday belongs to the
 * weekend it ends.
 */
export function eventSaturday(now: Date): CalendarDate {
  const target = addDays({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() }, LEAD_DAYS);
  const weekday = new Date(Date.UTC(target.year, target.month - 1, target.day)).getUTCDay();
  return addDays(target, weekday === 0 ? -1 : 6 - weekday);
}

/**
 * The UTC instant of a wall-clock time in an IANA zone. Two passes settle the
 * offset on either side of a daylight-saving change.
 */
export function zonedInstant(date: CalendarDate, hour: number, minute: number, timeZone: string): number {
  const wall = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
  let guess = wall;
  for (let pass = 0; pass < 2; pass++) {
    guess = wall - offsetMs(guess, timeZone);
  }
  return guess;
}

function offsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric'
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(p => p.type === type)?.value);
  const asUtc = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'));
  return asUtc - Math.floor(instant / MINUTE_MS) * MINUTE_MS;
}

/**
 * A US-dollar price in a local currency, rounded to two significant figures
 * so it reads like a price someone set rather than a conversion.
 */
export function localPrice(usd: number, rate: number): number {
  const amount = usd * rate;
  const step = 10 ** Math.max(0, Math.floor(Math.log10(amount)) - 1);
  return Math.round(amount / step) * step;
}

/** One stored draw. Everything the page shows derives from these fields. */
export interface Draw {
  version: 1;
  createdAt: number;
  cityId: string;
  opensAt: number;
  saturday: CalendarDate;
  code: string;
  registeredAt?: number;
  division?: Division;
}

const CODE_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function eventCode(cityName: string, random: () => number): string {
  const prefix = cityName
    .normalize('NFD')
    .replace(/[^A-Za-z]/g, '')
    .slice(0, 2)
    .toUpperCase()
    .padEnd(2, 'X');
  const suffix = Array.from({ length: 14 }, () => CODE_CHARS[Math.floor(random() * CODE_CHARS.length)]).join('');
  return `${prefix}001-${suffix}`;
}

export function newDraw(now: Date, cities: readonly { id: string; city: string }[], random: () => number): Draw {
  const city = cities[Math.floor(random() * cities.length)];
  return {
    version: 1,
    createdAt: now.getTime(),
    cityId: city.id,
    opensAt: nextOpening(now),
    saturday: eventSaturday(now),
    code: eventCode(city.city, random)
  };
}

/** A stored draw, if it is well formed, still fresh, and names a known city. */
export function liveDraw(raw: string | null, now: number, knownCity: (id: string) => boolean): Draw | null {
  const draw = parseDraw(raw);
  if (!draw || now - draw.createdAt >= DRAW_TTL_MS || now < draw.createdAt) {
    return null;
  }
  return knownCity(draw.cityId) ? draw : null;
}

function parseDraw(raw: string | null): Draw | null {
  try {
    const value: unknown = JSON.parse(raw ?? 'null');
    return isDraw(value) ? value : null;
  } catch {
    return null;
  }
}

function isDraw(value: unknown): value is Draw {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const draw = value as Partial<Draw>;
  return (
    draw.version === 1 &&
    typeof draw.createdAt === 'number' &&
    typeof draw.opensAt === 'number' &&
    typeof draw.cityId === 'string' &&
    typeof draw.code === 'string' &&
    typeof draw.saturday?.year === 'number'
  );
}
