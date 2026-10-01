/**
 * POST /api/tournaments/:code/pairing — a TOM-run event's next round, paired
 * on the site: { pod, base, localTime }, where `base` is the revision of the
 * file the organizer's browser last synced (see sync.ts). The answer is the
 * event with the round in it ({ tournament }), for the browser to write into
 * TOM's file; nothing changes here until that file syncs (see tomNextRound).
 * A browser whose file is not the copy the site holds is refused, so a round
 * is only ever paired over the file it goes into.
 */

import { readCommand } from '../../../../shared/tournament/readCommand.js';
import { revisionOf } from '../../../../shared/tournament/revision.js';
import { readJsonObject } from '../../../lib/api/body.js';
import { jsonError } from '../../../lib/api/responses.js';
import type { Context } from '../../../lib/auth/env.js';
import { openForStaff, privateJson } from '../../../lib/tournaments/access.js';
import { settled } from '../../../lib/tournaments/answers.js';
import { tomNextRound } from '../../../lib/tournaments/results.js';

export async function onRequestPost(context: Context<'code'>): Promise<Response> {
  const access = await openForStaff(context);
  if (access instanceof Response) {
    return access;
  }
  if (access.row.mode !== 'tom') {
    return jsonError('This event is run on the site, not in TOM', 400);
  }
  const value = (await readJsonObject(context.request, 1024)) ?? {};
  const command = readCommand({ type: 'pairRound', pod: value.pod });
  if (command?.type !== 'pairRound' || typeof value.base !== 'string') {
    return jsonError('Not a round to pair', 400);
  }
  // Results the players' reports have settled count, as they would for any command.
  const row = await settled(context, access, value.localTime);
  if ((await revisionOf(row.tournament)) !== value.base) {
    return jsonError('The site has a different copy of this event. Reconnect the file TOM is using.', 409);
  }
  const tournament = tomNextRound(row, command.pod, value.localTime);
  return typeof tournament === 'string' ? jsonError(tournament, 400) : privateJson({ tournament });
}
