/**
 * POST /api/applications — sends the signed-in account's Application to run
 * events: { explanation, proof }, where `proof` says to send the file in the
 * account's proof slot (PUT /api/applications/proof uploads it). It needs a
 * proof, an explanation, or both. The account's POP ID and name go with it
 * as they stand now. Answers 201 { application }. One Application is
 * pending at a time; a rejected account may send another at once.
 */

import { EXPLANATION_MAX } from '../../../shared/accounts/applications.js';
import type { MyApplication } from '../../../shared/accounts/types.js';
import {
  type Applicant,
  applyRefusal,
  dropProof,
  type HeldProof,
  openApplicant,
  pendingRefusal,
  proofIn,
  proofKey
} from '../../lib/accounts/applications.js';
import { readJsonObject } from '../../lib/api/body.js';
import { createRateLimiter } from '../../lib/api/rateLimiter.js';
import { jsonError } from '../../lib/api/responses.js';
import type { Context } from '../../lib/auth/env.js';
import { randomToken } from '../../lib/auth/session.js';
import { rowsChanged } from '../../lib/d1.js';
import { privateJson } from '../../lib/tournaments/access.js';

const rateLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, maxRequests: 10 });

/** @internal exposed for tests */
export function _resetRateLimitStore(): void {
  rateLimiter.reset();
}

interface Asked {
  explanation: string;
  proof: boolean;
}

/** What the account asks to send, or why it cannot be sent. */
function readAsked(body: Record<string, unknown> | null): Asked | string {
  const explanation = typeof body?.explanation === 'string' ? body.explanation.trim() : '';
  if (explanation.length > EXPLANATION_MAX) {
    return `Up to ${EXPLANATION_MAX} characters`;
  }
  const proof = body?.proof === true;
  return proof || explanation ? { explanation, proof } : 'Add proof or an explanation';
}

/**
 * Stores the Application, answering it as sent; null when another is
 * pending, which the unique index on pending ones decides.
 */
async function send(applicant: Applicant, asked: Asked, slot: HeldProof | null): Promise<MyApplication | null> {
  const { db, user } = applicant;
  const application: MyApplication = {
    id: randomToken(12),
    status: 'pending',
    explanation: asked.explanation,
    proofType: slot?.type ?? null,
    createdAt: Date.now(),
    decidedAt: null,
    note: null
  };
  const stored = await db
    .prepare(
      'INSERT OR IGNORE INTO applications (id, user_id, status, pop_id, first_name, last_name, explanation, ' +
        "proof_key, proof_type, proof_size, proof_etag, created_at) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(
      application.id,
      user.id,
      user.popId,
      user.firstName,
      user.lastName,
      application.explanation,
      slot ? proofKey(user.id) : null,
      application.proofType,
      slot?.size ?? null,
      slot?.etag ?? null,
      application.createdAt
    )
    .run();
  return rowsChanged(stored) === 1 ? application : null;
}

export async function onRequestPost(context: Context): Promise<Response> {
  if (!rateLimiter.check(context.request.headers.get('CF-Connecting-IP') ?? 'unknown').allowed) {
    return jsonError('Too many applications from here. Try again later.', 429);
  }
  const applicant = await openApplicant(context);
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
  const slot = asked.proof ? await proofIn(context.env.PROOFS, applicant.user.id) : null;
  if (asked.proof && !slot) {
    return jsonError('Upload the proof first', 400);
  }
  const application = await send(applicant, asked, slot);
  if (!application) {
    return pendingRefusal();
  }
  if (!slot) {
    // Sent without proof: a file uploaded and left out goes.
    await dropProof(context, applicant.user.id);
  }
  return privateJson({ application }, 201);
}
