/**
 * Reading a JSON request body under a hard byte ceiling.
 *
 * The body is counted in BYTES as it streams in (see bytes.ts), never as
 * text: `text.length` counts UTF-16 code units, which UNDER-count UTF-8 by up
 * to 3x for non-Latin scripts (so an oversized multi-byte body would slip
 * through), and `request.text()` on a chunked body with no honest
 * Content-Length buffers without bound before any check can reject it.
 */

import { readBoundedBytes } from './bytes.js';

/** A parsed body, or why there isn't one. */
export type JsonBody = { ok: true; value: unknown } | { ok: false; reason: 'too-large' | 'unparseable' };

/**
 * Parse a request's JSON body, refusing anything over `maxBytes`. An empty
 * body, a failed read and malformed JSON are all `unparseable`.
 */
export async function readJsonBody(request: Request, maxBytes: number): Promise<JsonBody> {
  const body = await readBoundedBytes(request, maxBytes);
  if (!body.ok) {
    return { ok: false, reason: body.reason === 'too-large' ? 'too-large' : 'unparseable' };
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(body.bytes)) as unknown };
  } catch {
    return { ok: false, reason: 'unparseable' };
  }
}

/** A parsed value as an object to read fields from; null for anything else. */
export function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

/** A request's JSON body as an object to read fields from; null when it is too large, not JSON or not an object. */
export async function readJsonObject(request: Request, maxBytes: number): Promise<Record<string, unknown> | null> {
  const body = await readJsonBody(request, maxBytes);
  return body.ok ? asObject(body.value) : null;
}
