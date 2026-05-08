/**
 * Main application entry point
 * @module Main
 *
 * Delegates to src/main/page.ts for bootstrap logic.
 * Structured as src/main/{state,data,render,page}.ts.
 */

export type { AppState } from './main/state.js';
export { appState } from './main/state.js';

// Side-effect import: runs the page bootstrap (DOMContentLoaded / init)
import './main/page.js';
