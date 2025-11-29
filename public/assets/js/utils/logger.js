/* eslint-disable no-console */
/**
 * Centralized logging utility with consistent formatting and levels
 * (no private class fields to maximize mobile Firefox compatibility)
 * @module Logger
 */
/**
 * Lightweight logger tuned for browser environments with configurable levels.
 */
export class Logger {
    _level;
    _levels;
    /**
     * Constructor initializes logger with default settings
     */
    constructor() {
        this._level = 'info';
        this._levels = {
            debug: 0,
            info: 1,
            warn: 2,
            error: 3
        };
    }
    /**
     * Set the minimum log level
     * @param level
     */
    setLevel(level) {
        if (level in this._levels) {
            this._level = level;
        }
    }
    /**
     * Check if a level should be logged
     * @param level
     * @returns
     */
    _shouldLog(level) {
        return this._levels[level] >= this._levels[this._level];
    }
    /**
     * Format log message with timestamp and context
     * @param level
     * @param message
     * @param args
     * @returns
     */
    static format(level, message, args) {
        try {
            const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
            const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
            return [`${prefix} ${message}`, ...args];
        }
        catch {
            return [message, ...args];
        }
    }
    /**
     * Log debug message
     * @param message
     * @param args
     */
    debug(message, ...args) {
        if (this._shouldLog('debug')) {
            // Use console.log for broader support where console.debug may be filtered
            const parts = Logger.format('debug', message, args);
            (console.debug || console.log).apply(console, parts);
        }
    }
    /**
     * Log info message
     * @param message
     * @param args
     */
    info(message, ...args) {
        console.log(...Logger.format('info', message, args));
    }
    /**
     * Log warning message
     * @param message
     * @param args
     */
    warn(message, ...args) {
        console.warn(...Logger.format('warn', message, args));
    }
    /**
     * Log error message
     * @param message
     * @param args
     */
    error(message, ...args) {
        console.error(...Logger.format('error', message, args));
    }
    /**
     * Log error with stack trace
     * @param message
     * @param error
     * @param args
     */
    exception(message, error, ...args) {
        const errorMessage = error && typeof error === 'object' && 'message' in error ? error.message : String(error);
        const errorStack = error && typeof error === 'object' && 'stack' in error ? error.stack : '';
        this.error(message, errorMessage, errorStack, ...args);
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
}
catch {
    // Ignore localStorage errors
}
