/** The clock and dice a command runs with on the server. */

import type { CommandContext } from '../../../shared/tournament/commands.js';
import { eventSeason, isTomDateTime, tomDateTime } from '../../../shared/tournament/divisions.js';
import { seededRandom } from '../../../shared/tournament/random.js';
import type { Tournament } from '../../../shared/tournament/types.js';

/**
 * TOM writes venue-local times with no zone, and only the browser at the
 * venue knows that zone, so the page sends its own clock reading. Without one
 * the server's UTC stands in.
 */
export function commandContext(tournament: Tournament, localTime: unknown): CommandContext {
  const now = Date.now();
  return {
    now,
    localTime: isTomDateTime(localTime) ? localTime : tomDateTime(new Date(now)),
    season: eventSeason(tournament, new Date(now)),
    random: seededRandom(crypto.getRandomValues(new Uint32Array(1))[0] ?? now)
  };
}
