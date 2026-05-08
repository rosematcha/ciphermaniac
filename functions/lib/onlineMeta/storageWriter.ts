import { runWithConcurrency } from './tournamentFetcher';

const DEFAULT_R2_CONCURRENCY = 6;

export async function putJson(env, key, data) {
  if (!env?.REPORTS?.put) {
    throw new Error('REPORTS bucket not configured');
  }
  const payload = JSON.stringify(data, null, 2);
  await env.REPORTS.put(key, payload, {
    httpMetadata: {
      contentType: 'application/json'
    }
  });
}

export async function putBinary(env, key: string, data: Uint8Array | Buffer, contentType = 'application/octet-stream') {
  if (!env?.REPORTS?.put) {
    throw new Error('REPORTS bucket not configured');
  }
  await env.REPORTS.put(key, data, {
    httpMetadata: {
      contentType
    }
  });
}

export async function batchPutJson(env, entries, concurrency = DEFAULT_R2_CONCURRENCY) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return;
  }

  const normalized = entries
    .filter(entry => entry && entry.key && entry.data !== undefined)
    .map(entry => ({ key: entry.key, data: entry.data }));

  if (!normalized.length) {
    return;
  }

  const limit = Math.max(1, Number(concurrency) || DEFAULT_R2_CONCURRENCY);
  await runWithConcurrency(normalized, limit, async entry => putJson(env, entry.key, entry.data));
}
