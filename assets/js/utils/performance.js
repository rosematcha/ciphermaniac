/**
 * Performance and utility functions
 * @module Utils
 */

import { logger } from './logger.js';
import { CONFIG } from '../config.js';

/**
 * Debounce function calls to improve performance
 * @param {Function} func - Function to debounce
 * @param {number} [wait] - Wait time in milliseconds
 * @param {boolean} [immediate] - Whether to execute immediately on first call
 * @returns {Function} Debounced function
 */
export function debounce(func, wait = CONFIG.UI.DEBOUNCE_MS, immediate = false) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      timeout = null;
      if (!immediate) {func.apply(this, args);}
    };
    const callNow = immediate && !timeout;
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
    if (callNow) {func.apply(this, args);}
  };
}

/**
 * Throttle function calls to limit execution frequency
 * @param {Function} func - Function to throttle
 * @param {number} [limit] - Maximum execution frequency in milliseconds
 * @returns {Function} Throttled function
 */
export function throttle(func, limit = CONFIG.UI.DEBOUNCE_MS) {
  let inThrottle;
  return function (...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => {
        inThrottle = false;
      }, limit);
    }
  };
}

/**
 * Create a cleanup manager for event listeners and resources
 */
export class CleanupManager {
  constructor() {
    this.cleanupFunctions = new Set();
  }

  /**
   * Add a cleanup function
   * @param {Function} cleanup
   */
  add(cleanup) {
    this.cleanupFunctions.add(cleanup);
  }

  /**
   * Add an event listener with automatic cleanup
   * @param {EventTarget} target
   * @param {string} event
   * @param {Function} listener
   * @param {object} [options]
   */
  addEventListener(target, event, listener, options = {}) {
    target.addEventListener(event, listener, options);
    this.add(() => target.removeEventListener(event, listener, options));
  }

  /**
   * Execute all cleanup functions
   */
  cleanup() {
    this.cleanupFunctions.forEach(cleanup => {
      try {
        cleanup();
      } catch (error) {
        logger.warn('Error during cleanup', error);
      }
    });
    this.cleanupFunctions.clear();
  }
}

/**
 * Simple performance monitoring utility
 */
export class PerformanceMonitor {
  constructor() {
    this.marks = new Map();
  }

  /**
   * Start timing an operation
   * @param {string} name
   */
  start(name) {
    if (CONFIG.DEV.ENABLE_PERF_MONITORING) {
      this.marks.set(name, performance.now());
    }
  }

  /**
   * End timing and log the result
   * @param {string} name
   */
  end(name) {
    if (CONFIG.DEV.ENABLE_PERF_MONITORING) {
      const startTime = this.marks.get(name);
      if (startTime) {
        const duration = performance.now() - startTime;
        logger.debug(`Performance: ${name} took ${duration.toFixed(2)}ms`);
        this.marks.delete(name);
      }
    }
  }
}

// Create global performance monitor
export const perf = new PerformanceMonitor();

/**
 * Validate HTML elements exist
 * @param {object} selectors - Object mapping names to CSS selectors
 * @param {string} [context] - Context for error reporting
 * @returns {object} Object mapping names to elements
 * @throws {Error} If required elements are missing
 */
export function validateElements(selectors, context = 'page') {
  const elements = {};
  const missing = [];

  Object.entries(selectors).forEach(([name, selector]) => {
    const element = document.querySelector(selector);
    if (element) {
      elements[name] = element;
    } else {
      missing.push(`${name} (${selector})`);
    }
  });

  if (missing.length > 0) {
    throw new Error(`Missing required elements in ${context}: ${missing.join(', ')}`);
  }

  return elements;
}
