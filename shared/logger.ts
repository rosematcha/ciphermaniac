/**
 * Minimal DEV-gated logger. Diagnostic output (debug/info/warn) is emitted only
 * in development; errors always surface. Optional chaining on import.meta.env
 * keeps this safe under Node-based tests where it may be undefined.
 *
 * String arguments are flattened to a single line ({@link sanitize}) so
 * attacker-controlled data can't forge extra log lines (log-injection safety).
 * @module Logger
 */

const DEV = Boolean(import.meta.env?.DEV);

/** Collapse CR/LF runs in string args to a space so a message can't span lines. */
function sanitize(args: unknown[]): unknown[] {
  return args.map(a => (typeof a === 'string' ? a.replace(/[\r\n]+/g, ' ') : a));
}

export const logger = {
  debug: (...args: unknown[]): void => {
    if (DEV) {
      console.debug(...sanitize(args));
    }
  },
  info: (...args: unknown[]): void => {
    if (DEV) {
      console.log(...sanitize(args));
    }
  },
  warn: (...args: unknown[]): void => {
    if (DEV) {
      console.warn(...sanitize(args));
    }
  },
  error: (...args: unknown[]): void => {
    console.error(...sanitize(args));
  },
  exception: (message: string, error: unknown, ...args: unknown[]): void => {
    const errorMessage = error && typeof error === 'object' && 'message' in error ? error.message : String(error);
    console.error(...sanitize([message, errorMessage, ...args]));
  }
};

/** Test hook: the single-line parts a message would produce. */
export function formatForTest(message: string, args: unknown[] = []): unknown[] {
  return sanitize([message, ...args]);
}
