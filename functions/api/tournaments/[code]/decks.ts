/**
 * PUT /api/tournaments/:code/decks — staff set the archetype a player is on
 * ({ playerId, archetype }, a null archetype clearing it). It feeds the deck
 * column and the event's deck breakdown, shown as the visibility setting allows.
 */

import { readJsonBody } from '../../../lib/api/body.js';
import { jsonError } from '../../../lib/api/responses.js';
import type { Context } from '../../../lib/auth/env.js';
import { manageView, openForStaff, privateJson } from '../../../lib/tournaments/access.js';
import { archetypeLabel, withDeck } from '../../../lib/tournaments/decks.js';
import { publishAfter } from '../../../lib/tournaments/publish.js';
import { mutate } from '../../../lib/tournaments/store.js';

export async function onRequestPut(context: Context<'code'>): Promise<Response> {
  const access = await openForStaff(context);
  if (access instanceof Response) {
    return access;
  }
  const body = await readJsonBody(context.request, 1024);
  const value = body.ok && typeof body.value === 'object' && body.value ? (body.value as Record<string, unknown>) : {};
  const label = archetypeLabel(value.archetype);
  const playerId = typeof value.playerId === 'string' ? value.playerId : '';
  if (label === undefined || !access.row.tournament.players.some(player => player.id === playerId)) {
    return jsonError('Not a deck change', 400);
  }
  const outcome = await mutate(access.db, access.row, row => ({ decks: withDeck(row.decks, playerId, label) }));
  if ('error' in outcome) {
    return jsonError(outcome.error, outcome.status);
  }
  await publishAfter(context, outcome.row);
  return privateJson(manageView({ ...access, row: outcome.row }));
}
