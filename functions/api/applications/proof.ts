/**
 * PUT /api/applications/proof — uploads the proof of organizer certification
 * an Application will carry, as the raw file (no form encoding). Its type is
 * told from its first bytes, never from its name or the type the browser
 * sends: a PNG, JPEG, WebP or PDF up to 8 MB. It goes in the account's one
 * slot, over any proof uploaded before, and answers { proof: { type, size } }.
 * Only an account that may apply uploads, and not while an Application is
 * pending.
 * DELETE /api/applications/proof — empties the slot, unless an Application
 * pending carries it.
 */

import { PROOF_MAX_BYTES } from '../../../shared/accounts/applications.js';
import {
  type Applicant,
  applyRefusal,
  isPending,
  openApplicant,
  pendingRefusal,
  proofKey
} from '../../lib/accounts/applications.js';
import { type BytesBody, type ProofType, readBoundedBytes, sniffProofType } from '../../lib/api/bytes.js';
import { createRateLimiter } from '../../lib/api/rateLimiter.js';
import { jsonError, noContent } from '../../lib/api/responses.js';
import type { Context } from '../../lib/auth/env.js';
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
  await bucket.put(proofKey(applicant.user.id), proof.bytes, { httpMetadata: { contentType: proof.type } });
  return privateJson({ proof: { type: proof.type, size: proof.bytes.byteLength } });
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
  await bucket.delete(proofKey(applicant.user.id));
  return noContent();
}
