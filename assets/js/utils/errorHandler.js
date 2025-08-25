/**
 * Centralized error handling utilities
 * @module ErrorHandler
 */

import { logger } from './logger.js';

/**
 * Standard error types for the application
 */
export const ErrorTypes = {
  NETWORK: 'NetworkError',
  PARSE: 'ParseError',
  VALIDATION: 'ValidationError',
  STORAGE: 'StorageError',
  NOT_FOUND: 'NotFoundError'
};

/**
 * Custom error classes for better error categorization
 */
export class AppError extends Error {
  /**
   * @param {string} message
   * @param {string} type
   * @param {any} [context]
   */
  constructor(message, type, context = null) {
    super(message);
    this.name = 'AppError';
    this.type = type;
    this.context = context;
    this.timestamp = new Date().toISOString();
  }
}

/**
 * Safe async function wrapper that logs errors
 * @template T
 * @param {() => Promise<T>} fn - Async function to wrap
 * @param {string} [operation] - Description of the operation
 * @param {T} [fallback] - Fallback value on error
 * @returns {Promise<T>}
 */
export async function safeAsync(fn, operation = 'operation', fallback = null) {
  try {
    return await fn();
  } catch (error) {
    logger.exception(`Failed ${operation}`, error);
    return fallback;
  }
}

/**
 * Safe sync function wrapper that logs errors
 * @template T
 * @param {() => T} fn - Sync function to wrap
 * @param {string} [operation] - Description of the operation
 * @param {T} [fallback] - Fallback value on error
 * @returns {T}
 */
export function safeSync(fn, operation = 'operation', fallback = null) {
  try {
    return fn();
  } catch (error) {
    logger.exception(`Failed ${operation}`, error);
    return fallback;
  }
}

/**
 * Create a retry wrapper for async functions
 * @template T
 * @param {() => Promise<T>} fn - Function to retry
 * @param {number} [maxAttempts=3] - Maximum retry attempts
 * @param {number} [delay=1000] - Delay between retries in ms
 * @returns {Promise<T>}
 */
export async function withRetry(fn, maxAttempts = 3, delay = 1000) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Enhanced error logging with context
      if (error instanceof AppError && error.context) {
        logger.warn(`Attempt ${attempt}/${maxAttempts} failed`, error.message, error.context);
      } else {
        logger.warn(`Attempt ${attempt}/${maxAttempts} failed`, error.message);
      }

      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  // Enhanced error logging for final failure
  if (lastError instanceof AppError && lastError.context) {
    logger.error(`Failed after ${maxAttempts} attempts`, lastError.message, lastError.context);
  } else {
    logger.error(`Failed after ${maxAttempts} attempts`, lastError.message);
  }

  throw lastError;
}

/**
 * Validate that a value matches expected type/structure
 * @param {any} value
 * @param {string} expectedType
 * @param {string} [fieldName='value']
 * @throws {AppError}
 */
export function validateType(value, expectedType, fieldName = 'value') {
  if (expectedType === 'array' && !Array.isArray(value)) {
    throw new AppError(`Expected ${fieldName} to be array, got ${typeof value}`, ErrorTypes.VALIDATION);
  }
  if (expectedType === 'object' && (typeof value !== 'object' || value === null || Array.isArray(value))) {
    throw new AppError(`Expected ${fieldName} to be object, got ${typeof value}`, ErrorTypes.VALIDATION);
  }
  if (expectedType !== 'array' && expectedType !== 'object' && typeof value !== expectedType) {
    throw new AppError(`Expected ${fieldName} to be ${expectedType}, got ${typeof value}`, ErrorTypes.VALIDATION);
  }
}

/**
 * Assert a condition is true, throw error if false
 * @param {any} condition
 * @param {string} message
 * @param {string} [type=VALIDATION]
 * @throws {AppError}
 */
export function assert(condition, message, type = ErrorTypes.VALIDATION) {
  if (!condition) {
    throw new AppError(message, type);
  }
}
