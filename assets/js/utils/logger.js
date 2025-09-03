/**
 * Centralized logging utility with consistent formatting and levels
 * (no private class fields to maximize mobile Firefox compatibility)
 * @module Logger
 */

/** @typedef {'debug' | 'info' | 'warn' | 'error'} LogLevel */

class Logger {
  /**
   * Constructor initializes logger with default settings
   */
  constructor() {
    /** @type {LogLevel} */
    this._level = 'info';

    /** @type {Record<LogLevel, number>} */
    this._levels = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3
    };
  }

  /**
   * Set the minimum log level
   * @param {LogLevel} level
   */
  setLevel(level) {
    if (level in this._levels) {
      this._level = level;
    }
  }

  /**
   * Check if a level should be logged
   * @param {LogLevel} level
   * @returns {boolean}
   */
  _shouldLog(level) {
    return this._levels[level] >= this._levels[this._level];
  }

  /**
   * Format log message with timestamp and context
   * @param {LogLevel} level
   * @param {string} message
   * @param {any[]} args
   * @returns {[string, ...any[]]}
   */
  _format(level, message, args) {
    try {
      const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
      const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
      return [`${prefix} ${message}`, ...args];
    } catch {
      return [message, ...args];
    }
  }

  /**
   * Log debug message
   * @param {string} message
   * @param {...any} args
   */
  debug(message, ...args) {
    if (this._shouldLog('debug')) {
      // Use console.log for broader support where console.debug may be filtered
      (console.debug || console.log).apply(console, this._format('debug', message, args));
    }
  }

  /**
   * Log info message
   * @param {string} message
   * @param {...any} args
   */
  info(message, ...args) {
    console.log.apply(console, this._format('info', message, args));
  }

  /**
   * Log warning message
   * @param {string} message
   * @param {...any} args
   */
  warn(message, ...args) {
    console.warn.apply(console, this._format('warn', message, args));
  }

  /**
   * Log error message
   * @param {string} message
   * @param {...any} args
   */
  error(message, ...args) {
    console.error.apply(console, this._format('error', message, args));
  }

  /**
   * Log error with stack trace
   * @param {string} message
   * @param {Error} error
   * @param {...any} args
   */
  exception(message, error, ...args) {
    this.error(message, error && error.message ? error.message : String(error), error && error.stack ? error.stack : '', ...args);
  }
}

// Create singleton instance
export const logger = new Logger();

// Set log level based on environment or URL params
try {
  if (typeof window !== 'undefined' && 'URLSearchParams' in window) {
    const params = new URLSearchParams(window.location.search || '');
    const debugLevel = params.get('debug');
    if (debugLevel && ['debug', 'info', 'warn', 'error'].includes(debugLevel)) {
      logger.setLevel(debugLevel);
    }
  }
} catch {}
