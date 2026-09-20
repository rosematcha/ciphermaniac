/**
 * Reading a JSON request body under a hard byte ceiling.
 *
 * The body is read as a stream, counting BYTES and bailing the moment the count
 * passes the cap. Two reasons not to buffer first: `text.length` counts UTF-16
 * code units, which UNDER-count UTF-8 by up to 3x for non-Latin scripts (so an
 * oversized multi-byte body would slip through), and `request.text()` on a
 * chunked body with no honest Content-Length buffers without bound before any
 * check can reject it.
 */

/** A parsed body, or why there isn't one. */
export type JsonBody = { ok: true; value: unknown } | { ok: false; reason: 'too-large' | 'unparseable' };

const TOO_LARGE = Symbol('body-too-large');

const refused = (reason: 'too-large' | 'unparseable'): JsonBody => ({ ok: false, reason });

/** Buffered fallback for a request with no stream; still measured in bytes. */
async function readUnstreamedText(request: Request, maxBytes: number): Promise<string> {
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) {
    throw TOO_LARGE;
  }
  return text;
}

/** The body as text. An unbounded body costs at most one chunk past the cap. */
async function readBoundedText(request: Request, maxBytes: number): Promise<string> {
  if (!request.body) {
    return readUnstreamedText(request, maxBytes);
  }
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let seen = 0;
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    seen += value.byteLength;
    if (seen > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw TOO_LARGE;
    }
    out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}

/**
 * Parse a request's JSON body, refusing anything over `maxBytes`. The declared
 * Content-Length is checked first, a cheap rejection for an honest client; the
 * stream is still counted, because a chunked body can omit the header entirely.
 * An empty body, a failed read and malformed JSON are all `unparseable`.
 */
export async function readJsonBody(request: Request, maxBytes: number): Promise<JsonBody> {
  if (Number(request.headers.get('content-length')) > maxBytes) {
    return refused('too-large');
  }
  try {
    return { ok: true, value: JSON.parse(await readBoundedText(request, maxBytes)) as unknown };
  } catch (error) {
    return refused(error === TOO_LARGE ? 'too-large' : 'unparseable');
  }
}
