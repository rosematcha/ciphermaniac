/**
 * POST /api/applications — sends the signed-in account's Application for a
 * store: { store, explanation?, proof? }, where `store` is what the
 * applicant says of it (shared/accounts/stores.ts StoreApplication: its
 * league, details, time zone, how they run it, their confirmation that they
 * are a certified organizer or work with one, and league nights), and
 * `proof` says to send the certificate the account has uploaded (PUT
 * /api/applications/proof uploads it); neither proof nor note is needed. The
 * account's POP ID and name go with it as they stand now. Answers 201 {
 * application }. One Application is pending at a time; a rejected account
 * may send another at once.
 */

import { EXPLANATION_MAX } from '../../../shared/accounts/applications.js';
import { readStoreApplication, type StoreApplication } from '../../../shared/accounts/stores.js';
import type { MyApplication } from '../../../shared/accounts/types.js';
import {
  type Applicant,
  APPLICATION_COLUMNS,
  type ApplicationRow,
  applyRefusal,
  dropProof,
  heldUpload,
  myApplication,
  openApplicant
} from '../../lib/accounts/applications.js';
import { readJsonObject } from '../../lib/api/body.js';
import { createRateLimiter } from '../../lib/api/rateLimiter.js';
import { jsonError } from '../../lib/api/responses.js';
import type { Context } from '../../lib/auth/env.js';
import { randomToken } from '../../lib/auth/session.js';
import { firstRow } from '../../lib/d1.js';
import { privateJson } from '../../lib/tournaments/access.js';

const rateLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, maxRequests: 10 });

/** @internal exposed for tests */
export function _resetRateLimitStore(): void {
  rateLimiter.reset();
}

interface Asked {
  store: StoreApplication;
  explanation: string;
  proof: boolean;
}

/** What the account asks to send, or why it cannot be sent. */
function readAsked(body: Record<string, unknown> | null): Asked | string {
  const explanation = typeof body?.explanation === 'string' ? body.explanation.trim() : '';
  if (explanation.length > EXPLANATION_MAX) {
    return `Up to ${EXPLANATION_MAX} characters`;
  }
  const store = readStoreApplication(body?.store);
  return typeof store === 'string' ? store : { store, explanation, proof: body?.proof === true };
}

/**
 * Stores the Application, answering it as stored and the key of an upload
 * it left out; null when the account no longer stands as it was read (its
 * role or profile changed since, or the upload asked for is gone), or
 * another Application is pending, which the unique index on pending ones
 * decides. The POP ID and name are the account row's as the Application
 * lands, guarded on the values the eligibility check read, and its proof is
 * the upload the account holds then, which becomes the Application's.
 */
async function send(
  { db, user }: Applicant,
  asked: Asked
): Promise<{ application: MyApplication; leftOut: string | null } | null> {
  const id = randomToken(12);
  const [held, , , stored] = await db.batch([
    heldUpload(db, user.id),
    db
      .prepare(
        'INSERT OR IGNORE INTO applications (id, user_id, status, pop_id, first_name, last_name, explanation, ' +
          "proof_key, proof_type, proof_size, created_at, store) SELECT ?1, u.id, 'pending', u.pop_id, u.first_name, " +
          'u.last_name, ?3, p.key, p.type, p.size, ?4, ?10 FROM users u LEFT JOIN proof_uploads p ON p.user_id = u.id ' +
          'AND ?5 WHERE u.id = ?2 AND u.pop_id IS ?6 ' +
          'AND u.first_name IS ?7 AND u.last_name IS ?8 AND u.birth_date IS ?9 AND (?5 = 0 OR p.key IS NOT NULL)'
      )
      .bind(
        id,
        user.id,
        asked.explanation,
        Date.now(),
        asked.proof ? 1 : 0,
        user.popId,
        user.firstName,
        user.lastName,
        user.birthDate,
        JSON.stringify(asked.store)
      ),
    // Sent, the upload is the Application's, or left out of it.
    db
      .prepare('DELETE FROM proof_uploads WHERE EXISTS (SELECT 1 FROM applications WHERE id = ?1) AND user_id = ?2')
      .bind(id, user.id),
    db.prepare(`SELECT ${APPLICATION_COLUMNS} FROM applications a WHERE a.id = ?`).bind(id)
  ]);
  const row = firstRow<ApplicationRow>(stored);
  const heldKey = firstRow<{ key: string }>(held)?.key ?? null;
  return row && { application: myApplication(row), leftOut: asked.proof ? null : heldKey };
}

/**
 * A send lost to a change to the account, or to another Application, is
 * checked again against the account as it is now; this many tries lets the
 * account's own edits through in turn.
 */
const MAX_TRIES = 3;

/** The answer to the send, or null when it was lost to a change since `applicant` was read. */
async function attempt(context: Context, applicant: Applicant, asked: Asked): Promise<Response | null> {
  const refusal = applyRefusal(applicant);
  if (refusal) {
    return refusal;
  }
  if (asked.proof && !applicant.upload) {
    return jsonError('Upload the proof first', 400);
  }
  const sent = await send(applicant, asked);
  // Sent without proof: a file uploaded and left out goes.
  await dropProof(context, sent?.leftOut);
  return sent && privateJson({ application: sent.application }, 201);
}

export async function onRequestPost(context: Context): Promise<Response> {
  if (!rateLimiter.check(context.request.headers.get('CF-Connecting-IP') ?? 'unknown').allowed) {
    return jsonError('Too many applications from here. Try again later.', 429);
  }
  let applicant = await openApplicant(context);
  if (applicant instanceof Response) {
    return applicant;
  }
  const refusal = applyRefusal(applicant);
  if (refusal) {
    return refusal;
  }
  const asked = readAsked(await readJsonObject(context.request, 16 * 1024));
  if (typeof asked === 'string') {
    return jsonError(asked, 400);
  }
  for (let tries = 1; ; tries += 1) {
    const answer = await attempt(context, applicant, asked);
    if (answer || tries === MAX_TRIES) {
      return answer ?? jsonError('Busy; try again', 409);
    }
    applicant = await openApplicant(context);
    if (applicant instanceof Response) {
      return applicant;
    }
  }
}
