/**
 * GET /api/admin/applications/:id/proof — the proof an Application carries,
 * streamed from the private bucket to an Admin and to no one else; there is
 * no public or signed address for it. The type is the one told from the
 * file's bytes at upload. An image shows inline, for the admin page's <img>;
 * a PDF comes as a download, never drawn on the site's own origin. The file
 * name is the server's, never the uploader's. Nothing caches it, nothing
 * sniffs it as anything else, and opened on its own it runs nothing.
 */

import { jsonError } from '../../../../lib/api/responses.js';
import type { ProofType } from '../../../../lib/api/bytes.js';
import { openForAdmin } from '../../../../lib/auth/admin.js';
import { type Context, param } from '../../../../lib/auth/env.js';

const EXTENSIONS: Record<ProofType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/pdf': 'pdf'
};

/** The headers a proof goes out with; a type that is not a proof's goes as bytes to download. */
function proofHeaders(stored: string | undefined): Record<string, string> {
  const type = stored && Object.hasOwn(EXTENSIONS, stored) ? (stored as ProofType) : null;
  const disposition = type?.startsWith('image/') ? 'inline' : 'attachment';
  return {
    'Content-Type': type ?? 'application/octet-stream',
    'Content-Disposition': `${disposition}; filename="proof.${type ? EXTENSIONS[type] : 'bin'}"`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'X-Robots-Tag': 'noindex'
  };
}

export async function onRequestGet(context: Context<'id'>): Promise<Response> {
  const access = await openForAdmin(context);
  if (access instanceof Response) {
    return access;
  }
  const bucket = context.env.PROOFS;
  if (!bucket) {
    return jsonError('Proofs are not available', 503);
  }
  const row = await access.db
    .prepare('SELECT proof_key FROM applications WHERE id = ?')
    .bind(param(context.params.id))
    .first<{ proof_key: string | null }>();
  const object = row?.proof_key ? await bucket.get(row.proof_key) : null;
  if (!object) {
    return jsonError('No proof', 404);
  }
  return new Response(object.body, { headers: proofHeaders(object.httpMetadata?.contentType) });
}
