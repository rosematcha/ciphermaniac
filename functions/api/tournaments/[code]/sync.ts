/**
 * PUT /api/tournaments/:code/sync — the latest .tdf of a TOM-run event, as
 * the organizer's browser parsed it.
 *
 * This is the fix for re-uploading: the browser watches the file TOM saves,
 * parses it locally, and sends the result only when it changed. Storing it is
 * one validated write, with nothing to reprocess. Pending results the new
 * file settles are dropped.
 */

import { readTournament } from '../../../../shared/tournament/validate.js';
import { prunePending } from '../../../../shared/tournament/view.js';
import { readJsonBody } from '../../../lib/api/body.js';
import { jsonError } from '../../../lib/api/responses.js';
import type { Context } from '../../../lib/auth/env.js';
import { MAX_TOURNAMENT_BYTES, openForStaff, privateJson } from '../../../lib/tournaments/access.js';
import { publishView } from '../../../lib/tournaments/publish.js';
import { mutate } from '../../../lib/tournaments/store.js';

export async function onRequestPut(context: Context<'code'>): Promise<Response> {
  const access = await openForStaff(context);
  if (access instanceof Response) {
    return access;
  }
  if (access.row.mode !== 'tom') {
    return jsonError('This event is run on the site, not in TOM', 400);
  }
  const body = await readJsonBody(context.request, MAX_TOURNAMENT_BYTES);
  const tournament = body.ok ? readTournament(body.value) : null;
  if (!tournament) {
    return jsonError(
      body.ok ? 'That file did not read as a tournament' : 'That file is too large',
      body.ok ? 400 : 413
    );
  }
  const outcome = await mutate(access.db, access.row, row => ({
    tournament,
    pending: prunePending(tournament, row.pending)
  }));
  if ('error' in outcome) {
    return jsonError(outcome.error, outcome.status);
  }
  await publishView(context.env, outcome.row);
  return privateJson({ version: outcome.version, pending: outcome.row.pending });
}
