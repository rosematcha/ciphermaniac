/**
 * GET /api/stores/:id/listings — the events pokemon.com lists for the
 * store's league from today on, for its staff to start one from
 * ({ listings }; shared/accounts/types.ts Listing). Read from the event
 * locator's files, which a daily run refreshes: an event sanctioned since may
 * not be there yet, and the page offers to enter one by hand.
 */

import { dateIn } from '../../../../shared/accounts/stores.js';
import type { Context } from '../../../lib/auth/env.js';
import { openStore } from '../../../lib/stores/access.js';
import { leagueListings } from '../../../lib/stores/leagues.js';
import { privateJson } from '../../../lib/tournaments/access.js';

export async function onRequestGet(context: Context<'id'>): Promise<Response> {
  const access = await openStore(context, 'member');
  if (access instanceof Response) {
    return access;
  }
  const { store } = access;
  const today = dateIn(store.timeZone, Date.now());
  return privateJson({ listings: await leagueListings(context.env.REPORTS, store.leagueId, today) });
}
