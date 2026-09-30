/**
 * PUT /api/tournaments/:code/sync — the latest .tdf of a TOM-run event, as
 * the organizer's browser parsed it: { tournament, base }, where `base` is the
 * revision (shared/tournament/revision.ts) of the copy that browser last sent
 * or loaded.
 *
 * This is the fix for re-uploading: the browser watches the file TOM saves,
 * parses it locally, and sends the result only when it changed. Storing it is
 * one validated write, with nothing to reprocess. Pending results the new
 * file settles are dropped. The answer is the console's new copy of the
 * event, with the revision it now holds, so the console need not ask again. A file sent from a copy the site no longer holds
 * is refused (409) rather than taken over rounds another browser synced; one
 * that is the copy the site already holds changes nothing and succeeds.
 */

import { revisionOf } from '../../../../shared/tournament/revision.js';
import type { Tournament } from '../../../../shared/tournament/types.js';
import { readTournament } from '../../../../shared/tournament/validate.js';
import { prunePending } from '../../../../shared/tournament/view.js';
import { asObject, readJsonBody } from '../../../lib/api/body.js';
import { jsonError } from '../../../lib/api/responses.js';
import type { Context } from '../../../lib/auth/env.js';
import { manageView, MAX_TOURNAMENT_BYTES, openForStaff, privateJson } from '../../../lib/tournaments/access.js';
import { publishAfter } from '../../../lib/tournaments/publish.js';
import { mutate } from '../../../lib/tournaments/store.js';

const CONFLICT = 'The site has a different copy of this event. Reconnect the file TOM is using to replace it.';

interface Upload {
  tournament: Tournament;
  base: string;
}

/** The upload in a request body, or the refusal. */
async function readUpload(request: Request): Promise<Upload | Response> {
  const body = await readJsonBody(request, MAX_TOURNAMENT_BYTES);
  if (!body.ok) {
    return jsonError('That file is too large', 413);
  }
  const value = asObject(body.value) ?? {};
  const tournament = readTournament(value.tournament);
  if (!tournament) {
    return jsonError('That file did not read as a tournament', 400);
  }
  return typeof value.base === 'string' ? { tournament, base: value.base } : jsonError('Reload the page', 400);
}

export async function onRequestPut(context: Context<'code'>): Promise<Response> {
  const access = await openForStaff(context);
  if (access instanceof Response) {
    return access;
  }
  if (access.row.mode !== 'tom') {
    return jsonError('This event is run on the site, not in TOM', 400);
  }
  const upload = await readUpload(context.request);
  if (upload instanceof Response) {
    return upload;
  }
  const held = await revisionOf(access.row.tournament);
  const sent = await revisionOf(upload.tournament);
  // The copy the site already holds, from a second tab or a push that crossed another: nothing to change.
  if (sent === held) {
    return privateJson({ ...manageView(access), revision: held });
  }
  if (held !== upload.base) {
    return jsonError(CONFLICT, 409);
  }
  const { tournament } = upload;
  if (tournament.players.length === 0 && access.row.tournament.players.length > 0) {
    return jsonError('That file has nobody in it; link the file TOM is using', 400);
  }
  // Only a sync changes a TOM event's document, so a retry after another write still finds the one checked.
  const checked = JSON.stringify(access.row.tournament);
  const outcome = await mutate(access.db, access.row, row =>
    row === access.row || JSON.stringify(row.tournament) === checked
      ? { tournament, pending: prunePending(tournament, row.pending) }
      : CONFLICT
  );
  if ('error' in outcome) {
    return jsonError(outcome.error, outcome.error === CONFLICT ? 409 : outcome.status);
  }
  await publishAfter(context, outcome.row);
  return privateJson({ ...manageView({ ...access, row: outcome.row }), revision: sent });
}
