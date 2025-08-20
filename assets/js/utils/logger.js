/**
 * Centralized logging utility with consistent formatting and levels
 * @module Logger
 */

/** @typedef {'debug' | 'info' | 'warn' | 'error'} LogLevel */

class Logger {
  /** @type {LogLevel} */
  #level = 'info';
  
  /** @type {Record<LogLevel, number>} */
  #levels = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
  };

  /**
   * Set the minimum log level
   * @param {LogLevel} level 
   */
  setLevel(level) {
    if (level in this.#levels) {
      this.#level = level;
    }
  }

  /**
   * Check if a level should be logged
   * @param {LogLevel} level 
   * @returns {boolean}
   */
  #shouldLog(level) {
    return this.#levels[level] >= this.#levels[this.#level];
  }

  /**
   * Format log message with timestamp and context
   * @param {LogLevel} level 
   * @param {string} message 
   * @param {any[]} args 
   * @returns {[string, ...any[]]}
   */
  #format(level, message, args) {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
    return [prefix + ' ' + message, ...args];
  }

  /**
   * Log debug message
   * @param {string} message 
   * @param {...any} args 
   */
  debug(message, ...args) {
    if (this.#shouldLog('debug')) {
      console.debug(...this.#format('debug', message, args));
    }
  }

  /**
   * Log info message
   * @param {string} message 
   * @param {...any} args 
   */
  info(message, ...args) {
    if (this.#shouldLog('info')) {
      console.log(...this.#format('info', message, args));
    }
  }

  /**
   * Log warning message
   * @param {string} message 
   * @param {...any} args 
   */
  warn(message, ...args) {
    if (this.#shouldLog('warn')) {
      console.warn(...this.#format('warn', message, args));
    }
  }

  /**
   * Log error message
   * @param {string} message 
   * @param {...any} args 
   */
  error(message, ...args) {
    if (this.#shouldLog('error')) {
      console.error(...this.#format('error', message, args));
    }
  }

  /**
   * Log error with stack trace
   * @param {string} message 
   * @param {Error} error 
   * @param {...any} args 
   */
  exception(message, error, ...args) {
    this.error(message, error.message, error.stack, ...args);
  }
}

// Create singleton instance
export const logger = new Logger();

// Set log level based on environment or URL params
if (typeof window !== 'undefined') {
  const params = new URLSearchParams(window.location.search);
  const debugLevel = params.get('debug');
  if (debugLevel && ['debug', 'info', 'warn', 'error'].includes(debugLevel)) {
    logger.setLevel(debugLevel);
  }
}
