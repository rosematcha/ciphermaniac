const LIMITLESS_API_BASE = 'https://play.limitlesstcg.com/api';

function resolveLimitlessApiKey(env) {
  const direct = typeof env === 'object' && env ? env.LIMITLESS_API_KEY : undefined;
  if (direct && typeof direct === 'string' && direct.trim()) {
    return direct.trim();
  }

  if (typeof process !== 'undefined' && process.env && process.env.LIMITLESS_API_KEY) {
    const fromProcess = process.env.LIMITLESS_API_KEY.trim();
    if (fromProcess) {
      return fromProcess;
    }
  }

  if (typeof globalThis !== 'undefined' && globalThis.__LIMITLESS_API_KEY__) {
    const fromGlobal = String(globalThis.__LIMITLESS_API_KEY__).trim();
    if (fromGlobal) {
      return fromGlobal;
    }
  }

  return null;
}

function buildLimitlessUrl(pathname = '/', searchParams = null) {
  const base = LIMITLESS_API_BASE.endsWith('/') ? LIMITLESS_API_BASE : `${LIMITLESS_API_BASE}/`;
  const normalizedPath = pathname.replace(/^\/+/, '');
  const url = new URL(normalizedPath, base);

  if (searchParams instanceof URLSearchParams) {
    searchParams.forEach((value, key) => {
      if (typeof value === 'string') {
        url.searchParams.set(key, value);
      }
    });
  } else if (searchParams && typeof searchParams === 'object') {
    Object.entries(searchParams).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    });
  }

  return url;
}

async function fetchLimitlessJson(pathname, { env, searchParams, fetchOptions } = {}) {
  const apiKey = resolveLimitlessApiKey(env);
  if (!apiKey) {
    throw new Error('Limitless API key not configured. Set LIMITLESS_API_KEY in .env and Cloudflare environment.');
  }

  const url = buildLimitlessUrl(pathname, searchParams);
  // Comply with the documented authentication scheme by appending the key query parameter.
  if (!url.searchParams.has('key')) {
    url.searchParams.set('key', apiKey);
  }

  // Temporary debug logging to verify authentication plumbing during development.
  if (typeof console !== 'undefined' && console.debug) {
    console.debug('[Limitless] Proxying request', {
      path: url.pathname,
      hasKeyQuery: url.searchParams.has('key'),
      hasHeader: true
    });
  }

  const headers = new Headers(fetchOptions?.headers || undefined);
  if (!headers.has('X-Access-Key')) {
    headers.set('X-Access-Key', apiKey);
  }
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }

  const response = await fetch(url, {
    method: 'GET',
    ...fetchOptions,
    headers
  });

  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json') || contentType.includes('text/json');

  if (!response.ok) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[Limitless] Non-ok response', {
        status: response.status,
        url: response.url,
        contentType
      });
    }
    const bodyPreview = await response.text();
    const error = new Error(`Limitless API request failed with ${response.status}`);
    error.status = response.status;
    error.body = bodyPreview.slice(0, 400);
    throw error;
  }

  if (!isJson) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[Limitless] Unexpected content type response', {
        status: response.status,
        url: response.url,
        contentType
      });
    }
    const textPreview = await response.text();
    const error = new Error(`Limitless API returned unexpected content-type: ${contentType}`);
    error.status = 500;
    error.body = textPreview.slice(0, 400);
    throw error;
  }

  return response.json();
}

export {
  LIMITLESS_API_BASE,
  buildLimitlessUrl,
  fetchLimitlessJson,
  resolveLimitlessApiKey
};
