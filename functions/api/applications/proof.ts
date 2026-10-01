/**
 * PUT /api/applications/proof — uploads the proof of organizer certification
 * an Application will carry, as the raw file (no form encoding). Its type is
 * told from its first bytes, never from its name or the type the browser
 * sends: a PNG, JPEG, WebP or PDF up to 8 MB. It takes the place of any
 * proof uploaded before and not sent, which is deleted, and answers
 * { proof: { type, size } }. Only an account that may apply uploads, and not
 * while an Application is pending.
 * DELETE /api/applications/proof — deletes the proof uploaded and not sent.
 */

import { PROOF_MAX_BYTES } from '../../../shared/accounts/applications.js';
import {
  type Applicant,
  applyRefusal,
  dropProof,
  heldUpload,
  isPending,
  newProofKey,
  openApplicant,
  pendingRefusal
} from '../../lib/accounts/applications.js';
import { type BytesBody, type ProofType, readBoundedBytes, sniffProofType } from '../../lib/api/bytes.js';
import { createRateLimiter } from '../../lib/api/rateLimiter.js';
import { jsonError, noContent } from '../../lib/api/responses.js';
import type { Context } from '../../lib/auth/env.js';
import { firstRow, rowsChanged } from '../../lib/d1.js';
import { privateJson } from '../../lib/tournaments/access.js';
import type { ProofBucket } from '../../lib/types.js';

const rateLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, maxRequests: 20 });

/** @internal exposed for tests */
export function _resetRateLimitStore(): void {
  rateLimiter.reset();
}

/** The upload as a proof to keep, or the answer that refuses it. */
function proofOf(body: BytesBody): { bytes: Uint8Array; type: ProofType } | Response {
  if (!body.ok) {
    return body.reason === 'too-large'
      ? jsonError('Up to 8 MB', 413)
      : jsonError('The upload did not come through', 400);
  }
  if (body.bytes.byteLength === 0) {
    return jsonError('The file is empty', 400);
  }
  const type = sniffProofType(body.bytes);
  return type ? { bytes: body.bytes, type } : jsonError('Use a PNG, JPEG, WebP or PDF', 400);
}

/** The bucket and the applicant, or the answer that turns the request away. */
async function openSlot(context: Context): Promise<{ bucket: ProofBucket; applicant: Applicant } | Response> {
  const bucket = context.env.PROOFS;
  if (!bucket) {
    return jsonError('Uploads are not available', 503);
  }
  const applicant = await openApplicant(context);
  return applicant instanceof Response ? applicant : { bucket, applicant };
}

/**
 * Makes the file under `key` the account's upload not yet sent, answering
 * the key of the one it replaces; null, keeping nothing, when an Application
 * has gone pending since the account was read. The read and the write are
 * one transaction, so two uploads at once replace one after the other and
 * each replaced key is answered once.
 */
async function keep(
  { db, user }: Applicant,
  key: string,
  type: ProofType,
  size: number
): Promise<{ replaced: string | null } | null> {
  const [replaced, kept] = await db.batch([
    heldUpload(db, user.id),
    db
      .prepare(
        'INSERT INTO proof_uploads (user_id, key, type, size) SELECT id, ?2, ?3, ?4 FROM users WHERE id = ?1 ' +
          "AND NOT EXISTS (SELECT 1 FROM applications WHERE user_id = ?1 AND status = 'pending') " +
          'ON CONFLICT (user_id) DO UPDATE SET key = excluded.key, type = excluded.type, size = excluded.size'
      )
      .bind(user.id, key, type, size)
  ]);
  return rowsChanged(kept) === 1 ? { replaced: firstRow<{ key: string }>(replaced)?.key ?? null } : null;
}

export async function onRequestPut(context: Context): Promise<Response> {
  if (!rateLimiter.check(context.request.headers.get('CF-Connecting-IP') ?? 'unknown').allowed) {
    return jsonError('Too many uploads from here. Try again later.', 429);
  }
  const opened = await openSlot(context);
  if (opened instanceof Response) {
    return opened;
  }
  const { bucket, applicant } = opened;
  const refusal = applyRefusal(applicant);
  if (refusal) {
    return refusal;
  }
  const proof = proofOf(await readBoundedBytes(context.request, PROOF_MAX_BYTES));
  if (proof instanceof Response) {
    return proof;
  }
  const key = newProofKey(applicant.user.id);
  await bucket.put(key, proof.bytes, { httpMetadata: { contentType: proof.type } });
  const kept = await keep(applicant, key, proof.type, proof.bytes.byteLength);
  // The one it replaces goes; refused, so does this one.
  await dropProof(context, kept ? kept.replaced : key);
  return kept ? privateJson({ proof: { type: proof.type, size: proof.bytes.byteLength } }) : pendingRefusal();
}

export async function onRequestDelete(context: Context): Promise<Response> {
  const opened = await openSlot(context);
  if (opened instanceof Response) {
    return opened;
  }
  const { bucket, applicant } = opened;
  if (isPending(applicant)) {
    return pendingRefusal();
  }
  const { db, user } = applicant;
  const [held] = await db.batch([
    heldUpload(db, user.id),
    db.prepare('DELETE FROM proof_uploads WHERE user_id = ?').bind(user.id)
  ]);
  const key = firstRow<{ key: string }>(held)?.key;
  if (key) {
    await bucket.delete(key);
  }
  return noContent();
}
