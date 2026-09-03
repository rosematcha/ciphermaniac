export function jsonError(message: string, status: number, headers?: Record<string, string>): Response {
  return jsonResponse({ error: message, status }, { status, cacheControl: 'no-store', cors: false, headers });
}

export function jsonSuccess<T>(data: T, status = 200): Response {
  return jsonResponse(data, { status });
}

export const IMAGE_FETCH_INIT: RequestInit & { cf?: unknown } = {
  cf: { cacheTtl: 86400, cacheEverything: true }
};

export function textError(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }
  });
}

/** Strip origin cookies so proxied immutable images remain edge-cacheable. */
export function imageProxyResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.delete('Set-Cookie');
  headers.delete('Vary');
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('Content-Type', 'image/png');
  return new Response(response.body, { status: response.status, headers });
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
