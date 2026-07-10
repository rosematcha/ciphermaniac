/**
 * Cloudflare Pages function serving aggregated survey results.
 * Unlisted (obscure URL) rather than password-gated. Analysis is computed in
 * JS over all rows (survey volume is small).
 */

import { corsPreflight, jsonError, jsonSuccess } from '../../lib/api/responses.js';

interface D1Result<T> {
  results: T[];
}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}
interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

interface Env {
  SURVEY_DB: D1Database;
}

interface RequestContext {
  env: Env;
}

interface ResponseRow {
  created_at: string;
  region: string | null;
  areas_json: string | null;
  readability_json: string | null;
  effectiveness_json: string | null;
  devices_json: string | null;
  device_other: string | null;
  layout_json: string | null;
  speed: number | null;
  trust: number | null;
  recommend: number | null;
  formats_json: string | null;
  format_other: string | null;
  feature_text: string | null;
  annoyance_text: string | null;
  discovery: string | null;
  discovery_other: string | null;
  anything_else: string | null;
}

const CORS = { 'Access-Control-Allow-Origin': '*' } as const;
const MAX_ROWS = 5000;

function parseJson<T>(value: string | null): T | null {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

/**
 * Parse a JSON column expected to hold an array of strings. A malformed row
 * (non-array JSON, or an array with non-string members) must not crash the
 * whole route — `for...of` over a parsed object throws — so we coerce to a safe
 * `string[]`, dropping anything that isn't a string.
 */
function parseStringArray(value: string | null): string[] {
  const parsed = parseJson<unknown>(value);
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter((item): item is string => typeof item === 'string');
}

/**
 * Parse a JSON column expected to hold a `Record<string, number>` rating map.
 * Returns null for anything that isn't a plain object so `accumulated` never
 * iterates a string/array/primitive.
 */
function parseRatingMap(value: string | null): Record<string, number> | null {
  const parsed = parseJson<unknown>(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  return parsed as Record<string, number>;
}

/** Return a new count map with `key` incremented (avoids mutating a param). */
function bumped(counts: Record<string, number>, key: string | null | undefined): Record<string, number> {
  if (!key) {
    return counts;
  }
  return { ...counts, [key]: (counts[key] || 0) + 1 };
}

/** Return a new accumulator with each label in `map` folded in. */
function accumulated(
  acc: Record<string, { sum: number; n: number }>,
  map: Record<string, number> | null
): Record<string, { sum: number; n: number }> {
  if (!map) {
    return acc;
  }
  const next = { ...acc };
  for (const [label, val] of Object.entries(map)) {
    if (typeof val === 'number') {
      const cur = next[label] || { sum: 0, n: 0 };
      next[label] = { sum: cur.sum + val, n: cur.n + 1 };
    }
  }
  return next;
}

function averages(nums: number[]): { avg: number | null; count: number } {
  if (nums.length === 0) {
    return { avg: null, count: 0 };
  }
  const sum = nums.reduce((a, b) => a + b, 0);
  return { avg: Math.round((sum / nums.length) * 100) / 100, count: nums.length };
}

export async function onRequestGet({ env }: RequestContext): Promise<Response> {
  if (!env.SURVEY_DB) {
    return jsonError('Survey storage unavailable', 503, CORS);
  }

  const { results } = await env.SURVEY_DB.prepare(
    `SELECT * FROM responses ORDER BY created_at DESC LIMIT ${MAX_ROWS}`
  ).all<ResponseRow>();

  let region: Record<string, number> = {};
  let discovery: Record<string, number> = {};
  let devices: Record<string, number> = {};
  let formats: Record<string, number> = {};
  let areas: Record<string, number> = {};
  const speedVals: number[] = [];
  const trustVals: number[] = [];
  const recommendVals: number[] = [];

  // Per-area rating accumulators: label -> { sum, n }
  let readAcc: Record<string, { sum: number; n: number }> = {};
  let effAcc: Record<string, { sum: number; n: number }> = {};
  let layoutAcc: Record<string, { sum: number; n: number }> = {};

  const featureText: { at: string; text: string }[] = [];
  const annoyanceText: { at: string; text: string }[] = [];
  const anythingElseText: { at: string; text: string }[] = [];

  for (const row of results) {
    region = bumped(region, row.region);
    discovery = bumped(discovery, row.discovery);
    for (const d of parseStringArray(row.devices_json)) {
      devices = bumped(devices, d);
    }
    for (const f of parseStringArray(row.formats_json)) {
      formats = bumped(formats, f);
    }
    for (const a of parseStringArray(row.areas_json)) {
      areas = bumped(areas, a);
    }
    if (typeof row.speed === 'number') {
      speedVals.push(row.speed);
    }
    if (typeof row.trust === 'number') {
      trustVals.push(row.trust);
    }
    if (typeof row.recommend === 'number') {
      recommendVals.push(row.recommend);
    }
    readAcc = accumulated(readAcc, parseRatingMap(row.readability_json));
    effAcc = accumulated(effAcc, parseRatingMap(row.effectiveness_json));
    layoutAcc = accumulated(layoutAcc, parseRatingMap(row.layout_json));

    if (row.feature_text) {
      featureText.push({ at: row.created_at, text: row.feature_text });
    }
    if (row.annoyance_text) {
      annoyanceText.push({ at: row.created_at, text: row.annoyance_text });
    }
    if (row.anything_else) {
      anythingElseText.push({ at: row.created_at, text: row.anything_else });
    }
  }

  const toAvgMap = (acc: Record<string, { sum: number; n: number }>) =>
    Object.fromEntries(
      Object.entries(acc).map(([label, { sum, n }]) => [label, { avg: Math.round((sum / n) * 100) / 100, count: n }])
    );

  // NPS from the 0-10 recommend scores.
  const promoters = recommendVals.filter(n => n >= 9).length;
  const detractors = recommendVals.filter(n => n <= 6).length;
  const nps = recommendVals.length ? Math.round(((promoters - detractors) / recommendVals.length) * 100) : null;

  return jsonSuccess({
    total: results.length,
    generatedAt: new Date().toISOString(),
    region,
    discovery,
    devices,
    formats,
    areas,
    speed: averages(speedVals),
    trust: averages(trustVals),
    recommend: averages(recommendVals),
    nps,
    readability: toAvgMap(readAcc),
    effectiveness: toAvgMap(effAcc),
    layout: toAvgMap(layoutAcc),
    feature: featureText,
    annoyance: annoyanceText,
    anythingElse: anythingElseText
  });
}

export function onRequestOptions(): Response {
  return corsPreflight('GET, OPTIONS', { status: 200, allowHeaders: 'Authorization, Content-Type' });
}
