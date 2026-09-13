/**
 * The feedback page's logic, kept out of the component so it can be tested
 * without a browser: client-side validation, the request body, and sending.
 * The server validates again with `parseFeedback`; this only saves a round trip.
 * @module lib/feedbackForm
 */

import {
  type ContactMethod,
  type Environment,
  type FeedbackSubmission,
  type FeedbackType,
  isEmailAddress
} from '../../shared/feedback';

export interface FeedbackFormState {
  type: FeedbackType;
  message: string;
  correction: string;
  page: string;
  wantsReply: boolean;
  method: ContactMethod;
  handle: string;
  /** Null unless the visitor opted in. */
  environment: Environment | null;
}

export interface FormErrors {
  message?: string | undefined;
  handle?: string | undefined;
}

export type SendOutcome = 'sent' | 'failed' | 'limited';

function handleError(state: FeedbackFormState): string | undefined {
  if (!state.wantsReply) {
    return undefined;
  }
  const handle = state.handle.trim();
  if (!handle) {
    return 'Required';
  }
  return state.method === 'email' && !isEmailAddress(handle) ? 'Needs to be an email address' : undefined;
}

export function validateForm(state: FeedbackFormState): FormErrors {
  const errors: FormErrors = {};
  if (!state.message.trim()) {
    errors.message = 'Required';
  }
  const handle = handleError(state);
  if (handle) {
    errors.handle = handle;
  }
  return errors;
}

/** The request body. Fields the chosen type doesn't ask for are left out. */
export function buildSubmission(state: FeedbackFormState, honeypot: string): FeedbackSubmission & { hp: string } {
  const submission: FeedbackSubmission & { hp: string } = {
    type: state.type,
    message: state.message.trim(),
    hp: honeypot
  };
  const correction = state.correction.trim();
  const page = state.page.trim();
  if (state.type === 'wrong' && correction) {
    submission.correction = correction;
  }
  if (state.type === 'wrong' && page) {
    submission.page = page;
  }
  if (state.wantsReply) {
    submission.reply = { method: state.method, handle: state.handle.trim() };
  }
  if (state.environment) {
    submission.environment = state.environment;
  }
  return submission;
}

export async function sendFeedback(body: unknown, fetchImpl: typeof fetch = fetch): Promise<SendOutcome> {
  try {
    const response = await fetchImpl('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (response.ok) {
      return 'sent';
    }
    return response.status === 429 ? 'limited' : 'failed';
  } catch {
    return 'failed';
  }
}
