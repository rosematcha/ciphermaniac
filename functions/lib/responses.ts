/**
 * Shared response utilities for Cloudflare Pages functions
 */

export function jsonError(message: string, status: number, headers?: Record<string, string>): Response {
  return new Response(
    JSON.stringify({
      error: message,
      status
    }),
    {
      status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        ...headers
      }
    }
  );
}

export function jsonSuccess<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}
