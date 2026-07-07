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
      'Content-Type': 'application/json',
      // Match jsonError and the OPTIONS preflight handlers so cross-origin
      // callers can actually read successful responses.
      'Access-Control-Allow-Origin': '*'
    }
  });
}

export interface JsonResponseOptions {
  status?: number;
  /** Value for the Cache-Control header. Omitted entirely when unset. */
  cacheControl?: string;
  /** Emit `Access-Control-Allow-Origin: *` (default true). */
  cors?: boolean;
  /** Extra headers merged last (can override the defaults above). */
  headers?: Record<string, string>;
}

/**
 * Build a JSON response with the common Content-Type / CORS / Cache-Control
 * headers. Consolidates the copy-pasted JSON helpers across the API routes.
 */
export function jsonResponse(body: unknown, options: JsonResponseOptions = {}): Response {
  const { status = 200, cacheControl, cors = true, headers } = options;
  const finalHeaders: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  if (cors) {
    finalHeaders['Access-Control-Allow-Origin'] = '*';
  }
  if (cacheControl) {
    finalHeaders['Cache-Control'] = cacheControl;
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...finalHeaders, ...headers }
  });
}

export interface CorsPreflightOptions {
  /** Response status (default 204). Some routes historically use 200. */
  status?: number;
  /** Access-Control-Allow-Headers value; pass null to omit the header. */
  allowHeaders?: string | null;
  /** Access-Control-Max-Age value in seconds; omitted when unset. */
  maxAge?: number;
  /** Allowed origin (default '*'). */
  origin?: string;
}

/**
 * Build a CORS preflight (OPTIONS) response. Consolidates the copy-pasted
 * onRequestOptions handlers across the API routes.
 */
export function corsPreflight(methods: string, options: CorsPreflightOptions = {}): Response {
  const { status = 204, allowHeaders = 'Content-Type', maxAge, origin = '*' } = options;
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': methods
  };
  if (allowHeaders) {
    headers['Access-Control-Allow-Headers'] = allowHeaders;
  }
  if (maxAge !== undefined) {
    headers['Access-Control-Max-Age'] = String(maxAge);
  }
  return new Response(null, { status, headers });
}
