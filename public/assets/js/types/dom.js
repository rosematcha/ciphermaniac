/* eslint-disable jsdoc/no-undefined-types */
/**
 * Common DOM/Fetch type shims for JSDoc (helps eslint jsdoc plugin)
 * These are intentionally lightweight and describe the shape used in this codebase.
 */

/**
 * @typedef {(evt: Event) => any} Dom_EventListener
 */

/**
 * An object with a handleEvent method or a function
 * @typedef {{handleEvent: (evt: Event) => any}|Dom_EventListener} Dom_EventListenerOrEventListenerObject
 */

/**
 * @typedef {{capture?: boolean, once?: boolean, passive?: boolean}|boolean} Dom_AddEventListenerOptions
 */

/**
 * Minimal RequestInit shape for fetch options used in the repo
 * @typedef {{method?: string, headers?: object, body?: any, signal?: AbortSignal}} Dom_RequestInit
 */

/* eslint-enable jsdoc/no-undefined-types */
