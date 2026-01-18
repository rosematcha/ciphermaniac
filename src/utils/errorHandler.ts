/**
 * Comprehensive error handling system with user-friendly messages
 * @module utils/errorHandler
 */

import { logger } from './logger.js';
export { logger, Logger } from './logger.js';

/**
 * Error types for categorizing different failure modes
 */
export const ErrorTypes = {
  NETWORK: 'NetworkError',
  VALIDATION: 'ValidationError',
  DATA_FORMAT: 'DataFormatError',
  TIMEOUT: 'TimeoutError',
  CACHE: 'CacheError',
  RENDER: 'RenderError',
  API: 'ApiError',
  USER_INPUT: 'UserInputError',
  PARSE: 'ParseError'
} as const;

export type ErrorType = (typeof ErrorTypes)[keyof typeof ErrorTypes];

/**
 * Enhanced error class with user-friendly messages and context
 */
export class AppError extends Error {
  type: ErrorType;
  userMessage: string;
  context: Record<string, any>;
  timestamp: number;

  /**
   *
   * @param type
   * @param message
   * @param userMessage
   * @param context
   */
  constructor(type: ErrorType, message: string, userMessage: string | null = null, context: Record<string, any> = {}) {
    super(message);
    this.name = 'AppError';
    this.type = type;
    this.userMessage = userMessage || AppError.getDefaultUserMessage(type);
    this.context = context;
    this.timestamp = Date.now();
  }

  /**
   *
   * @param type
   */
  static getDefaultUserMessage(type: ErrorType): string {
    const messages: Record<string, string> = {
      [ErrorTypes.NETWORK]: 'Connection problem. Please check your internet and try again.',
      [ErrorTypes.VALIDATION]: 'Please check your input and try again.',
      [ErrorTypes.DATA_FORMAT]: 'Data format issue. Please refresh and try again.',
      [ErrorTypes.TIMEOUT]: 'Request timed out. Please try again.',
      [ErrorTypes.CACHE]: 'Storage issue. Clearing cache might help.',
      [ErrorTypes.RENDER]: 'Display issue. Please refresh the page.',
      [ErrorTypes.API]: 'Service temporarily unavailable. Please try again later.',
      [ErrorTypes.USER_INPUT]: 'Invalid input provided.'
    };
    return messages[type] || 'Something went wrong. Please try again.';
  }
}

interface ErrorBoundaryOptions {
  showRetryButton?: boolean;
  showErrorDetails?: boolean;
  logErrors?: boolean;
}

interface ErrorBoundaryConfig {
  loadingMessage?: string;
  retryAttempts?: number;
  retryDelay?: number;
}

/**
 * Error boundary for handling async operations with user feedback
 */
export class ErrorBoundary {
  container: HTMLElement | null;
  options: ErrorBoundaryOptions;

  /**
   *
   * @param container
   * @param options
   */
  constructor(container: HTMLElement | null, options: ErrorBoundaryOptions = {}) {
    this.container = container;
    this.options = {
      showRetryButton: true,
      showErrorDetails: false,
      logErrors: true,
      ...options
    };
  }

  /**
   * Execute an async operation with error handling and retry
   * @param operation - Async operation to execute
   * @param onSuccess - Success callback
   * @param config - Configuration options
   * @returns Operation promise
   */
  async execute<T>(
    operation: () => Promise<T>,
    onSuccess: ((result: T) => void) | null = null,
    config: ErrorBoundaryConfig = {}
  ): Promise<T | undefined> {
    const { loadingMessage = 'Loading...', retryAttempts = 2, retryDelay = 1000 } = config;

    this.showLoading(loadingMessage);

    try {
      const result = await withRetry(operation, {
        maxAttempts: retryAttempts + 1, // withRetry uses total attempts, not retry count
        delayMs: retryDelay,
        onAttemptFail: this.options.logErrors
          ? (error, attempt, maxAttempts) => {
              logger.exception(`Operation failed (attempt ${attempt}/${maxAttempts})`, error);
            }
          : undefined
      });

      if (onSuccess) {
        onSuccess(result);
      }

      this.clearError();
      return result;
    } catch (error) {
      this.showError(error);
      throw error;
    }
  }

  /**
   *
   * @param message
   */
  showLoading(message: string): void {
    if (!this.container) {
      return;
    }

    this.container.innerHTML = `
      <div class="loading-state">
        <div class="loading-spinner"></div>
        <div class="loading-message">${message}</div>
      </div>
    `;
  }

  /**
   *
   * @param error
   */
  showError(error: any): void {
    if (!this.container) {
      return;
    }

    const appError = error instanceof AppError ? error : new AppError(ErrorTypes.API, error.message || String(error));

    const retryButton = this.options.showRetryButton
      ? `<button class="error-retry-btn" onclick="location.reload()">Try Again</button>`
      : '';

    const errorDetails = this.options.showErrorDetails
      ? `<details class="error-details">
          <summary>Technical Details</summary>
          <pre>${error.stack || error.message}</pre>
         </details>`
      : '';

    this.container.innerHTML = `
      <div class="error-state">
        <div class="error-icon">&#9888;</div>
        <div class="error-message">${appError.userMessage}</div>
        ${retryButton}
        ${errorDetails}
      </div>
    `;

    // Add event listener for retry button
    const retryBtn = this.container.querySelector('.error-retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => location.reload());
    }
  }

  clearError(): void {
    if (!this.container) {
      return;
    }

    const errorState = this.container.querySelector('.error-state');
    const loadingState = this.container.querySelector('.loading-state');

    if (errorState) {
      errorState.remove();
    }
    if (loadingState) {
      loadingState.remove();
    }
  }

  /**
   *
   * @param milliseconds
   */
  sleep(milliseconds: number): Promise<void> {
    return new Promise(resolve => {
      setTimeout(resolve, milliseconds);
    });
  }
}

export type ExtendedRequestInit = RequestInit & { timeout?: number; retries?: number; retryDelay?: number };

/**
 * Enhanced safe fetch with comprehensive error handling and retry
 * @param input - URL or Request object
 * @param init - Fetch options
 * @returns Enhanced response
 */
export async function safeFetch(input: string | Request, init: ExtendedRequestInit = {}): Promise<Response> {
  const { timeout = 10000, retries = 2, retryDelay = 1000, ...fetchOptions } = init;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  const singleFetch = async (): Promise<Response> => {
    try {
      const response = await fetch(input, {
        ...fetchOptions,
        signal: controller.signal
      });

      if (!response.ok) {
        const error = new AppError(
          ErrorTypes.API,
          `HTTP ${response.status}: ${response.statusText}`,
          response.status === 404
            ? 'The requested data was not found.'
            : response.status >= 500
              ? 'Server is temporarily unavailable.'
              : 'Request failed. Please try again.'
        );
        throw error;
      }

      return response;
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new AppError(ErrorTypes.TIMEOUT, 'Request timed out', null, {
          timeout
        });
      }

      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        throw new AppError(ErrorTypes.NETWORK, 'Network connection failed', null, { originalError: error });
      }

      throw error;
    }
  };

  try {
    return await withRetry(singleFetch, { maxAttempts: retries + 1, delayMs: retryDelay });
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Validation helpers for common input types
 */
export const validators = {
  cardIdentifier(identifier: unknown): string {
    if (!identifier || typeof identifier !== 'string') {
      throw new AppError(ErrorTypes.VALIDATION, 'Card identifier must be a non-empty string');
    }

    const trimmed = identifier.trim();
    if (trimmed.length === 0) {
      throw new AppError(ErrorTypes.VALIDATION, 'Card identifier cannot be empty');
    }

    if (trimmed.length > 200) {
      throw new AppError(ErrorTypes.VALIDATION, 'Card identifier is too long');
    }

    return trimmed;
  },

  tournament(tournament: unknown): string {
    if (!tournament || typeof tournament !== 'string') {
      throw new AppError(ErrorTypes.VALIDATION, 'Tournament name must be a non-empty string');
    }
    return tournament.trim();
  },

  array<T>(arr: unknown, minLength = 0): T[] {
    if (!Array.isArray(arr)) {
      throw new AppError(ErrorTypes.VALIDATION, 'Expected an array');
    }
    if (arr.length < minLength) {
      throw new AppError(ErrorTypes.VALIDATION, `Array must have at least ${minLength} items`);
    }
    return arr as T[];
  }
};

/**
 * Simple assertion helper for validation
 * @param condition - Value to test for truthiness
 * @param message - Error message if assertion fails
 * @throws {Error} If condition is falsy
 */
export function assert(condition: any, message = 'Assertion failed'): asserts condition {
  if (!condition) {
    throw new AppError(ErrorTypes.VALIDATION, message);
  }
}

/**
 * Type validation helper
 * @param value - Value to validate
 * @param expectedType - Expected type name
 * @param paramName - Parameter name for error message
 * @throws {Error} If type doesn't match
 */
export function validateType(value: any, expectedType: string, paramName = 'value'): void {
  // Handle array type specially since typeof array returns 'object'
  if (expectedType === 'array') {
    if (Array.isArray(value)) {
      return; // Valid array
    }
    const actualType = Array.isArray(value) ? 'array' : typeof value;
    throw new AppError(ErrorTypes.VALIDATION, `${paramName} must be ${expectedType}, got ${actualType}`);
  }

  const actualType = typeof value;
  if (actualType !== expectedType) {
    throw new AppError(ErrorTypes.VALIDATION, `${paramName} must be ${expectedType}, got ${actualType}`);
  }
}

/**
 * Options for withRetry function
 */
export interface RetryOptions {
  /** Maximum number of attempts (default: 3) */
  maxAttempts?: number;
  /** Initial delay between attempts in milliseconds (default: 1000) */
  delayMs?: number;
  /** Optional callback for each failed attempt */
  onAttemptFail?: (error: any, attempt: number, maxAttempts: number) => void;
}

/**
 * Retry wrapper for async operations with exponential backoff
 * @param operation - Async operation to retry
 * @param options - Retry configuration options
 * @returns Result of the operation
 */
export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { maxAttempts = 3, delayMs = 1000, onAttemptFail } = options;
  let lastError: any = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (onAttemptFail) {
        onAttemptFail(error, attempt, maxAttempts);
      }

      if (attempt === maxAttempts) {
        throw error;
      }

      // Exponential backoff
      const delay = delayMs * 2 ** (attempt - 1);
      await new Promise(resolve => {
        setTimeout(resolve, delay);
      });
    }
  }

  throw lastError;
}

/**
 * Safe synchronous operation wrapper with error handling
 * @param operation - Synchronous operation to execute
 * @param arg1 - Either default value or error message depending on invocation
 * @param arg2 - Either default value or error message depending on invocation
 * @returns Result of operation or default value
 */
export function safeSync<T>(operation: () => T, arg1?: string | T, arg2?: T | string): T | null {
  let defaultValue: T | null = null;
  let errorMessage = 'Operation failed';

  const argCount = arguments.length;

  if (argCount >= 3) {
    if (typeof arg1 === 'string' && typeof arg2 !== 'string') {
      errorMessage = arg1;
      defaultValue = (arg2 as T) ?? null;
    } else {
      defaultValue = (arg1 as T) ?? null;
      if (typeof arg2 === 'string') {
        errorMessage = arg2;
      } else if (arg2 !== undefined) {
        defaultValue = arg2 as T;
      }
    }
  } else if (argCount === 2) {
    if (typeof arg1 === 'string') {
      errorMessage = arg1;
    } else {
      defaultValue = arg1 as T;
    }
  }

  try {
    return operation();
  } catch (error: any) {
    logger.warn(`${errorMessage}: ${error.message}`);
    return defaultValue;
  }
}

/**
 * Safe asynchronous operation wrapper with error handling
 * @param operation - Async operation to execute
 * @param arg1 - Either default value or error message depending on invocation
 * @param arg2 - Either default value or error message depending on invocation
 * @returns Result of operation or default value
 */
export async function safeAsync<T>(
  operation: () => Promise<T>,
  arg1?: string | T,
  arg2?: T | string
): Promise<T | null> {
  let defaultValue: T | null = null;
  let errorMessage = 'Async operation failed';

  const argCount = arg2 !== undefined ? 3 : arg1 !== undefined ? 2 : 1;

  if (argCount >= 3) {
    if (typeof arg1 === 'string' && typeof arg2 !== 'string') {
      errorMessage = arg1;
      defaultValue = (arg2 as T) ?? null;
    } else {
      defaultValue = (arg1 as T) ?? null;
      if (typeof arg2 === 'string') {
        errorMessage = arg2;
      } else if (arg2 !== undefined) {
        defaultValue = arg2 as T;
      }
    }
  } else if (argCount === 2) {
    if (typeof arg1 === 'string') {
      errorMessage = arg1;
    } else {
      defaultValue = arg1 as T;
    }
  }

  try {
    return await operation();
  } catch (error: any) {
    logger.warn(`${errorMessage}: ${error.message}`);
    return defaultValue;
  }
}

/**
 * Global error handler for unhandled promise rejections and errors
 */
export function setupGlobalErrorHandler(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.addEventListener('unhandledrejection', event => {
    logger.exception('Unhandled promise rejection', event.reason);

    // Prevent the default browser error handling
    event.preventDefault();

    // Show user-friendly error if it's an AppError
    if (event.reason instanceof AppError) {
      showGlobalError(event.reason.userMessage);
    }
  });

  window.addEventListener('error', event => {
    logger.exception('Global error', event.error, {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno
    });
  });
}

/**
 * Show a global error notification
 * @param message - User-friendly error message
 */
export function showGlobalError(message: string): void {
  // Create or update global error notification
  let errorNotification = document.getElementById('global-error-notification');

  if (!errorNotification) {
    errorNotification = document.createElement('div');
    errorNotification.id = 'global-error-notification';
    errorNotification.className = 'global-error-notification';
    document.body.appendChild(errorNotification);
  }

  errorNotification.innerHTML = `
    <div class="error-content">
      <span class="error-icon">&#9888;</span>
      <span class="error-text">${message}</span>
      <button class="error-close">&times;</button>
    </div>
  `;

  // Auto-hide after 5 seconds
  setTimeout(() => {
    if (errorNotification?.parentNode) {
      errorNotification.remove();
    }
  }, 5000);

  // Manual close button
  const closeBtn = errorNotification.querySelector('.error-close');
  closeBtn?.addEventListener('click', () => {
    errorNotification?.remove();
  });
}
