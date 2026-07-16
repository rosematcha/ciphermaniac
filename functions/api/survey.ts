/**
 * Cloudflare Pages function for handling user-survey submissions.
 * Validates + sanitizes the payload, rate-limits by IP, drops honeypot hits,
 * and stores one row per response in the D1 database (binding: SURVEY_DB).
 *
 * Analysis is done with SQL against the `responses` table — see the schema in
 * the repo README / dashboard. Text is stored raw (trimmed + length-capped);
 * any surface that renders it MUST output-encode.
 */

import { corsPreflight, jsonError, jsonSuccess } from '../lib/api/responses.js';
import { createRateLimiter } from '../lib/api/rateLimiter.js';
import { sendResendEmail } from '../lib/api/email.js';

// Minimal D1 surface we need — the project doesn't pull in @cloudflare/workers-types.
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<unknown>;
}
interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

interface Env {
  SURVEY_DB: D1Database;
  // Resend API key for notification emails (shared with the feedback form).
  RESEND_API_KEY?: string;
  // Override the notification recipient; defaults to surveyresults@rosematcha.com.
  SURVEY_NOTIFY_RECIPIENT?: string;
}

interface RequestContext {
  request: Request;
  env: Env;
  waitUntil(promise: Promise<unknown>): void;
}

// Where "a new response came in" notifications are sent.
const DEFAULT_NOTIFY_RECIPIENT = 'surveyresults@rosematcha.com';
// Resend's shared onboarding sender works without domain verification, matching
// the feedback form. Swap for a verified-domain address once one is set up.
const NOTIFY_FROM = 'Ciphermaniac Survey <onboarding@resend.dev>';

const CORS = { 'Access-Control-Allow-Origin': '*' } as const;

// Maximum allowed payload size (256KB — a survey response is tiny)
const MAX_PAYLOAD_SIZE = 256 * 1024;

// Field limits
const MAX_TEXT_LEN = 2000;
const MAX_SHORT_LEN = 200;
const MAX_ITEMS = 40;

// Rate limiting: max 5 submissions per IP per hour (per-isolate; acceptable for
// edge functions).
const rateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  maxRequests: 5
});

/** Trim, strip control chars, and cap length. Returns null when empty. */
function cleanText(value: unknown, maxLen: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  // Drop control characters (keep tab/newline) and trim.
  const stripped = value.replace(/\p{Cc}/gu, c => (c === '\n' || c === '\t' ? c : '')).trim();
  if (!stripped) {
    return null;
  }
  return stripped.slice(0, maxLen);
}

/** Clean an array of short string labels (multi-selects). */
function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: string[] = [];
  for (const item of value.slice(0, MAX_ITEMS)) {
    const cleaned = cleanText(item, MAX_SHORT_LEN);
    if (cleaned) {
      out.push(cleaned);
    }
  }
  return out;
}

/** Clean a { label: rating } map, keeping only integer ratings in [min,max]. */
function cleanRatingMap(value: unknown, min: number, max: number): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const out: Record<string, number> = {};
  for (const [rawKey, rawVal] of Object.entries(value as Record<string, unknown>).slice(0, MAX_ITEMS)) {
    const key = cleanText(rawKey, MAX_SHORT_LEN);
    const n = typeof rawVal === 'number' ? Math.trunc(rawVal) : NaN;
    if (key && Number.isFinite(n) && n >= min && n <= max) {
      out[key] = n;
    }
  }
  return out;
}

/** Clamp a single scalar rating to an integer in [min,max], else null. */
function cleanInt(value: unknown, min: number, max: number): number | null {
  const n = typeof value === 'number' ? Math.trunc(value) : NaN;
  if (Number.isFinite(n) && n >= min && n <= max) {
    return n;
  }
  return null;
}

function jsonOrNull(obj: Record<string, unknown> | unknown[]): string | null {
  const isEmpty = Array.isArray(obj) ? obj.length === 0 : Object.keys(obj).length === 0;
  return isEmpty ? null : JSON.stringify(obj);
}

async function hashIp(ip: string): Promise<string> {
  const data = new TextEncoder().encode(`ciphermaniac-survey:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/** A plain-text summary of the fields worth glancing at in an inbox. */
function buildNotificationBody(fields: {
  createdAt: string;
  region: string | null;
  areas: string[];
  devices: string[];
  formats: string[];
  speed: number | null;
  trust: number | null;
  recommend: number | null;
  feature: string | null;
  annoyance: string | null;
  anythingElse: string | null;
}): string {
  const dash = (value: unknown): string =>
    value === null || value === undefined || value === '' ? '—' : String(value);
  const list = (items: string[]): string => (items.length ? items.join(', ') : '—');
  const block = (label: string, text: string | null): string => `${label}:\n${text ? text : '—'}`;

  return [
    `A new survey response was submitted at ${fields.createdAt}.`,
    '',
    `Region: ${dash(fields.region)}`,
    `Areas used: ${list(fields.areas)}`,
    `Devices: ${list(fields.devices)}`,
    `Formats: ${list(fields.formats)}`,
    `Speed (1–5): ${dash(fields.speed)}`,
    `Trust (1–5): ${dash(fields.trust)}`,
    `Recommend / NPS (0–10): ${dash(fields.recommend)}`,
    '',
    block('Feature request', fields.feature),
    '',
    block('Biggest annoyance', fields.annoyance),
    '',
    block('Anything else', fields.anythingElse),
    '',
    'See the full response in the results dashboard: /survey/results'
  ].join('\n');
}

/**
 * Fire-and-forget notification for a new response. Never throws — callers wrap
 * it in waitUntil so a slow or failed email never affects the user's
 * submission. No-ops when RESEND_API_KEY is unset (e.g. local dev).
 */
async function sendNotification(env: Env, body: string): Promise<void> {
  if (!env.RESEND_API_KEY) {
    return;
  }
  const response = await sendResendEmail(env, {
    from: NOTIFY_FROM,
    to: env.SURVEY_NOTIFY_RECIPIENT || DEFAULT_NOTIFY_RECIPIENT,
    subject: 'New Ciphermaniac survey response',
    text: body
  });
  if (!response.ok) {
    // Read+discard the body so we log a status without echoing secrets.
    console.error('Survey notification email failed:', response.status);
  }
}

export async function onRequestPost({ request, env, waitUntil }: RequestContext): Promise<Response> {
  try {
    if (!env.SURVEY_DB) {
      console.error('SURVEY_DB binding missing');
      return jsonError('Survey storage unavailable', 503, CORS);
    }

    const clientIp = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';

    const rateLimit = rateLimiter.check(clientIp);
    if (!rateLimit.allowed) {
      return jsonError('Too many submissions. Please try again later.', 429, {
        ...CORS,
        'Retry-After': String(rateLimit.retryAfter || 3600)
      });
    }

    const contentLength = request.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_PAYLOAD_SIZE) {
      return jsonError('Payload too large', 413, CORS);
    }

    const bodyText = await request.text().catch(() => '');
    if (bodyText.length > MAX_PAYLOAD_SIZE) {
      return jsonError('Payload too large', 413, CORS);
    }

    let body: Record<string, unknown> | null = null;
    try {
      const parsed = JSON.parse(bodyText);
      body = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      body = null;
    }
    if (!body) {
      return jsonError('Invalid payload', 400, CORS);
    }

    // Honeypot: real users never fill this hidden field. Pretend success.
    const honeypot = cleanText(body.hp, MAX_SHORT_LEN);
    if (honeypot) {
      return jsonSuccess({ success: true });
    }

    // Normalize every field.
    const region = cleanText(body.region, MAX_SHORT_LEN);
    const areas = cleanStringArray(body.areas);
    const readability = cleanRatingMap(body.readability, 1, 5);
    const effectiveness = cleanRatingMap(body.effectiveness, 1, 5);
    const devices = cleanStringArray(body.devices);
    const deviceOther = cleanText(body.deviceOther, MAX_SHORT_LEN);
    const layout = cleanRatingMap(body.layout, 1, 5);
    const speed = cleanInt(body.speed, 1, 5);
    const trust = cleanInt(body.trust, 1, 5);
    const recommend = cleanInt(body.recommend, 0, 10);
    const formats = cleanStringArray(body.formats);
    const formatOther = cleanText(body.formatOther, MAX_SHORT_LEN);
    const feature = cleanText(body.feature, MAX_TEXT_LEN);
    const annoyance = cleanText(body.annoyance, MAX_TEXT_LEN);
    const discovery = cleanText(body.discovery, MAX_SHORT_LEN);
    const discoveryOther = cleanText(body.discoveryOther, MAX_SHORT_LEN);
    const anythingElse = cleanText(body.anythingElse, MAX_TEXT_LEN);

    // Reject entirely empty submissions (bots poking the endpoint).
    const hasContent =
      region ||
      areas.length ||
      Object.keys(readability).length ||
      Object.keys(effectiveness).length ||
      devices.length ||
      deviceOther ||
      Object.keys(layout).length ||
      speed !== null ||
      trust !== null ||
      recommend !== null ||
      formats.length ||
      formatOther ||
      feature ||
      annoyance ||
      discovery ||
      discoveryOther ||
      anythingElse;
    if (!hasContent) {
      return jsonError('Empty submission', 400, CORS);
    }

    const ipHash = await hashIp(clientIp);
    const createdAt = new Date().toISOString();

    await env.SURVEY_DB.prepare(
      `INSERT INTO responses (
        created_at, ip_hash, region, areas_json, readability_json, effectiveness_json,
        devices_json, device_other, layout_json, speed, trust, recommend,
        formats_json, format_other, feature_text, annoyance_text, discovery, discovery_other, anything_else
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        createdAt,
        ipHash,
        region,
        jsonOrNull(areas),
        jsonOrNull(readability),
        jsonOrNull(effectiveness),
        jsonOrNull(devices),
        deviceOther,
        jsonOrNull(layout),
        speed,
        trust,
        recommend,
        jsonOrNull(formats),
        formatOther,
        feature,
        annoyance,
        discovery,
        discoveryOther,
        anythingElse
      )
      .run();

    // Notify by email out of band: a slow or failed send must never fail the
    // survey submission the user just made.
    const notificationBody = buildNotificationBody({
      createdAt,
      region,
      areas,
      devices,
      formats,
      speed,
      trust,
      recommend,
      feature,
      annoyance,
      anythingElse
    });
    waitUntil(
      sendNotification(env, notificationBody).catch(err => console.error('Survey notification email failed:', err))
    );

    return jsonSuccess({ success: true });
  } catch (error) {
    console.error('Survey submission error:', error);
    return jsonError('Internal server error', 500, CORS);
  }
}

export function onRequestOptions(): Response {
  return corsPreflight('POST, OPTIONS', { status: 200 });
}
