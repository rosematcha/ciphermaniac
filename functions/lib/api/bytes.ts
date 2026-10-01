/**
 * Reading a request body as bytes under a hard ceiling, and telling what kind
 * of file an upload is from its first bytes.
 *
 * The body is read as a stream, counting bytes and bailing the moment the
 * count passes the cap, so a chunked body with no honest Content-Length costs
 * at most one chunk past it. The bytes come back as one buffer: R2 refuses a
 * stream of unknown length, and a buffer's size is exact.
 */

/** The kinds of file a proof may be. */
export type ProofType = 'image/png' | 'image/jpeg' | 'image/webp' | 'application/pdf';

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

/** Whether `bytes` holds `signature` from `offset` on. */
const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  bytes.length >= offset + signature.length && signature.every((byte, index) => bytes[offset + index] === byte);

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
/** "RIFF" at the start and "WEBP" at byte 8: RIFF alone is also WAV and AVI. */
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];
/** "%PDF-" */
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d];

/**
 * What kind of proof a file is, told by its magic number and never by the
 * name or type the browser sent; null for anything but a PNG, JPEG, WebP or
 * PDF. SVG and HTML are out: either can carry script.
 */
export function sniffProofType(bytes: Uint8Array): ProofType | null {
  if (startsWith(bytes, PNG)) {
    return 'image/png';
  }
  if (startsWith(bytes, JPEG)) {
    return 'image/jpeg';
  }
  if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)) {
    return 'image/webp';
  }
  return startsWith(bytes, PDF) ? 'application/pdf' : null;
}
