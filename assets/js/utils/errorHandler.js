/**
 * Comprehensive error handling system with user-friendly messages
 * @module utils/errorHandler
 */

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
  USER_INPUT: 'UserInputError'
};

/**
 * Enhanced error class with user-friendly messages and context
 */
export class AppError extends Error {
  /**
   *
   * @param type
   * @param message
   * @param userMessage
   * @param context
   */
  constructor(type, message, userMessage = null, context = {}) {
    super(message);
    this.name = 'AppError';
    this.type = type;
    this.userMessage = userMessage || this.getDefaultUserMessage(type);
    this.context = context;
    this.timestamp = Date.now();
  }

  /**
   *
   * @param type
   */
  getDefaultUserMessage(type) {
    const messages = {
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

/**
 * Logger utility for tracking errors and debugging
 */
export class Logger {
  /**
   *
   * @param level
   */
  constructor(level = 'info') {
    this.level = level;
    this.levels = { debug: 0, info: 1, warn: 2, error: 3 };
  }

  /**
   *
   * @param level
   */
  shouldLog(level) {
    return this.levels[level] >= this.levels[this.level];
  }

  /**
   *
   * @param message
   * @param data
   */
  debug(message, data = null) {
    if (this.shouldLog('debug')) {
      console.debug(`[DEBUG] ${message}`, data);
    }
  }

  /**
   *
   * @param message
   * @param data
   */
  info(message, data = null) {
    if (this.shouldLog('info')) {
      console.info(`[INFO] ${message}`, data);
    }
  }

  /**
   *
   * @param message
   * @param data
   */
  warn(message, data = null) {
    if (this.shouldLog('warn')) {
      console.warn(`[WARN] ${message}`, data);
    }
  }

  /**
   *
   * @param message
   * @param error
   */
  error(message, error = null) {
    if (this.shouldLog('error')) {
      console.error(`[ERROR] ${message}`, error);
    }
  }

  /**
   *
   * @param message
   * @param error
   * @param context
   */
  exception(message, error, context = {}) {
    if (this.shouldLog('error')) {
      console.error(`[EXCEPTION] ${message}`, {
        error: error.message || error,
        stack: error.stack,
        context,
        timestamp: new Date().toISOString()
      });
    }
  }
}

export const logger = new Logger('info');

/**
 * Error boundary for handling async operations with user feedback
 */
export class ErrorBoundary {
  /**
   *
   * @param container
   * @param options
   */
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      showRetryButton: true,
      showErrorDetails: false,
      logErrors: true,
      ...options
    };
  }

  /**
   * Execute an async operation with error handling
   * @param {Function} operation - Async operation to execute
   * @param {Function} onSuccess - Success callback
   * @param {object} config - Configuration options
   * @returns {Promise} Operation promise
   */
  async execute(operation, onSuccess = null, config = {}) {
    const {
      loadingMessage = 'Loading...',
      retryAttempts = 2,
      retryDelay = 1000
    } = config;

    this.showLoading(loadingMessage);

    let lastError = null;

    for (let attempt = 0; attempt <= retryAttempts; attempt++) {
      try {
        const result = await operation();

        if (onSuccess) {
          onSuccess(result);
        }

        this.clearError();
        return result;
      } catch (error) {
        lastError = error;

        if (this.options.logErrors) {
          logger.exception(`Operation failed (attempt ${attempt + 1}/${retryAttempts + 1})`, error);
        }

        // If this wasn't the last attempt, wait before retrying
        if (attempt < retryAttempts) {
          await this.sleep(retryDelay * Math.pow(2, attempt)); // Exponential backoff
        }
      }
    }

    // All attempts failed
    this.showError(lastError);
    throw lastError;
  }

  /**
   *
   * @param message
   */
  showLoading(message) {
    if (!this.container) {return;}

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
  showError(error) {
    if (!this.container) {return;}

    const appError = error instanceof AppError ? error : new AppError(ErrorTypes.API, error.message);

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
        <div class="error-icon">⚠️</div>
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

  clearError() {
    if (!this.container) {return;}

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
  sleep(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  }
}

/**
 * @typedef {RequestInit & { timeout?: number; retries?: number; retryDelay?: number }} ExtendedRequestInit
 */

/**
 * Enhanced safe fetch with comprehensive error handling
 * @param {string|Request} input - URL or Request object
 * @param {ExtendedRequestInit} [init] - Fetch options
 * @returns {Promise<Response>} Enhanced response
 */
export async function safeFetch(input, init = {}) {
  const {
    timeout = 10000,
    retries = 2,
    retryDelay = 1000,
    ...fetchOptions
  } = init;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await fetch(input, {
          ...fetchOptions,
          signal: controller.signal
        });

        clearTimeout(timeoutId);

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
      } catch (error) {
        lastError = error;

        if (error.name === 'AbortError') {
          throw new AppError(ErrorTypes.TIMEOUT, 'Request timed out', null, { timeout });
        }

        if (error.name === 'TypeError' && error.message.includes('fetch')) {
          throw new AppError(ErrorTypes.NETWORK, 'Network connection failed', null, { originalError: error });
        }

        // If this wasn't the last attempt, wait before retrying
        if (attempt < retries) {
          await new Promise(resolve => setTimeout(resolve, retryDelay * Math.pow(2, attempt)));
        }
      }
    }

    throw lastError;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Validation helpers for common input types
 */
export const validators = {
  cardIdentifier(identifier) {
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

  tournament(tournament) {
    if (!tournament || typeof tournament !== 'string') {
      throw new AppError(ErrorTypes.VALIDATION, 'Tournament name must be a non-empty string');
    }
    return tournament.trim();
  },

  array(arr, minLength = 0) {
    if (!Array.isArray(arr)) {
      throw new AppError(ErrorTypes.VALIDATION, 'Expected an array');
    }
    if (arr.length < minLength) {
      throw new AppError(ErrorTypes.VALIDATION, `Array must have at least ${minLength} items`);
    }
    return arr;
  }
};

/**
 * Simple assertion helper for validation
 * @param {any} condition - Value to test for truthiness
 * @param {string} message - Error message if assertion fails
 * @throws {Error} If condition is falsy
 */
export function assert(condition, message = 'Assertion failed') {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * Type validation helper
 * @param {any} value - Value to validate
 * @param {string} expectedType - Expected type name
 * @param {string} paramName - Parameter name for error message
 * @throws {Error} If type doesn't match
 */
export function validateType(value, expectedType, paramName = 'value') {
  // Handle array type specially since typeof array returns 'object'
  if (expectedType === 'array') {
    if (Array.isArray(value)) {
      return; // Valid array
    }
    const actualType = Array.isArray(value) ? 'array' : typeof value;
    throw new Error(`${paramName} must be ${expectedType}, got ${actualType}`);
  }

  const actualType = typeof value;
  if (actualType !== expectedType) {
    throw new Error(`${paramName} must be ${expectedType}, got ${actualType}`);
  }
}

/**
 * Retry wrapper for async operations
 * @param {Function} operation - Async operation to retry
 * @param {number} maxAttempts - Maximum number of attempts
 * @param {number} delayMs - Delay between attempts in milliseconds
 * @returns {Promise} Result of the operation
 */
export async function withRetry(operation, maxAttempts = 3, delayMs = 1000) {
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (attempt === maxAttempts) {
        throw error;
      }

      // Exponential backoff
      const delay = delayMs * Math.pow(2, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Safe synchronous operation wrapper with error handling
 * @param {Function} operation - Synchronous operation to execute
 * @param {any} [arg1] - Either default value or error message depending on invocation
 * @param {any} [arg2] - Either default value or error message depending on invocation
 * @returns {any} Result of operation or default value
 */
export function safeSync(operation, arg1, arg2) {
  let defaultValue = null;
  let errorMessage = 'Operation failed';

  const argCount = arguments.length;

  if (argCount >= 3) {
    if (typeof arg1 === 'string' && typeof arg2 !== 'string') {
      errorMessage = arg1;
      defaultValue = arg2 ?? null;
    } else {
      defaultValue = arg1 ?? null;
      if (typeof arg2 === 'string') {
        errorMessage = arg2;
      } else if (arg2 !== undefined) {
        defaultValue = arg2;
      }
    }
  } else if (argCount === 2) {
    if (typeof arg1 === 'string') {
      errorMessage = arg1;
    } else {
      defaultValue = arg1;
    }
  }

  try {
    return operation();
  } catch (error) {
    logger.warn(`${errorMessage}: ${error.message}`);
    return defaultValue;
  }
}

/**
 * Safe asynchronous operation wrapper with error handling
 * @param {Function} operation - Async operation to execute
 * @param {any} [arg1] - Either default value or error message depending on invocation
 * @param {any} [arg2] - Either default value or error message depending on invocation
 * @returns {Promise<any>} Result of operation or default value
 */
export async function safeAsync(operation, arg1, arg2) {
  let defaultValue = null;
  let errorMessage = 'Async operation failed';

  const argCount = arguments.length;

  if (argCount >= 3) {
    if (typeof arg1 === 'string' && typeof arg2 !== 'string') {
      errorMessage = arg1;
      defaultValue = arg2 ?? null;
    } else {
      defaultValue = arg1 ?? null;
      if (typeof arg2 === 'string') {
        errorMessage = arg2;
      } else if (arg2 !== undefined) {
        defaultValue = arg2;
      }
    }
  } else if (argCount === 2) {
    if (typeof arg1 === 'string') {
      errorMessage = arg1;
    } else {
      defaultValue = arg1;
    }
  }

  try {
    return await operation();
  } catch (error) {
    logger.warn(`${errorMessage}: ${error.message}`);
    return defaultValue;
  }
}

/**
 * Global error handler for unhandled promise rejections and errors
 */
export function setupGlobalErrorHandler() {
  if (typeof window === 'undefined') {return;}

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
 * @param {string} message - User-friendly error message
 */
export function showGlobalError(message) {
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
      <span class="error-icon">⚠️</span>
      <span class="error-text">${message}</span>
      <button class="error-close">&times;</button>
    </div>
  `;

  // Auto-hide after 5 seconds
  setTimeout(() => {
    if (errorNotification.parentNode) {
      errorNotification.remove();
    }
  }, 5000);

  // Manual close button
  const closeBtn = errorNotification.querySelector('.error-close');
  closeBtn?.addEventListener('click', () => {
    errorNotification.remove();
  });
}
