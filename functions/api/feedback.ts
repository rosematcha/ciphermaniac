/**
 * Cloudflare Pages function for handling feedback form submissions
 * Processes feedback and sends emails via Resend
 */

import { jsonError, jsonSuccess } from '../lib/api/responses.js';
import { sendResendEmail } from '../lib/api/email.js';

// Maximum allowed payload size (1MB)
const MAX_PAYLOAD_SIZE = 1024 * 1024;

// Maximum allowed feedback text length in characters (in addition to the byte cap)
const MAX_FEEDBACK_TEXT_LENGTH = 10_000;

// Rate limiting configuration
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX_REQUESTS = 5;
const RATE_LIMIT_MAX_STORE_SIZE = 10_000;
const RATE_LIMIT_CLEANUP_INTERVAL = 100; // clean every Nth request

// In-memory rate limit store (acceptable for edge functions)
// Map<IP, { count: number, windowStart: number }>
const rateLimitStore = new Map<string, { count: number; windowStart: number }>();
let rateLimitRequestCount = 0;

/**
 * Reset rate limit store - exposed for testing only
 * @internal
 */
export function _resetRateLimitStore(): void {
  rateLimitStore.clear();
}

/**
 * Clean up expired rate limit entries to prevent memory leaks
 */
function cleanupRateLimitStore(): void {
  const now = Date.now();
  for (const [ip, data] of rateLimitStore.entries()) {
    if (now - data.windowStart > RATE_LIMIT_WINDOW_MS) {
      rateLimitStore.delete(ip);
    }
  }
}

/**
 * Check if an IP has exceeded the rate limit
 * Returns { allowed: boolean, retryAfter?: number }
 */
function checkRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();

  // Deterministic cleanup every N requests + hard cap to prevent OOM
  rateLimitRequestCount++;
  if (rateLimitRequestCount % RATE_LIMIT_CLEANUP_INTERVAL === 0) {
    cleanupRateLimitStore();
  }
  if (rateLimitStore.size > RATE_LIMIT_MAX_STORE_SIZE) {
    rateLimitStore.clear();
  }

  const existing = rateLimitStore.get(ip);

  if (!existing) {
    rateLimitStore.set(ip, { count: 1, windowStart: now });
    return { allowed: true };
  }

  // Check if window has expired
  if (now - existing.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(ip, { count: 1, windowStart: now });
    return { allowed: true };
  }

  // Within window - check count
  if (existing.count >= RATE_LIMIT_MAX_REQUESTS) {
    const retryAfter = Math.ceil((existing.windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000);
    return { allowed: false, retryAfter };
  }

  // Increment count
  existing.count++;
  return { allowed: true };
}

/**
 * Sanitize user text for the plain-text email body.
 *
 * The email is sent as a plain-text (`text`) payload via the Resend JSON API,
 * so HTML entity escaping is NOT applied — it would corrupt legitimate input
 * like "R&D" or "x < 5". As defense-in-depth (in case a mail client ever
 * renders the content as HTML), script tag blocks are removed and any stray
 * script tags are stripped.
 */
function sanitizeText(text: string): string {
  if (typeof text !== 'string') {
    return '';
  }
  // Remove script tags and their contents
  let sanitized = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '[script removed]');
  // Strip any leftover unpaired script tags
  sanitized = sanitized.replace(/<\/?script[^>]*>/gi, '[script removed]');
  // Drop control characters except newline and tab (keeps multi-line feedback readable)
  // eslint-disable-next-line no-control-regex
  sanitized = sanitized.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  return sanitized;
}

/**
 * Sanitize a single-line field: same as sanitizeText, plus newlines are
 * collapsed to spaces so labels like "Platform: ..." stay on one line.
 */
function sanitizeSingleLine(text: string): string {
  return sanitizeText(text)
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

/**
 * Sanitize contact info to prevent header injection
 * Removes newlines and carriage returns
 */
function sanitizeContactInfo(text: string): string {
  if (typeof text !== 'string') {
    return '';
  }
  return text.replace(/[\r\n]/g, ' ').trim();
}

interface FeedbackData {
  feedbackType: string;
  feedbackText: string;
  /** Honeypot field — hidden in the UI, real users never fill it. */
  hp?: string;
  platform?: 'desktop' | 'mobile' | string;
  desktopOS?: string;
  desktopBrowser?: string;
  mobileOS?: string;
  mobileBrowser?: string;
  followUp?: 'yes' | 'no';
  contactMethod?: string;
  contactInfo?: string;
}

interface Env {
  FEEDBACK_RECIPIENT?: string;
  RESEND_API_KEY?: string;
}

interface RequestContext {
  request: Request;
  env: Env;
}

const _JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*'
} as const;

function isValidFeedbackData(data: unknown): data is FeedbackData {
  if (!data || typeof data !== 'object') {
    return false;
  }
  const candidate = data as Record<string, unknown>;
  return typeof candidate.feedbackType === 'string' && typeof candidate.feedbackText === 'string';
}

export async function onRequestPost({ request, env }: RequestContext): Promise<Response> {
  try {
    // Rate limiting check using Cloudflare's CF-Connecting-IP header
    const clientIp = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
    const rateLimitResult = checkRateLimit(clientIp);

    if (!rateLimitResult.allowed) {
      return jsonError('Too many requests. Please try again later.', 429, {
        'Access-Control-Allow-Origin': '*',
        'Retry-After': String(rateLimitResult.retryAfter || 3600)
      });
    }

    // Check content length header first to reject oversized payloads early
    const contentLength = request.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_PAYLOAD_SIZE) {
      return jsonError('Payload too large', 413, { 'Access-Control-Allow-Origin': '*' });
    }

    // Also check actual body size by reading as text first
    const bodyText = await request.text().catch(() => '');
    if (bodyText.length > MAX_PAYLOAD_SIZE) {
      return jsonError('Payload too large', 413, { 'Access-Control-Allow-Origin': '*' });
    }

    let parsedBody: unknown = null;
    try {
      parsedBody = JSON.parse(bodyText);
    } catch {
      parsedBody = null;
    }
    if (!isValidFeedbackData(parsedBody)) {
      return jsonError('Missing required fields', 400, { 'Access-Control-Allow-Origin': '*' });
    }
    const feedbackData = parsedBody;

    // Honeypot: real users never fill this hidden field. Pretend success (same
    // pattern as the survey endpoint) so bots don't learn they were caught.
    if (typeof feedbackData.hp === 'string' && feedbackData.hp.trim()) {
      return jsonSuccess({ success: true });
    }

    if (feedbackData.feedbackText.length > MAX_FEEDBACK_TEXT_LENGTH) {
      return jsonError('Feedback text too long', 400, { 'Access-Control-Allow-Origin': '*' });
    }

    const recipient = env.FEEDBACK_RECIPIENT || 'reese@ciphermaniac.com';
    const emailContent = buildEmailContent(feedbackData);

    const resendResponse = await sendEmail(env, recipient, emailContent, feedbackData);
    if (!resendResponse.ok) {
      const errorText = await resendResponse.text();
      console.error('Resend API Error Response:', errorText);
      throw new Error(`Resend API error: ${resendResponse.status} - ${errorText}`);
    }

    return jsonSuccess({ success: true });
  } catch (error) {
    console.error('Feedback submission error:', error);
    // Never expose internal error messages which might contain API keys or secrets
    return jsonError('Internal server error', 500, { 'Access-Control-Allow-Origin': '*' });
  }
}

// Handle preflight requests
export function onRequestOptions(): Response {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

function buildEmailContent(data: FeedbackData): string {
  // Sanitize all user-provided fields (single-line fields also lose newlines)
  const sanitizedType = sanitizeSingleLine(data.feedbackType);
  const sanitizedText = sanitizeText(data.feedbackText);
  const sanitizedPlatform = data.platform ? sanitizeSingleLine(data.platform) : '';
  const sanitizedDesktopOS = data.desktopOS ? sanitizeSingleLine(data.desktopOS) : '';
  const sanitizedDesktopBrowser = data.desktopBrowser ? sanitizeSingleLine(data.desktopBrowser) : '';
  const sanitizedMobileOS = data.mobileOS ? sanitizeSingleLine(data.mobileOS) : '';
  const sanitizedMobileBrowser = data.mobileBrowser ? sanitizeSingleLine(data.mobileBrowser) : '';

  const lines = [`New ${sanitizedType} submission from Ciphermaniac`, '', `Feedback Type: ${sanitizedType}`, ''];

  if (data.feedbackType === 'bug') {
    lines.push('Technical Details:');
    if (sanitizedPlatform) {
      lines.push(`Platform: ${sanitizedPlatform}`);

      if (data.platform === 'desktop') {
        if (sanitizedDesktopOS) {
          lines.push(`OS: ${sanitizedDesktopOS}`);
        }
        if (sanitizedDesktopBrowser) {
          lines.push(`Browser: ${sanitizedDesktopBrowser}`);
        }
      } else if (data.platform === 'mobile') {
        if (sanitizedMobileOS) {
          lines.push(`Mobile OS: ${sanitizedMobileOS}`);
        }
        if (sanitizedMobileBrowser) {
          lines.push(`Browser: ${sanitizedMobileBrowser}`);
        }
      }
    }
    lines.push('');
  }

  lines.push('Feedback:');
  lines.push(sanitizedText);
  lines.push('');

  if (data.followUp === 'yes' && data.contactMethod && data.contactInfo) {
    lines.push('Contact Information:');
    lines.push(`Method: ${sanitizeSingleLine(data.contactMethod)}`);
    lines.push(`Contact: ${sanitizeContactInfo(data.contactInfo)}`);
  } else {
    lines.push('No follow-up requested');
  }

  lines.push('');
  lines.push(`Submitted at: ${new Date().toISOString()}`);

  return lines.join('\n');
}

async function sendEmail(env: Env, recipient: string, content: string, feedbackData: FeedbackData): Promise<Response> {
  const subject = `[Ciphermaniac] ${feedbackData.feedbackType === 'bug' ? 'Bug Report' : 'Feature Request'}`;
  return sendResendEmail(env, {
    from: 'Ciphermaniac Feedback <onboarding@resend.dev>',
    to: recipient,
    subject,
    text: content
  });
}
