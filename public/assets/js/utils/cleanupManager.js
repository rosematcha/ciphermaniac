/**
 * Memory leak prevention utility for managing event listeners and cleanup
 * @module utils/cleanupManager
 */

/**
 * CleanupManager handles automatic cleanup of event listeners, timers, and other resources
 * to prevent memory leaks in long-running applications
 */
import { logger } from './logger.js';

/**
 *
 */
export class CleanupManager {
  constructor() {
    this.eventListeners = new Set();
    this.timers = new Set();
    this.observers = new Set();
    this.abortControllers = new Set();
    this.cleanupCallbacks = new Set();
  }

  /**
   * Add an event listener that will be automatically cleaned up
   * @param {EventTarget} target - Element to attach listener to
   * @param {string} eventType - Event type to listen for
   * @param {EventListenerOrEventListenerObject} handler - Event handler function
   * @param {boolean|AddEventListenerOptions} [options] - Event listener options
   * @returns {() => void} Cleanup function for this specific listener
   */
  addEventListener(target, eventType, handler, options = false) {
    if (!target || typeof target.addEventListener !== 'function') {
      logger.warn('CleanupManager: Invalid event target provided');
      return () => {};
    }

    const listenerEntry = { target, eventType, handler, options };
    this.eventListeners.add(listenerEntry);

    target.addEventListener(eventType, handler, options);

    // Return cleanup function for individual removal
    return () => {
      target.removeEventListener(eventType, handler, options);
      this.eventListeners.delete(listenerEntry);
    };
  }

  /**
   * Add a timer that will be automatically cleared
   * @param {Function} timerFunction - setTimeout or setInterval
   * @param {Function} callback - Timer callback
   * @param {number} delay - Timer delay
   * @param {...any} args - Additional timer arguments
   * @returns {number} Timer ID
   */
  addTimer(timerFunction, callback, delay, ...args) {
    const timerId = timerFunction(callback, delay, ...args);
    this.timers.add({ id: timerId, type: timerFunction.name });
    return timerId;
  }

  /**
   * Add a setTimeout that will be automatically cleared
   * @param {Function} callback - Callback function
   * @param {number} delay - Delay in milliseconds
   * @param {...any} args - Additional arguments
   * @returns {number} Timer ID
   */
  setTimeout(callback, delay, ...args) {
    return this.addTimer(setTimeout, callback, delay, ...args);
  }

  /**
   * Add a setInterval that will be automatically cleared
   * @param {Function} callback - Callback function
   * @param {number} interval - Interval in milliseconds
   * @param {...any} args - Additional arguments
   * @returns {number} Timer ID
   */
  setInterval(callback, interval, ...args) {
    return this.addTimer(setInterval, callback, interval, ...args);
  }

  /**
   * Add an observer that will be automatically disconnected
   * @param {object} observer - Observer instance (IntersectionObserver, MutationObserver, etc.)
   * @returns {object} The observer instance
   */
  addObserver(observer) {
    if (observer && typeof observer.disconnect === 'function') {
      this.observers.add(observer);
    }
    return observer;
  }

  /**
   * Add an AbortController that will be automatically aborted
   * @param {AbortController} controller - AbortController instance
   * @returns {AbortController} The controller instance
   */
  addAbortController(controller) {
    if (controller && typeof controller.abort === 'function') {
      this.abortControllers.add(controller);
    }
    return controller;
  }

  /**
   * Add a custom cleanup function
   * @param {Function} cleanupFunction - Function to call during cleanup
   */
  addCleanupCallback(cleanupFunction) {
    if (typeof cleanupFunction === 'function') {
      this.cleanupCallbacks.add(cleanupFunction);
    }
  }

  /**
   * Remove a specific timer
   * @param {number} timerId - Timer ID to remove
   */
  removeTimer(timerId) {
    for (const timer of this.timers) {
      if (timer.id === timerId) {
        if (timer.type === 'setTimeout') {
          clearTimeout(timerId);
        } else {
          clearInterval(timerId);
        }
        this.timers.delete(timer);
        break;
      }
    }
  }

  /**
   * Clean up all managed resources
   */
  cleanup() {
    // Clean up event listeners
    for (const { target, eventType, handler, options } of this.eventListeners) {
      try {
        target.removeEventListener(eventType, handler, options);
      } catch (error) {
        logger.warn('CleanupManager: Error removing event listener:', error);
      }
    }
    this.eventListeners.clear();

    // Clean up timers
    for (const timer of this.timers) {
      try {
        if (timer.type === 'setTimeout') {
          clearTimeout(timer.id);
        } else {
          clearInterval(timer.id);
        }
      } catch (error) {
        logger.warn('CleanupManager: Error clearing timer:', error);
      }
    }
    this.timers.clear();

    // Clean up observers
    for (const observer of this.observers) {
      try {
        observer.disconnect();
      } catch (error) {
        logger.warn('CleanupManager: Error disconnecting observer:', error);
      }
    }
    this.observers.clear();

    // Clean up abort controllers
    for (const controller of this.abortControllers) {
      try {
        controller.abort();
      } catch (error) {
        logger.warn('CleanupManager: Error aborting controller:', error);
      }
    }
    this.abortControllers.clear();

    // Execute custom cleanup callbacks
    for (const cleanupFunction of this.cleanupCallbacks) {
      try {
        cleanupFunction();
      } catch (error) {
        logger.warn('CleanupManager: Error in cleanup callback:', error);
      }
    }
    this.cleanupCallbacks.clear();
  }

  /**
   * Get statistics about managed resources
   * @returns {object} Resource counts
   */
  getStats() {
    return {
      eventListeners: this.eventListeners.size,
      timers: this.timers.size,
      observers: this.observers.size,
      abortControllers: this.abortControllers.size,
      cleanupCallbacks: this.cleanupCallbacks.size
    };
  }
}

/**
 * Global cleanup manager instance for page-level cleanup
 */
export const globalCleanupManager = new CleanupManager();

// Automatically cleanup on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    globalCleanupManager.cleanup();
  });

  // Also cleanup on page hide (for mobile/background behavior)
  window.addEventListener('pagehide', () => {
    globalCleanupManager.cleanup();
  });
}

/**
 * Throttle function that integrates with CleanupManager
 * @param {Function} func - Function to throttle
 * @param {number} limit - Throttle limit in milliseconds
 * @param {CleanupManager} cleanupManager - Optional cleanup manager
 * @returns {Function} Throttled function
 */
export function throttle(func, limit, cleanupManager = null) {
  let inThrottle = false;
  let timerId = null;

  const throttled = (...args) => {
    if (!inThrottle) {
      func.apply(this, args); // eslint-disable-line no-invalid-this
      inThrottle = true;
      timerId = setTimeout(() => {
        inThrottle = false;
        timerId = null;
      }, limit);

      if (cleanupManager) {
        cleanupManager.addTimer(setTimeout, () => {}, limit);
      }
    }
  };

  // Add cleanup for the throttled function
  throttled.cleanup = () => {
    if (timerId) {
      clearTimeout(timerId);
      timerId = null;
    }
    inThrottle = false;
  };

  return throttled;
}

/**
 * Debounce function that integrates with CleanupManager
 * @param {Function} func - Function to debounce
 * @param {number} delay - Debounce delay in milliseconds
 * @param {CleanupManager} cleanupManager - Optional cleanup manager
 * @returns {Function} Debounced function
 */
export function debounce(func, delay, cleanupManager = null) {
  let timerId = null;

  const debounced = (...args) => {
    if (timerId) {
      clearTimeout(timerId);
    }

    timerId = setTimeout(() => {
      func.apply(this, args); // eslint-disable-line no-invalid-this
      timerId = null;
    }, delay);

    if (cleanupManager) {
      cleanupManager.addTimer(setTimeout, () => {}, delay);
    }
  };

  // Add cleanup for the debounced function
  debounced.cleanup = () => {
    if (timerId) {
      clearTimeout(timerId);
      timerId = null;
    }
  };

  return debounced;
}
