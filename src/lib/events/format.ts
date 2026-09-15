/**
 * Presentation for event listings: clocks, fees, dates, names, and addresses,
 * each in the conventions of the country the event is in.
 *
 * The site is in English, so month and weekday names are English everywhere;
 * what varies by country is the clock (12- or 24-hour) and the currency.
 * @module lib/events/format
 */

/** Countries where a 12-hour clock is the everyday reading. */
const TWELVE_HOUR = new Set(['US', 'CA', 'AU', 'NZ', 'PH', 'IN']);

/**
 * Currency for each country Pokedata lists. Admission arrives as a bare number
 * ("10") or hand-typed ("$10.00", "7€") with no currency code, so the country
 * decides.
 */
const CURRENCY: Record<string, string> = {
  AE: 'AED',
  AR: 'ARS',
  AT: 'EUR',
  AU: 'AUD',
  BE: 'EUR',
  BO: 'BOB',
  BR: 'BRL',
  CA: 'CAD',
  CH: 'CHF',
  CL: 'CLP',
  CO: 'COP',
  CR: 'CRC',
  CZ: 'CZK',
  DE: 'EUR',
  DK: 'DKK',
  DO: 'DOP',
  EC: 'USD',
  ES: 'EUR',
  FI: 'EUR',
  FR: 'EUR',
  GB: 'GBP',
  GG: 'GBP',
  GR: 'EUR',
  GT: 'GTQ',
  HU: 'HUF',
  IE: 'EUR',
  IM: 'GBP',
  IT: 'EUR',
  JE: 'GBP',
  LU: 'EUR',
  MT: 'EUR',
  MX: 'MXN',
  NI: 'NIO',
  NL: 'EUR',
  NO: 'NOK',
  NZ: 'NZD',
  PA: 'USD',
  PE: 'PEN',
  PL: 'PLN',
  PR: 'USD',
  PT: 'EUR',
  PY: 'PYG',
  RO: 'RON',
  SE: 'SEK',
  SK: 'EUR',
  SV: 'USD',
  TT: 'TTD',
  US: 'USD',
  UY: 'UYU',
  ZA: 'ZAR'
};

const US_STATES: Record<string, string> = {
  Alabama: 'AL',
  Alaska: 'AK',
  Arizona: 'AZ',
  Arkansas: 'AR',
  California: 'CA',
  Colorado: 'CO',
  Connecticut: 'CT',
  Delaware: 'DE',
  'District of Columbia': 'DC',
  Florida: 'FL',
  Georgia: 'GA',
  Hawaii: 'HI',
  Idaho: 'ID',
  Illinois: 'IL',
  Indiana: 'IN',
  Iowa: 'IA',
  Kansas: 'KS',
  Kentucky: 'KY',
  Louisiana: 'LA',
  Maine: 'ME',
  Maryland: 'MD',
  Massachusetts: 'MA',
  Michigan: 'MI',
  Minnesota: 'MN',
  Mississippi: 'MS',
  Missouri: 'MO',
  Montana: 'MT',
  Nebraska: 'NE',
  Nevada: 'NV',
  'New Hampshire': 'NH',
  'New Jersey': 'NJ',
  'New Mexico': 'NM',
  'New York': 'NY',
  'North Carolina': 'NC',
  'North Dakota': 'ND',
  Ohio: 'OH',
  Oklahoma: 'OK',
  Oregon: 'OR',
  Pennsylvania: 'PA',
  'Puerto Rico': 'PR',
  'Rhode Island': 'RI',
  'South Carolina': 'SC',
  'South Dakota': 'SD',
  Tennessee: 'TN',
  Texas: 'TX',
  Utah: 'UT',
  Vermont: 'VT',
  Virginia: 'VA',
  Washington: 'WA',
  'West Virginia': 'WV',
  Wisconsin: 'WI',
  Wyoming: 'WY'
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Short words that stay lower case inside a title-cased name. */
const MINOR_WORDS = new Set(['a', 'an', 'and', 'at', 'de', 'del', 'di', 'da', 'du', 'la', 'le', 'of', 'on', 'the']);
/** Upper-case tokens that stay upper case. */
const ACRONYMS = new Set(['TCG', 'CCG', 'LLC', 'HQ', 'USA', 'UK', 'VGC', 'II', 'III', 'IV']);

let regionNames: Intl.DisplayNames | null | undefined;

/** English country name, or the code when the runtime has no names. */
export function countryName(cc: string): string {
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
    } catch {
      regionNames = null;
    }
  }
  try {
    return regionNames?.of(cc.toUpperCase()) ?? cc;
  } catch {
    return cc;
  }
}

const US_STATE_BY_NAME = new Map(Object.entries(US_STATES).map(([name, code]) => [name.toLowerCase(), code]));
const US_STATE_CODES = new Set(Object.values(US_STATES));

/**
 * State, province, and territory codes that sit in front of a postcode in an
 * address ("AUSTIN, TX 78701", "MOUNT OMMANEY QLD 4074"). Title casing would
 * turn them into "Tx" and "Qld".
 */
const REGION_CODES = new Set([
  ...US_STATE_CODES,
  ...['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'],
  ...['ACT', 'NSW', 'QLD', 'SA', 'TAS', 'VIC', 'WA']
]);

/** Two-letter code for a US state, from its name or its code in any case; else null. */
export function usStateCode(region: string): string | null {
  const trimmed = region.trim();
  if (US_STATE_CODES.has(trimmed.toUpperCase())) {
    return trimmed.toUpperCase();
  }
  return US_STATE_BY_NAME.get(trimmed.toLowerCase()) ?? null;
}

function titleWord(word: string, index: number): string {
  if (/\d/.test(word) || ACRONYMS.has(word.toUpperCase())) {
    return word.toUpperCase();
  }
  const lower = word.toLowerCase();
  if (index > 0 && MINOR_WORDS.has(lower)) {
    return lower;
  }
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * Title case for names typed in all capitals ("DRAGON'S LAIR" → "Dragon's
 * Lair"). Anything already in mixed case is left exactly as the store wrote
 * it — "iPlay", "McKinney", and "eSports" are spelled that way on purpose.
 */
export function titleCase(value: string): string {
  if (value !== value.toUpperCase() || value === value.toLowerCase()) {
    return value;
  }
  let index = 0;
  return value.replace(/[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu, word => titleWord(word, index++));
}

/** Street address without the country on the end, which the page already shows. */
export function addressLine(address: string, cc: string): string {
  const country = countryName(cc).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const withoutCountry = address.replace(new RegExp(`,\\s*(US|USA|UK|United Kingdom|${country})\\s*$`, 'i'), '');
  return titleCase(withoutCountry.trim()).replace(/\b(\p{L}{2,3})(?=\s+[\p{L}\d-]*\d)/gu, word =>
    REGION_CODES.has(word.toUpperCase()) ? word.toUpperCase() : word
  );
}

/** "7:30 pm" or "19:30", by the country's clock. Empty in, empty out. */
export function formatClock(time: string, cc: string): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!match) {
    return '';
  }
  const hours = Number(match[1]);
  if (!TWELVE_HOUR.has(cc.toUpperCase())) {
    return `${String(hours).padStart(2, '0')}:${match[2]}`;
  }
  return `${((hours + 11) % 12) + 1}:${match[2]} ${hours < 12 ? 'am' : 'pm'}`;
}

/** "Sep 20" from a `YYYY-MM-DD` date. */
export function monthDay(date: string): string {
  const [, month, day] = date.split('-').map(Number);
  return `${MONTHS[(month ?? 1) - 1]} ${day}`;
}

/** "Sep 1, 7:00 pm" from a venue-local `YYYY-MM-DDTHH:MM`. */
export function formatWallTime(stamp: string, cc: string): string {
  const [date = '', time = ''] = stamp.split('T');
  return `${monthDay(date)}, ${formatClock(time, cc)}`;
}

/** Local calendar date as `YYYY-MM-DD`. */
export function isoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function dayNumber(date: string): number {
  const [year = 1970, month = 1, day = 1] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

/** Whole days from `today` to `date`, both `YYYY-MM-DD`. */
export function daysBetween(today: string, date: string): number {
  return Math.round(dayNumber(date) - dayNumber(today));
}

/** "Wed, Sep 16". */
export function dayHeading(date: string): string {
  const weekday = new Date(dayNumber(date) * 86_400_000).getUTCDay();
  return `${WEEKDAYS[weekday]}, ${monthDay(date)}`;
}

export function isWeekend(date: string): boolean {
  const weekday = new Date(dayNumber(date) * 86_400_000).getUTCDay();
  return weekday === 0 || weekday === 6;
}

/** "Today", "Tomorrow", "In 4 days", "Next week", "In 3 weeks". */
export function relativeDay(today: string, date: string): string {
  const days = daysBetween(today, date);
  if (days <= 0) {
    return 'Today';
  }
  if (days === 1) {
    return 'Tomorrow';
  }
  if (days < 7) {
    return `In ${days} days`;
  }
  const weeks = Math.floor(days / 7);
  return weeks === 1 ? 'Next week' : `In ${weeks} weeks`;
}

function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.,]/g, '');
  // "10,50" is ten and a half; "1,000" is a thousand.
  const decimal =
    /,\d{1,2}$/.test(cleaned) && !cleaned.includes('.') ? cleaned.replace(',', '.') : cleaned.replace(/,/g, '');
  const amount = Number.parseFloat(decimal);
  return Number.isFinite(amount) ? amount : null;
}

/**
 * Admission in the event's currency: "$15", "€7", "£4.50". Text that is not a
 * plain amount ("5 or 2 packs") is shown as the store wrote it.
 */
export function formatFee(raw: string, cc: string): string {
  const amount = parseAmount(raw);
  const currency = CURRENCY[cc.toUpperCase()];
  const plain = /^\s*[^\d\s]{0,3}\s*[\d.,]+\s*[^\d\s]{0,3}\s*$/.test(raw);
  if (amount === null || !plain || !currency) {
    return raw.trim();
  }
  return new Intl.NumberFormat('en', {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2
  }).format(amount);
}
