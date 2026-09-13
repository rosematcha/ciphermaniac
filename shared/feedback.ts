/**
 * The feedback form's contract: what the page may send, how the Pages Function
 * validates it, and how it reads once it lands in an inbox. One module, so the
 * questions a visitor answers are the questions the email quotes back.
 * @module shared/feedback
 */

export const FEEDBACK_TYPES = {
  wrong: 'Something’s wrong',
  say: 'Something to say'
} as const;
export type FeedbackType = keyof typeof FEEDBACK_TYPES;

/** The question the main text box asks, per type. */
export const MESSAGE_LABELS: Record<FeedbackType, string> = {
  wrong: 'What’s wrong?',
  say: 'What’s on your mind?'
};
export const CORRECTION_LABEL = 'What should it be?';
export const PAGE_LABEL = 'Page';

export const CONTACT_METHODS = {
  email: 'Email',
  twitter: 'Twitter',
  bluesky: 'Bluesky',
  discord: 'Discord'
} as const;
export type ContactMethod = keyof typeof CONTACT_METHODS;

/** Device details a visitor can opt in to sending, in display order. */
export const ENVIRONMENT_FIELDS = {
  browser: 'Browser',
  os: 'OS',
  device: 'Device',
  screen: 'Screen',
  viewport: 'Window',
  input: 'Input',
  mode: 'Site mode',
  language: 'Language'
} as const;
export type EnvironmentField = keyof typeof ENVIRONMENT_FIELDS;
export type Environment = Partial<Record<EnvironmentField, string>>;

export const FEEDBACK_LIMITS = {
  message: 10_000,
  correction: 1_000,
  page: 500,
  handle: 200,
  environmentValue: 200
} as const;

export interface FeedbackReply {
  method: ContactMethod;
  handle: string;
}

export interface FeedbackSubmission {
  type: FeedbackType;
  message: string;
  correction?: string;
  page?: string;
  reply?: FeedbackReply;
  environment?: Environment;
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
export type ParseResult = Result<FeedbackSubmission>;

export const ENVIRONMENT_KEYS = Object.keys(ENVIRONMENT_FIELDS) as EnvironmentField[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Own keys only: `toString` or `__proto__` must never pass as a type. */
function isKeyOf<T extends object>(table: T, key: unknown): key is keyof T {
  return typeof key === 'string' && Object.hasOwn(table, key);
}

const trimmed = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

function withoutUndefined<T extends Record<string, unknown>>(record: T): Partial<T> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as Partial<T>;
}

function optionalText(value: unknown, max: number, name: string): Result<string | undefined> {
  const text = trimmed(value);
  if (text.length > max) {
    return fail(`${name} is too long`);
  }
  return { ok: true, value: text || undefined };
}

function parseReply(value: unknown): Result<FeedbackReply | undefined> {
  if (value === undefined || value === null) {
    return { ok: true, value: undefined };
  }
  const method = isRecord(value) ? value.method : undefined;
  const handle = isRecord(value) ? trimmed(value.handle) : '';
  if (!isKeyOf(CONTACT_METHODS, method) || !handle || handle.length > FEEDBACK_LIMITS.handle) {
    return fail('Invalid reply details');
  }
  return { ok: true, value: { method, handle } };
}

/** Known fields only, as trimmed strings capped in length. Anything else is dropped. */
function parseEnvironment(value: unknown): Environment | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const environment: Environment = {};
  for (const key of ENVIRONMENT_KEYS) {
    const text = trimmed(value[key]).slice(0, FEEDBACK_LIMITS.environmentValue);
    if (text) {
      environment[key] = text;
    }
  }
  return Object.keys(environment).length > 0 ? environment : undefined;
}

/** Validate an untrusted request body into a submission, trimming as it goes. */
export function parseFeedback(input: unknown): ParseResult {
  const type = isRecord(input) ? input.type : undefined;
  const message = isRecord(input) ? trimmed(input.message) : '';
  if (!isRecord(input) || !isKeyOf(FEEDBACK_TYPES, type) || !message) {
    return fail('Missing required fields');
  }
  if (message.length > FEEDBACK_LIMITS.message) {
    return fail('Feedback text too long');
  }
  const correction = optionalText(input.correction, FEEDBACK_LIMITS.correction, 'Correction');
  const page = optionalText(input.page, FEEDBACK_LIMITS.page, 'Page');
  const reply = parseReply(input.reply);
  if (!correction.ok) {
    return correction;
  }
  if (!page.ok) {
    return page;
  }
  if (!reply.ok) {
    return reply;
  }
  const optional = withoutUndefined({
    correction: correction.value,
    page: page.value,
    reply: reply.value,
    environment: parseEnvironment(input.environment)
  });
  return { ok: true, value: { type, message, ...optional } };
}

/** Deliberately plain: rejects anything with whitespace or header punctuation in it. */
export function isEmailAddress(value: string): boolean {
  return (
    value.length <= FEEDBACK_LIMITS.handle && /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[^\s@<>()[\],;:"]+$/.test(value)
  );
}

/** A same-site path to prefill the Page field with, or '' when the value isn't one. */
export function normalizePagePath(value: unknown): string {
  const path = trimmed(value);
  const isSitePath = path.startsWith('/') && !path.startsWith('//') && !/[\s\\]/.test(path);
  return isSitePath && path.length <= FEEDBACK_LIMITS.page ? path : '';
}

/**
 * The email goes out as plain text, so HTML escaping would only corrupt input
 * like "R&D" or "x < 5". As defense in depth, in case a client ever renders it
 * as HTML, script blocks and stray script tags are removed, along with control
 * characters other than newline and tab.
 */
function sanitizeText(text: string): string {
  return (
    text
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '[script removed]')
      .replace(/<\/?script[^>]*>/gi, '[script removed]')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
  );
}

/** As sanitizeText, with newlines collapsed so a labelled line stays one line. */
function sanitizeSingleLine(text: string): string {
  return sanitizeText(text)
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

function replyLine(reply: FeedbackReply | undefined): string {
  return reply ? `Reply by ${CONTACT_METHODS[reply.method]}: ${sanitizeSingleLine(reply.handle)}` : 'No reply wanted';
}

function environmentLines(environment: Environment | undefined): string[] {
  if (!environment) {
    return ['Browser, device, and OS not included'];
  }
  return ENVIRONMENT_KEYS.filter(key => environment[key]).map(
    key => `${ENVIRONMENT_FIELDS[key]}: ${sanitizeSingleLine(environment[key] ?? '')}`
  );
}

export interface FeedbackEmail {
  subject: string;
  text: string;
}

export function formatFeedbackEmail(submission: FeedbackSubmission, submittedAt: Date): FeedbackEmail {
  const { type } = submission;
  const lines = [`Type: ${FEEDBACK_TYPES[type]}`, '', MESSAGE_LABELS[type], sanitizeText(submission.message), ''];
  if (submission.correction) {
    lines.push(CORRECTION_LABEL, sanitizeText(submission.correction), '');
  }
  if (submission.page) {
    lines.push(`${PAGE_LABEL}: ${sanitizeSingleLine(submission.page)}`);
  }
  lines.push(
    replyLine(submission.reply),
    '',
    ...environmentLines(submission.environment),
    '',
    `Submitted at: ${submittedAt.toISOString()}`
  );
  return { subject: `[Ciphermaniac] ${FEEDBACK_TYPES[type]}`, text: lines.join('\n') };
}
