/**
 * Default-locale date formatters, built once per option set. `toLocaleDateString` with options
 * builds a new Intl.DateTimeFormat on every call, about 80 times slower than reusing one, and the
 * top nav alone labels every event on every route.
 * @module shared/data/dateFormat
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

/** The formatter `date.toLocaleDateString(undefined, options)` would build, cached. */
export function dateFormatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(options);
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(undefined, options);
    formatters.set(key, formatter);
  }
  return formatter;
}
