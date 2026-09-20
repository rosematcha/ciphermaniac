/**
 * POST /api/feedback: the feedback form's endpoint.
 *
 * Validates the body against the shared contract (shared/feedback.ts), then
 * mails it to the site owner through Resend. Rate limited per IP and capped in
 * size; a filled honeypot gets a quiet fake success.
 */

import { type FeedbackSubmission, formatFeedbackEmail, isEmailAddress, parseFeedback } from '../../shared/feedback.js';
import { readJsonBody } from '../lib/api/body.js';
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
  const clientIp = request.headers.get('CF-Connecting-IP') ?? 'unknown';
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

/** The parsed body, or the error Response to send instead. */
async function readFeedbackBody(request: Request): Promise<unknown> {
  const body = await readJsonBody(request, MAX_PAYLOAD_SIZE);
  if (body.ok) {
    return body.value;
  }
  return body.reason === 'too-large' ? tooLarge() : jsonError('Missing required fields', 400, CORS);
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
    const body = await readFeedbackBody(request);
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
