/**
 * /feedback: one form for anything a visitor wants to tell us.
 *
 * Nothing is picked up front. The two types ask different questions, so the
 * fields appear once one is chosen. The footer link passes the page the visitor
 * was on as `?from=`, which prefills the Page field. Device details are read
 * locally to show what would be sent, and only leave the browser when the
 * visitor ticks the box.
 * @module pages/FeedbackPage
 */

import { useSearchParams } from '@solidjs/router';
import { createSignal, For, type JSX, onMount, Show } from 'solid-js';
import {
  CONTACT_METHODS,
  type ContactMethod,
  CORRECTION_LABEL,
  type Environment,
  ENVIRONMENT_FIELDS,
  ENVIRONMENT_KEYS,
  FEEDBACK_LIMITS,
  FEEDBACK_TYPES,
  type FeedbackType,
  MESSAGE_LABELS,
  normalizePagePath,
  PAGE_LABEL
} from '../../shared/feedback';
import { collectEnvironment } from '../lib/feedbackEnvironment';
import { buildSubmission, type FormErrors, sendFeedback, type SendOutcome, validateForm } from '../lib/feedbackForm';
import { mode } from '../lib/theme';
import '../styles/pages/feedback.css';

const TYPE_KEYS = Object.keys(FEEDBACK_TYPES) as FeedbackType[];
const METHOD_KEYS = Object.keys(CONTACT_METHODS) as ContactMethod[];

const TYPE_DESCRIPTIONS: Record<FeedbackType, string> = {
  wrong: 'Bad data, a broken page, anything that isn’t right.',
  say: 'Ideas, questions, thanks.'
};

type Status = 'idle' | 'sending' | SendOutcome;

const STATUS_TEXT: Partial<Record<Status, string>> = {
  failed: 'Couldn’t send. Try again in a minute.',
  limited: 'Too many sends from here. Try again in an hour.'
};

const errorId = (id: string) => `${id}-error`;

function Field(props: {
  id: string;
  label: string;
  marker?: string;
  error?: string | undefined;
  children: JSX.Element;
}) {
  return (
    <div class='feedback-field'>
      <label class='feedback-label' for={props.id}>
        {props.label}
        <Show when={props.marker}>
          <span class='feedback-marker'>{props.marker}</span>
        </Show>
      </label>
      {props.children}
      <Show when={props.error}>
        <span class='feedback-error' id={errorId(props.id)}>
          {props.error}
        </span>
      </Show>
    </div>
  );
}

/** Attributes that tie a control to its Field's error line while one shows. */
function invalidAttrs(id: string, error: string | undefined) {
  return error ? { 'aria-invalid': true, 'aria-describedby': errorId(id) } : {};
}

function TypeChoice(props: { value: FeedbackType | null; onSelect: (type: FeedbackType) => void }) {
  return (
    <fieldset class='feedback-fieldset'>
      <legend class='feedback-label'>What’s this about?</legend>
      <div class='feedback-choices'>
        <For each={TYPE_KEYS}>
          {key => (
            <label class='feedback-choice'>
              <input
                type='radio'
                name='feedback-type'
                value={key}
                checked={props.value === key}
                onChange={() => props.onSelect(key)}
              />
              <span class='feedback-choice-title'>{FEEDBACK_TYPES[key]}</span>
              <span class='feedback-choice-desc'>{TYPE_DESCRIPTIONS[key]}</span>
            </label>
          )}
        </For>
      </div>
    </fieldset>
  );
}

interface ReplyProps {
  wantsReply: boolean;
  method: ContactMethod;
  handle: string;
  error: string | undefined;
  onWantsReply: (wants: boolean) => void;
  onMethod: (method: ContactMethod) => void;
  onHandle: (handle: string) => void;
}

function ReplyFields(props: ReplyProps) {
  const isEmail = () => props.method === 'email';
  return (
    <>
      <fieldset class='feedback-fieldset'>
        <legend class='feedback-label'>Want a reply?</legend>
        <div class='feedback-radios'>
          <label class='feedback-radio'>
            <input
              type='radio'
              name='feedback-reply'
              checked={!props.wantsReply}
              onChange={() => props.onWantsReply(false)}
            />
            No need
          </label>
          <label class='feedback-radio'>
            <input
              type='radio'
              name='feedback-reply'
              checked={props.wantsReply}
              onChange={() => props.onWantsReply(true)}
            />
            Yes
          </label>
        </div>
      </fieldset>
      <Show when={props.wantsReply}>
        <Field id='feedback-method' label='Where should it go?'>
          <select
            id='feedback-method'
            class='feedback-input feedback-select'
            value={props.method}
            onChange={event => props.onMethod(event.currentTarget.value as ContactMethod)}
          >
            {/* `selected` per option: a select re-created by <Show> can take its
                value before its options exist, and show Email while holding Discord. */}
            <For each={METHOD_KEYS}>
              {key => (
                <option value={key} selected={props.method === key}>
                  {CONTACT_METHODS[key]}
                </option>
              )}
            </For>
          </select>
        </Field>
        <Field id='feedback-handle' label='Address or handle' error={props.error}>
          <input
            id='feedback-handle'
            class='feedback-input'
            type={isEmail() ? 'email' : 'text'}
            autocomplete={isEmail() ? 'email' : 'off'}
            maxLength={FEEDBACK_LIMITS.handle}
            value={props.handle}
            {...invalidAttrs('feedback-handle', props.error)}
            onInput={event => props.onHandle(event.currentTarget.value)}
          />
        </Field>
      </Show>
    </>
  );
}

function EnvironmentOptIn(props: {
  checked: boolean;
  environment: Environment | null;
  unavailable: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div class='feedback-env'>
      <label class='feedback-check'>
        <input
          type='checkbox'
          checked={props.checked}
          onChange={event => props.onChange(event.currentTarget.checked)}
        />
        <span>Include my browser, device, and OS</span>
      </label>
      <Show when={props.checked && props.environment}>
        {environment => (
          <dl class='feedback-env-list'>
            <For each={ENVIRONMENT_KEYS.filter(key => environment()[key])}>
              {key => (
                <>
                  <dt>{ENVIRONMENT_FIELDS[key]}</dt>
                  <dd>{environment()[key]}</dd>
                </>
              )}
            </For>
          </dl>
        )}
      </Show>
      <Show when={props.checked && props.unavailable}>
        <p class='feedback-hint'>Couldn’t read your device details, so none will be sent.</p>
      </Show>
    </div>
  );
}

function SentNotice(props: { onReset: () => void }) {
  let heading: HTMLHeadingElement | undefined;
  onMount(() => heading?.focus());
  return (
    <div class='feedback-done'>
      <h2 ref={heading} tabIndex={-1}>
        Sent
      </h2>
      <p class='feedback-hint'>Thanks.</p>
      <button type='button' class='btn btn-secondary' onClick={() => props.onReset()}>
        Send another
      </button>
    </div>
  );
}

export function FeedbackPage(): JSX.Element {
  const [searchParams] = useSearchParams<{ from?: string }>();
  const [type, setType] = createSignal<FeedbackType | null>(null);
  const [message, setMessage] = createSignal('');
  const [correction, setCorrection] = createSignal('');
  const [page, setPage] = createSignal(normalizePagePath(searchParams.from));
  const [wantsReply, setWantsReply] = createSignal(false);
  const [method, setMethod] = createSignal<ContactMethod>('email');
  const [handle, setHandle] = createSignal('');
  const [includeEnvironment, setIncludeEnvironment] = createSignal(false);
  const [environment, setEnvironment] = createSignal<Environment | null>(null);
  const [errors, setErrors] = createSignal<FormErrors>({});
  const [status, setStatus] = createSignal<Status>('idle');
  let honeypot: HTMLInputElement | undefined;

  const [environmentUnavailable, setEnvironmentUnavailable] = createSignal(false);

  // Read once, on arrival. Submit awaits it if the visitor opted in faster than it finished.
  const readEnvironment = (): Promise<Environment | null> =>
    collectEnvironment(mode())
      .then(result => {
        setEnvironment(result);
        return result;
      })
      .catch(() => {
        setEnvironmentUnavailable(true);
        return null;
      });
  onMount(() => {
    document.title = 'Feedback — Ciphermaniac';
    void readEnvironment();
  });

  const clearError = (key: keyof FormErrors) => setErrors(previous => ({ ...previous, [key]: undefined }));

  const reset = () => {
    setType(null);
    setMessage('');
    setCorrection('');
    setWantsReply(false);
    setHandle('');
    setIncludeEnvironment(false);
    setErrors({});
    setStatus('idle');
    // The button that had focus is gone; put the visitor back at the top of the form.
    queueMicrotask(() => document.querySelector<HTMLInputElement>('input[name="feedback-type"]')?.focus());
  };

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    const current = type();
    if (!current || status() === 'sending') {
      return;
    }
    // A failure message from an earlier attempt must not sit beside new field errors.
    setStatus('idle');
    const state = {
      type: current,
      message: message(),
      correction: correction(),
      page: page(),
      wantsReply: wantsReply(),
      method: method(),
      handle: handle(),
      environment: includeEnvironment() ? (environment() ?? (await readEnvironment())) : null
    };
    const found = validateForm(state);
    setErrors(found);
    const firstInvalid = found.message ? 'feedback-message' : found.handle ? 'feedback-handle' : null;
    if (firstInvalid) {
      document.getElementById(firstInvalid)?.focus();
      return;
    }
    setStatus('sending');
    setStatus(await sendFeedback(buildSubmission(state, honeypot?.value ?? '')));
  };

  return (
    <section class='feedback-page'>
      <h1 class='sr-only'>Feedback</h1>
      <Show when={status() !== 'sent'} fallback={<SentNotice onReset={reset} />}>
        <form class='feedback-form' novalidate onSubmit={event => void submit(event)}>
          <TypeChoice value={type()} onSelect={setType} />
          <Show when={type()}>
            {current => (
              <>
                <Field id='feedback-message' label={MESSAGE_LABELS[current()]} error={errors().message}>
                  <textarea
                    id='feedback-message'
                    class='feedback-input feedback-textarea'
                    rows={current() === 'say' ? 5 : 4}
                    maxLength={FEEDBACK_LIMITS.message}
                    value={message()}
                    {...invalidAttrs('feedback-message', errors().message)}
                    onInput={event => {
                      setMessage(event.currentTarget.value);
                      clearError('message');
                    }}
                  />
                </Field>
                <Show when={current() === 'wrong'}>
                  <Field id='feedback-correction' label={CORRECTION_LABEL} marker='if you know'>
                    <input
                      id='feedback-correction'
                      class='feedback-input'
                      maxLength={FEEDBACK_LIMITS.correction}
                      value={correction()}
                      onInput={event => setCorrection(event.currentTarget.value)}
                    />
                  </Field>
                  <Field id='feedback-page' label={PAGE_LABEL} marker='optional'>
                    <input
                      id='feedback-page'
                      class='feedback-input'
                      maxLength={FEEDBACK_LIMITS.page}
                      value={page()}
                      onInput={event => setPage(event.currentTarget.value)}
                    />
                  </Field>
                </Show>
                <ReplyFields
                  wantsReply={wantsReply()}
                  method={method()}
                  handle={handle()}
                  error={errors().handle}
                  onWantsReply={setWantsReply}
                  onMethod={value => {
                    setMethod(value);
                    clearError('handle');
                  }}
                  onHandle={value => {
                    setHandle(value);
                    clearError('handle');
                  }}
                />
                <EnvironmentOptIn
                  checked={includeEnvironment()}
                  environment={environment()}
                  unavailable={environmentUnavailable()}
                  onChange={setIncludeEnvironment}
                />
                <input
                  ref={honeypot}
                  class='feedback-hp'
                  type='text'
                  name='hp'
                  tabIndex={-1}
                  autocomplete='off'
                  aria-hidden='true'
                />
                <div class='feedback-actions'>
                  <button type='submit' class='btn btn-primary' disabled={status() === 'sending'}>
                    {status() === 'sending' ? 'Sending…' : 'Send'}
                  </button>
                  <span class='feedback-status' role='status' aria-live='polite'>
                    {STATUS_TEXT[status()] ?? ''}
                  </span>
                </div>
              </>
            )}
          </Show>
        </form>
      </Show>
    </section>
  );
}
