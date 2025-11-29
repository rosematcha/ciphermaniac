/* eslint-disable no-console */
/**
 * Centralized logging utility with consistent formatting and levels
 * (no private class fields to maximize mobile Firefox compatibility)
 * @module Logger
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Lightweight logger tuned for browser environments with configurable levels.
 */
export class Logger {
    private _level: LogLevel;
    private _levels: Record<LogLevel, number>;

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
    setLevel(level: LogLevel): void {
        if (level in this._levels) {
            this._level = level;
        }
    }

    /**
     * Check if a level should be logged
     * @param level
     * @returns
     */
    private _shouldLog(level: LogLevel): boolean {
        return this._levels[level] >= this._levels[this._level];
    }

    /**
     * Format log message with timestamp and context
     * @param level
     * @param message
     * @param args
     * @returns
     */
    static format(level: LogLevel, message: string, args: any[]): [string, ...any[]] {
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
     * @param message
     * @param args
     */
    debug(message: string, ...args: any[]): void {
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
    info(message: string, ...args: any[]): void {
        console.log(...Logger.format('info', message, args));
    }

    /**
     * Log warning message
     * @param message
     * @param args
     */
    warn(message: string, ...args: any[]): void {
        console.warn(...Logger.format('warn', message, args));
    }

    /**
     * Log error message
     * @param message
     * @param args
     */
    error(message: string, ...args: any[]): void {
        console.error(...Logger.format('error', message, args));
    }

    /**
     * Log error with stack trace
     * @param message
     * @param error
     * @param args
     */
    exception(message: string, error: Error | unknown, ...args: any[]): void {
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
            logger.setLevel(debugLevel as LogLevel);
        }
    }
} catch {
    // Ignore localStorage errors
}
