/**
 * POST /api/feedback: the feedback form's endpoint.
 *
 * Validates the body against the shared contract (shared/feedback.ts), then
 * mails it to the site owner through Resend. Rate limited per IP and capped in
 * size; a filled honeypot gets a quiet fake success.
 */

import { type FeedbackSubmission, formatFeedbackEmail, isEmailAddress, parseFeedback } from '../../shared/feedback.js';
import { type ResendEnv, sendResendEmail } from '../lib/api/email.js';
import { createRateLimiter } from '../lib/api/rateLimiter.js';
import { corsPreflight, jsonError, jsonSuccess } from '../lib/api/responses.js';

/** The form's largest possible body is about 12 KB; anything near this is not the form. */
const MAX_PAYLOAD_SIZE = 64 * 1024;
const CORS = { 'Access-Control-Allow-Origin': '*' };
const FROM = 'Ciphermaniac Feedback <onboarding@resend.dev>';
const DEFAULT_RECIPIENT = 'reese@ciphermaniac.com';

// In-memory, so per isolate; acceptable at the edge. 5 requests per IP per hour.
const rateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  maxRequests: 5
});

/**
 * Reset rate limit store - exposed for testing only
 * @internal
 */
export function _resetRateLimitStore(): void {
  rateLimiter.reset();
}

interface Env extends ResendEnv {
  FEEDBACK_RECIPIENT?: string;
}

interface RequestContext {
  request: Request;
  env: Env;
}

function rateLimited(request: Request): Response | null {
  const clientIp = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
  const result = rateLimiter.check(clientIp);
  if (result.allowed) {
    return null;
  }
  return jsonError('Too many requests. Please try again later.', 429, {
    ...CORS,
    'Retry-After': String(result.retryAfter || 3600)
  });
}

const tooLarge = () => jsonError('Payload too large', 413, CORS);

/**
 * The body as text, or null once it passes the cap. Counted in bytes as it
 * streams, so a chunked body with no Content-Length can't be read in full first.
 */
async function readBoundedText(request: Request): Promise<string | null> {
  if (!request.body) {
    return '';
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > MAX_PAYLOAD_SIZE) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** The parsed body, or the error Response to send instead. */
async function readJsonBody(request: Request): Promise<unknown> {
  // Reject on the declared length before reading anything.
  if (Number(request.headers.get('content-length')) > MAX_PAYLOAD_SIZE) {
    return tooLarge();
  }
  const text = await readBoundedText(request).catch(() => '');
  if (text === null) {
    return tooLarge();
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return jsonError('Missing required fields', 400, CORS);
  }
}

function filledHoneypot(body: unknown): boolean {
  const honeypot = typeof body === 'object' && body !== null ? (body as { hp?: unknown }).hp : undefined;
  return typeof honeypot === 'string' && honeypot.trim() !== '';
}

function sendFeedbackEmail(env: Env, submission: FeedbackSubmission): Promise<Response> {
  const { subject, text } = formatFeedbackEmail(submission, new Date());
  // With an email address to reply to, a plain Reply in the inbox reaches the visitor.
  const handle = submission.reply?.method === 'email' ? submission.reply.handle : '';
  return sendResendEmail(env, {
    from: FROM,
    to: env.FEEDBACK_RECIPIENT || DEFAULT_RECIPIENT,
    subject,
    text,
    ...(isEmailAddress(handle) ? { replyTo: handle } : {})
  });
}

export async function onRequestPost({ request, env }: RequestContext): Promise<Response> {
  try {
    const limited = rateLimited(request);
    if (limited) {
      return limited;
    }
    const body = await readJsonBody(request);
    if (body instanceof Response) {
      return body;
    }
    // Pretend a bot's submission worked, so it never learns it was caught.
    if (filledHoneypot(body)) {
      return jsonSuccess({ success: true });
    }
    const parsed = parseFeedback(body);
    if (!parsed.ok) {
      return jsonError(parsed.error, 400, CORS);
    }
    const response = await sendFeedbackEmail(env, parsed.value);
    if (!response.ok) {
      console.error('Resend API error:', response.status, await response.text());
      return jsonError('Internal server error', 500, CORS);
    }
    return jsonSuccess({ success: true });
  } catch (error) {
    // Never echo the error itself: it can carry the API key or a downstream body.
    console.error('Feedback submission error:', error);
    return jsonError('Internal server error', 500, CORS);
  }
}

export function onRequestOptions(): Response {
  return corsPreflight('POST, OPTIONS', { status: 200 });
}
