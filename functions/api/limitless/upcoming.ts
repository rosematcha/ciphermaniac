import { scrapeUpcoming } from '../../../shared/api/upcomingFetcher';
import { corsPreflight, jsonError, jsonResponse } from '../../lib/api/responses.js';

const RESPONSE_CACHE_CONTROL = 'public, max-age=3600, s-maxage=21600';
const JSON_CHARSET_HEADER = { 'Content-Type': 'application/json; charset=utf-8' } as const;
const ERROR_HEADERS = { ...JSON_CHARSET_HEADER, 'Access-Control-Allow-Origin': '*' } as const;

type UpcomingBucket = { get(key: string): Promise<{ text(): Promise<string> } | null> };

interface Context {
  request: Request;
  env?: { BUCKET?: UpcomingBucket; REPORTS?: UpcomingBucket };
  waitUntil?: (promise: Promise<unknown>) => void;
}

async function readUpcoming(context: Context): Promise<Response> {
  const bucket = context.env?.BUCKET ?? context.env?.REPORTS;
  const object = await bucket?.get('upcoming.json');
  if (object) {
    return new Response(await object.text(), {
      headers: {
        ...JSON_CHARSET_HEADER,
        'Cache-Control': RESPONSE_CACHE_CONTROL,
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
  const payload = await scrapeUpcoming();
  if (payload.parseWarning) {
    console.warn(`upcoming: ${payload.parseWarning}`);
  }
  return jsonResponse(payload, { cacheControl: RESPONSE_CACHE_CONTROL, headers: JSON_CHARSET_HEADER });
}

export async function onRequest(context: Context): Promise<Response> {
  const cache = typeof caches === 'undefined' ? undefined : caches.default;
  const url = new URL(context.request.url);
  url.search = '';
  const key = new Request(url, { method: 'GET' });
  const hit = await cache?.match(key).catch(err => {
    console.warn('upcoming cache read failed', err);
    return undefined;
  });
  if (hit) {
    return hit;
  }
  let response: Response;
  try {
    response = await readUpcoming(context);
  } catch (err) {
    return jsonError(`Fetch failed: ${err instanceof Error ? err.message : String(err)}`, 502, ERROR_HEADERS);
  }
  if (cache) {
    const write = cache.put(key, response.clone()).catch(err => console.warn('upcoming cache write failed', err));
    if (context.waitUntil) {
      context.waitUntil(write);
    } else {
      await write;
    }
  }
  return response;
}

export async function onRequestOptions(): Promise<Response> {
  return corsPreflight('GET, OPTIONS', { allowHeaders: null, maxAge: 86400 });
}
