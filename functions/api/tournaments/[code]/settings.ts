/** PUT /api/tournaments/:code/settings — staff change the event's settings (see TournamentSettings). */

import { readSettings } from '../../../../shared/tournament/view.js';
import { readJsonBody } from '../../../lib/api/body.js';
import { jsonError } from '../../../lib/api/responses.js';
import type { Context } from '../../../lib/auth/env.js';
import { manageView, openForStaff, privateJson } from '../../../lib/tournaments/access.js';
import { publishView } from '../../../lib/tournaments/publish.js';
import { mutate } from '../../../lib/tournaments/store.js';

export async function onRequestPut(context: Context<'code'>): Promise<Response> {
  const access = await openForStaff(context);
  if (access instanceof Response) {
    return access;
  }
  const body = await readJsonBody(context.request, 4096);
  if (!body.ok || readSettings(body.value, access.row.settings) === null) {
    return jsonError('Not a settings change', 400);
  }
  const outcome = await mutate(access.db, access.row.code, row => {
    const settings = readSettings(body.value, row.settings);
    return settings ? { settings } : 'Not a settings change';
  });
  if ('error' in outcome) {
    return jsonError(outcome.error, outcome.status);
  }
  await publishView(context.env.REPORTS, outcome.row);
  return privateJson(manageView({ ...access, row: outcome.row }));
}
