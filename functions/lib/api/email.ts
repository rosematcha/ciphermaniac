/**
 * Shared Resend transactional-email helper for Cloudflare Pages functions.
 *
 * Both the feedback form and the survey notification send plain-text mail
 * through Resend using the RESEND_API_KEY secret, so the actual HTTP call lives
 * here to keep a single source of truth.
 */

export interface ResendEnv {
  RESEND_API_KEY?: string;
}

export interface ResendEmailOptions {
  /** RFC 5322 From value, e.g. `Name <addr@domain>`. */
  from: string;
  to: string;
  subject: string;
  /** Plain-text body. */
  text: string;
  /** Abort the request after this many ms (default 10s). */
  timeoutMs?: number;
}

/**
 * Send a plain-text email via the Resend API. Returns the raw fetch Response so
 * callers can inspect the status. Throws if RESEND_API_KEY is not configured.
 */
export async function sendResendEmail(env: ResendEnv, options: ResendEmailOptions): Promise<Response> {
  const resendApiKey = env.RESEND_API_KEY;
  if (!resendApiKey) {
    throw new Error('RESEND_API_KEY environment variable not set');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  return fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: options.from,
      to: options.to,
      subject: options.subject,
      text: options.text
    }),
    signal: controller.signal
  }).finally(() => clearTimeout(timeoutId));
}
