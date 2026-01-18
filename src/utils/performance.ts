/* eslint-disable no-invalid-this */
/**
 * Performance and utility functions
 * @module Utils
 */

import { AppError, ErrorTypes } from './errorHandler.js';
import { logger } from './logger.js';
import { CONFIG } from '../config.js';

/**
 * Debounce function calls to improve performance
 * @param func - Function to debounce
 * @param wait - Wait time in milliseconds
 * @param immediate - Whether to execute immediately on first call
 * @returns Debounced function
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number = CONFIG.UI.DEBOUNCE_MS,
  immediate: boolean = false
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null;
  return function executedFunction(this: any, ...args: Parameters<T>): void {
    const later = (): void => {
      timeout = null;
      if (!immediate) {
        func.apply(this, args);
      }
    };
    const callNow = immediate && !timeout;
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(later, wait);
    if (callNow) {
      func.apply(this, args);
    }
  };
}

/**
 * Throttle function calls to limit execution frequency
 * @param func - Function to throttle
 * @param limit - Maximum execution frequency in milliseconds
 * @returns Throttled function
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number = CONFIG.UI.DEBOUNCE_MS
): (...args: Parameters<T>) => void {
  let inThrottle: boolean;
  return function (this: any, ...args: Parameters<T>): void {
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
  private cleanupFunctions: Set<() => void>;

  constructor() {
    this.cleanupFunctions = new Set();
  }

  /**
   * Add a cleanup function
   * @param cleanup
   */
  add(cleanup: () => void): void {
    this.cleanupFunctions.add(cleanup);
  }

  /**
   * Add an event listener with automatic cleanup
   * @param target
   * @param event
   * @param listener
   * @param options
   */
  addEventListener(
    target: EventTarget,
    event: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void {
    target.addEventListener(event, listener, options);
    this.add(() => target.removeEventListener(event, listener, options));
  }

  /**
   * Execute all cleanup functions
   */
  cleanup(): void {
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
  private marks: Map<string, number>;

  constructor() {
    this.marks = new Map();
  }

  /**
   * Start timing an operation
   * @param name
   */
  start(name: string): void {
    if (CONFIG.DEV.ENABLE_PERF_MONITORING) {
      this.marks.set(name, performance.now());
    }
  }

  /**
   * End timing and log the result
   * @param name
   */
  end(name: string): void {
    if (CONFIG.DEV.ENABLE_PERF_MONITORING) {
      const startTime = this.marks.get(name);
      if (startTime !== undefined) {
        const duration = performance.now() - startTime;
        logger.info(`⚡ Performance: ${name} took ${duration.toFixed(2)}ms`);
        this.marks.delete(name);
      }
    }
  }
}

// Create global performance monitor
export const perf = new PerformanceMonitor();

/**
 * Wrap a function to automatically measure its execution time
 * @param fn - Function to measure
 * @param name - Name for the performance mark (defaults to function name)
 * @returns Wrapped function that logs execution time
 * @example
 * // Wrap a synchronous function
 * const measuredSort = measureFunction(sortData, 'sortData');
 * measuredSort(data); // Logs: "Performance: sortData took 15.42ms"
 * @example
 * // Wrap an async function
 * const measuredFetch = measureFunction(fetchCards);
 * await measuredFetch(); // Logs execution time after promise resolves
 */
export function measureFunction<T extends (...args: any[]) => any>(
  fn: T,
  name?: string
): (...args: Parameters<T>) => ReturnType<T> {
  const measureName = name || fn.name || 'anonymous';
  return function (this: any, ...args: Parameters<T>): ReturnType<T> {
    perf.start(measureName);
    try {
      const result = fn.apply(this, args);
      // Handle async functions
      if (result instanceof Promise) {
        return result.finally(() => perf.end(measureName)) as ReturnType<T>;
      }
      perf.end(measureName);
      return result;
    } catch (error) {
      perf.end(measureName);
      throw error;
    }
  };
}

/**
 * Decorator to measure async function execution time
 * @param name - Optional custom name for the measurement
 * @example
 * // Use as method decorator
 * class DataProcessor {
 *   // Using measure decorator
 *   processData(data: any[]) {
 *     // Logs: "Performance: DataProcessor.processData took 25.13ms"
 *     return data.map(item => transform(item));
 *   }
 *
 *   // Using measure decorator with custom name
 *   async fetchAndProcess() {
 *     // Logs: "Performance: custom-name took 102.45ms"
 *     const data = await fetch('/api/data');
 *     return this.processData(data);
 *   }
 * }
 */
export function measure(name?: string) {
  return function <T extends (...args: any[]) => any>(
    target: any,
    propertyKey: string,
    descriptor: TypedPropertyDescriptor<T>
  ): TypedPropertyDescriptor<T> {
    const originalMethod = descriptor.value;
    if (!originalMethod) {
      return descriptor;
    }
    const measureName = name || `${target.constructor?.name}.${propertyKey}`;
    const wrappedMethod = function (this: any, ...args: Parameters<T>): ReturnType<T> {
      perf.start(measureName);
      try {
        const result = originalMethod.apply(this, args);
        if (result instanceof Promise) {
          return result.finally(() => perf.end(measureName)) as ReturnType<T>;
        }
        perf.end(measureName);
        return result;
      } catch (error) {
        perf.end(measureName);
        throw error;
      }
    } as T;
    return { ...descriptor, value: wrappedMethod };
  };
}

/**
 * Validate HTML elements exist
 * @param selectors - Object mapping names to CSS selectors
 * @param context - Context for error reporting
 * @returns Object mapping names to elements
 * @throws {Error} If required elements are missing
 */
export function validateElements(selectors: Record<string, string>, context: string = 'page'): Record<string, Element> {
  const elements: Record<string, Element> = {};
  const missing: string[] = [];

  Object.entries(selectors).forEach(([name, selector]) => {
    const element = document.querySelector(selector);
    if (element) {
      elements[name] = element;
    } else {
      missing.push(`${name} (${selector})`);
    }
  });

  if (missing.length > 0) {
    throw new AppError(ErrorTypes.RENDER, `Missing required elements in ${context}: ${missing.join(', ')}`);
  }

  return elements;
}
