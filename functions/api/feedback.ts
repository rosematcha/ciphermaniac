/**
 * Cloudflare Pages function for handling feedback form submissions
 * Processes feedback and sends emails via Resend
 */

import { jsonError, jsonSuccess } from '../lib/responses.js';

// Maximum allowed payload size (1MB)
const MAX_PAYLOAD_SIZE = 1024 * 1024;

// Rate limiting configuration
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX_REQUESTS = 5;

// In-memory rate limit store (acceptable for edge functions)
// Map<IP, { count: number, windowStart: number }>
const rateLimitStore = new Map<string, { count: number; windowStart: number }>();

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

  // Periodic cleanup (run on ~1% of requests to avoid overhead)
  if (Math.random() < 0.01) {
    cleanupRateLimitStore();
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
 * Sanitize text to prevent XSS and remove dangerous characters
 * Escapes HTML entities and removes script tags
 */
function sanitizeText(text: string): string {
  if (typeof text !== 'string') {
    return '';
  }
  // Remove script tags and their contents
  let sanitized = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '[script removed]');
  // Escape remaining HTML entities
  sanitized = sanitized
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
  // Remove newlines from single-line fields to prevent header injection
  return sanitized;
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
  // Sanitize all user-provided fields
  const sanitizedType = sanitizeText(data.feedbackType);
  const sanitizedText = sanitizeText(data.feedbackText);
  const sanitizedPlatform = data.platform ? sanitizeText(data.platform) : '';
  const sanitizedDesktopOS = data.desktopOS ? sanitizeText(data.desktopOS) : '';
  const sanitizedDesktopBrowser = data.desktopBrowser ? sanitizeText(data.desktopBrowser) : '';
  const sanitizedMobileOS = data.mobileOS ? sanitizeText(data.mobileOS) : '';
  const sanitizedMobileBrowser = data.mobileBrowser ? sanitizeText(data.mobileBrowser) : '';

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
    lines.push(`Method: ${sanitizeText(data.contactMethod)}`);
    lines.push(`Contact: ${sanitizeContactInfo(data.contactInfo)}`);
  } else {
    lines.push('No follow-up requested');
  }

  lines.push('');
  lines.push(`Submitted at: ${new Date().toISOString()}`);

  return lines.join('\n');
}

async function sendEmail(env: Env, recipient: string, content: string, feedbackData: FeedbackData): Promise<Response> {
  const resendApiKey = env.RESEND_API_KEY;

  if (!resendApiKey) {
    throw new Error('RESEND_API_KEY environment variable not set');
  }

  const subject = `[Ciphermaniac] ${feedbackData.feedbackType === 'bug' ? 'Bug Report' : 'Feature Request'}`;

  const emailPayload = {
    from: 'Ciphermaniac Feedback <onboarding@resend.dev>',
    to: recipient,
    subject,
    text: content
  };

  return fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(emailPayload)
  });
}
