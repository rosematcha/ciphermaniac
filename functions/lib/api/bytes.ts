/**
 * Reading a request body as bytes under a hard ceiling.
 *
 * The body is read as a stream, counting bytes and bailing the moment the
 * count passes the cap, so a chunked body with no honest Content-Length costs
 * at most one chunk past it. The bytes come back as one buffer: R2 refuses a
 * stream of unknown length, and a buffer's size is exact.
 */

/** A body's bytes, or why there are none. */
export type BytesBody = { ok: true; bytes: Uint8Array } | { ok: false; reason: 'too-large' | 'unreadable' };

const TOO_LARGE: BytesBody = { ok: false, reason: 'too-large' };

/** The chunks as one buffer `length` bytes long. */
function joined(chunks: Uint8Array[], length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}

async function readStream(body: ReadableStream<Uint8Array>, maxBytes: number): Promise<BytesBody> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let seen = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      return { ok: true, bytes: joined(chunks, seen) };
    }
    seen += value.byteLength;
    if (seen > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return TOO_LARGE;
    }
    chunks.push(value);
  }
}

/**
 * A request's body, refusing anything over `maxBytes`. The declared
 * Content-Length is checked first, a cheap rejection for an honest client; the
 * stream is still counted, because a chunked body can omit the header. No
 * body reads as no bytes.
 */
export async function readBoundedBytes(request: Request, maxBytes: number): Promise<BytesBody> {
  if (Number(request.headers.get('content-length')) > maxBytes) {
    return TOO_LARGE;
  }
  if (!request.body) {
    return { ok: true, bytes: new Uint8Array(0) };
  }
  try {
    return await readStream(request.body, maxBytes);
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
}
