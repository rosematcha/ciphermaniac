/**
 * GET /api/admin/accounts?popId= | ?email= | ?id= — an Admin looks up
 * accounts by one of these, matched exactly, to settle a POP ID dispute.
 * Each is an index lookup. Answers { accounts }, empty when none match.
 */

import { readAccountRole } from '../../../shared/accounts/roles.js';
import type { FoundAccount } from '../../../shared/accounts/types.js';
import { jsonError } from '../../lib/api/responses.js';
import { openForAdmin } from '../../lib/auth/admin.js';
import type { Context } from '../../lib/auth/env.js';
import { privateJson } from '../../lib/tournaments/access.js';

/** What may be looked up by, each the column an index keeps. */
const COLUMNS = { popId: 'pop_id', email: 'email', id: 'id' } as const;

interface FoundRow {
  id: string;
  name: string;
  email: string | null;
  pop_id: string | null;
  role: string | null;
  created_at: number;
}

const foundOf = (row: FoundRow): FoundAccount => ({
  id: row.id,
  name: row.name,
  email: row.email,
  popId: row.pop_id,
  role: readAccountRole(row.role),
  createdAt: row.created_at
});

/** The column and value the query looks up by; null when it names none. */
function lookupOf(url: URL): { column: string; value: string } | null {
  for (const [name, column] of Object.entries(COLUMNS)) {
    const value = url.searchParams.get(name)?.trim();
    if (value) {
      return { column, value };
    }
  }
  return null;
}

export async function onRequestGet(context: Context): Promise<Response> {
  const access = await openForAdmin(context);
  if (access instanceof Response) {
    return access;
  }
  const lookup = lookupOf(new URL(context.request.url));
  if (!lookup) {
    return jsonError('Look up by POP ID, email or account ID', 400);
  }
  // Nothing makes an email unique, so a lookup may find more than one; a handful at most.
  const { results } = await access.db
    .prepare(`SELECT id, name, email, pop_id, role, created_at FROM users WHERE ${lookup.column} = ? LIMIT 20`)
    .bind(lookup.value)
    .all<FoundRow>();
  return privateJson({ accounts: results.map(foundOf) });
}
