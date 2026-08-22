/**
 * Origin serving every R2 asset the browser reads: report JSON, the synonym
 * database, card art, and sprites.
 *
 * `VITE_DATA_ORIGIN` overrides it at build time so the app can be pointed at a
 * fixture server — that is what makes the deterministic browser suite possible
 * (playwright.local.config.ts), and what would let the Lighthouse LCP budget be
 * a gate again instead of a measurement of production CDN cache state. Unset —
 * every real build — it is production R2, exactly as before.
 *
 * Everything that reads from R2 must derive from this. A second hardcoded
 * origin means a fixture build silently reaches production for that one thing.
 */
export const R2_ORIGIN: string = import.meta.env?.VITE_DATA_ORIGIN || 'https://r2.ciphermaniac.com';

// Folder key for the rolling online-meta aggregate. Matches the upstream
// `reports/{name}/` path on R2 exactly, so it doubles as a tournament-list
// entry and a fetch path.
export const ONLINE_META_NAME = 'Online - Last 14 Days';

// Display label for the online meta. Purely cosmetic — the storage key still
// uses the plain string above; nothing parses this label back into a key.
export const ONLINE_META_LABEL = 'Online ladder · last 14 days';
