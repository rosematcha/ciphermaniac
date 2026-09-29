/**
 * PUT /api/tournaments/:code/settings — staff change the event's settings
 * (see TournamentSettings). Showing decks sooner than the event does now is
 * the organizer's call alone: a staff member could otherwise reveal every
 * player's deck mid-event and hide them again.
 */

import { type DeckVisibility, readSettings } from '../../../../shared/tournament/view.js';
import { readJsonBody } from '../../../lib/api/body.js';
import { jsonError } from '../../../lib/api/responses.js';
import type { Context } from '../../../lib/auth/env.js';
import { manageView, openForStaff, privateJson } from '../../../lib/tournaments/access.js';
import { publishView } from '../../../lib/tournaments/publish.js';
import { mutate } from '../../../lib/tournaments/store.js';

/** How soon each setting shows decks to players: higher is sooner. */
const OPENNESS: Record<DeckVisibility, number> = { off: 0, after: 1, always: 2 };

export async function onRequestPut(context: Context<'code'>): Promise<Response> {
  const access = await openForStaff(context);
  if (access instanceof Response) {
    return access;
  }
  const body = await readJsonBody(context.request, 4096);
  const change = body.ok ? body.value : null;
  const next = readSettings(change, access.row.settings);
  if (!next) {
    return jsonError('Not a settings change', 400);
  }
  if (access.role !== 'owner' && OPENNESS[next.deckVisibility] > OPENNESS[access.row.settings.deckVisibility]) {
    return jsonError('Only the organizer can show decks sooner', 403);
  }
  const outcome = await mutate(access.db, access.row, row => {
    const settings = readSettings(change, row.settings);
    return settings ? { settings } : 'Not a settings change';
  });
  if ('error' in outcome) {
    return jsonError(outcome.error, outcome.status);
  }
  await publishView(context.env.REPORTS, outcome.row);
  return privateJson(manageView({ ...access, row: outcome.row }));
}
