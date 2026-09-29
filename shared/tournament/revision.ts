/**
 * Which copy of a TOM event the site holds, as a short fingerprint of the
 * stored document. The browser following the .tdf sends the revision its last
 * sync left, and the server takes the file only if that is still what it
 * holds: a second browser with an older copy of the file cannot overwrite
 * rounds the first one synced. The console computes the same value from the
 * document it loaded, since JSON read back and written again is unchanged.
 */

import type { Tournament } from './types.js';

export async function revisionOf(tournament: Tournament): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(tournament)));
  return [...new Uint8Array(digest).slice(0, 12)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
