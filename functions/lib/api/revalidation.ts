import { sha256 } from '../auth/session.js';

export interface JsonRepresentation {
  body: string;
  etag: string;
}

/** Hash the actual viewer-specific bytes, including fields that change without an event version. */
export async function jsonRepresentation(value: unknown): Promise<JsonRepresentation> {
  const body = JSON.stringify(value);
  return { body, etag: `"${await sha256(body)}"` };
}

function matches(value: string | null, etag: string): boolean {
  if (value?.trim() === '*') {
    return true;
  }
  // A tag can contain commas; scan quoted tags rather than splitting the header.
  const tags = value?.match(/(?:W\/)?"[^"\s]*"/g) ?? [];
  return tags.some(tag => tag.replace(/^W\//, '') === etag);
}

/** Private browser storage is allowed, but every reuse must check current authorization and data. */
export function revalidatedJson(request: Request, representation: JsonRepresentation): Response {
  const unchanged = matches(request.headers.get('If-None-Match'), representation.etag);
  return new Response(unchanged ? null : representation.body, {
    status: unchanged ? 304 : 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, no-cache',
      ETag: representation.etag,
      Vary: 'Cookie',
      'X-Robots-Tag': 'noindex'
    }
  });
}
