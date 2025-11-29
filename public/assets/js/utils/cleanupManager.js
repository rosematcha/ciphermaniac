/**
 * Memory leak prevention utility for managing event listeners and cleanup
 * @module utils/cleanupManager
 */
import { logger } from './logger.js';
/**
 * CleanupManager handles automatic cleanup of event listeners, timers, and other resources
 * to prevent memory leaks in long-running applications
 */
export class CleanupManager {
    eventListeners;
    timers;
    observers;
    abortControllers;
    cleanupCallbacks;
    constructor() {
        this.eventListeners = new Set();
        this.timers = new Set();
        this.observers = new Set();
        this.abortControllers = new Set();
        this.cleanupCallbacks = new Set();
    }
    /**
     * Add an event listener that will be automatically cleaned up
     * @param target - Element to attach listener to
     * @param eventType - Event type to listen for
     * @param handler - Event handler function
     * @param options - Event listener options
     * @returns Cleanup function for this specific listener
     */
    addEventListener(target, eventType, handler, options = false) {
        if (!target || typeof target.addEventListener !== 'function') {
            logger.warn('CleanupManager: Invalid event target provided');
            return () => { };
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
     * @param timerFunction - setTimeout or setInterval
     * @param callback - Timer callback
     * @param delay - Timer delay
     * @param args - Additional timer arguments
     * @returns Timer ID
     */
    addTimer(timerFunction, callback, delay, ...args) {
        const timerId = timerFunction(callback, delay, ...args);
        this.timers.add({ id: timerId, type: timerFunction.name });
        return timerId;
    }
    /**
     * Add a setTimeout that will be automatically cleared
     * @param callback - Callback function
     * @param delay - Delay in milliseconds
     * @param args - Additional arguments
     * @returns Timer ID
     */
    setTimeout(callback, delay, ...args) {
        return this.addTimer(setTimeout, callback, delay, ...args);
    }
    /**
     * Add a setInterval that will be automatically cleared
     * @param callback - Callback function
     * @param interval - Interval in milliseconds
     * @param args - Additional arguments
     * @returns Timer ID
     */
    setInterval(callback, interval, ...args) {
        return this.addTimer(setInterval, callback, interval, ...args);
    }
    /**
     * Add an observer that will be automatically disconnected
     * @param observer - Observer instance (IntersectionObserver, MutationObserver, etc.)
     * @returns The observer instance
     */
    addObserver(observer) {
        if (observer && typeof observer.disconnect === 'function') {
            this.observers.add(observer);
        }
        return observer;
    }
    /**
     * Add an AbortController that will be automatically aborted
     * @param controller - AbortController instance
     * @returns The controller instance
     */
    addAbortController(controller) {
        if (controller && typeof controller.abort === 'function') {
            this.abortControllers.add(controller);
        }
        return controller;
    }
    /**
     * Add a custom cleanup function
     * @param cleanupFunction - Function to call during cleanup
     */
    addCleanupCallback(cleanupFunction) {
        if (typeof cleanupFunction === 'function') {
            this.cleanupCallbacks.add(cleanupFunction);
        }
    }
    /**
     * Remove a specific timer
     * @param timerId - Timer ID to remove
     */
    removeTimer(timerId) {
        for (const timer of this.timers) {
            if (timer.id === timerId) {
                if (timer.type === 'setTimeout') {
                    clearTimeout(timerId);
                }
                else {
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
            }
            catch (error) {
                logger.warn('CleanupManager: Error removing event listener:', error);
            }
        }
        this.eventListeners.clear();
        // Clean up timers
        for (const timer of this.timers) {
            try {
                if (timer.type === 'setTimeout') {
                    clearTimeout(timer.id);
                }
                else {
                    clearInterval(timer.id);
                }
            }
            catch (error) {
                logger.warn('CleanupManager: Error clearing timer:', error);
            }
        }
        this.timers.clear();
        // Clean up observers
        for (const observer of this.observers) {
            try {
                observer.disconnect();
            }
            catch (error) {
                logger.warn('CleanupManager: Error disconnecting observer:', error);
            }
        }
        this.observers.clear();
        // Clean up abort controllers
        for (const controller of this.abortControllers) {
            try {
                controller.abort();
            }
            catch (error) {
                logger.warn('CleanupManager: Error aborting controller:', error);
            }
        }
        this.abortControllers.clear();
        // Execute custom cleanup callbacks
        for (const cleanupFunction of this.cleanupCallbacks) {
            try {
                cleanupFunction();
            }
            catch (error) {
                logger.warn('CleanupManager: Error in cleanup callback:', error);
            }
        }
        this.cleanupCallbacks.clear();
    }
    /**
     * Get statistics about managed resources
     * @returns Resource counts
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
 * @param func - Function to throttle
 * @param limit - Throttle limit in milliseconds
 * @param cleanupManager - Optional cleanup manager
 * @returns Throttled function
 */
export function throttle(func, limit, cleanupManager = null) {
    let inThrottle = false;
    let timerId = null;
    const throttled = function (...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            timerId = window.setTimeout(() => {
                inThrottle = false;
                timerId = null;
            }, limit);
            if (cleanupManager) {
                cleanupManager.addTimer(setTimeout, () => { }, limit);
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
 * @param func - Function to debounce
 * @param delay - Debounce delay in milliseconds
 * @param cleanupManager - Optional cleanup manager
 * @returns Debounced function
 */
export function debounce(func, delay, cleanupManager = null) {
    let timerId = null;
    const debounced = function (...args) {
        if (timerId) {
            clearTimeout(timerId);
        }
        timerId = window.setTimeout(() => {
            func.apply(this, args);
            timerId = null;
        }, delay);
        if (cleanupManager) {
            cleanupManager.addTimer(setTimeout, () => { }, delay);
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
