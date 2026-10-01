/**
 * /apply: an account applies to run events. Only an account whose profile is
 * complete, its POP ID included, may; an incomplete one is sent to Settings.
 * The form takes proof of organizer certification, an explanation, or both:
 * the proof goes up the moment it is picked (it shows its name and size,
 * and can be removed), and Send application waits for one or the other. An
 * account with an Application pending, approved or whose access was removed
 * sees where it stands instead (see ApplicantStatus); a rejected or revoked
 * one opens the form again from there. Signed out, one box to sign in.
 */

import { A, useSearchParams } from '@solidjs/router';
import { createResource, createSignal, onMount, Show } from 'solid-js';
import { EXPLANATION_MAX, PROOF_MAX_BYTES } from '../../../shared/accounts/applications';
import type { MyApplication, ProofSlot } from '../../../shared/accounts/types';
import { Skeleton } from '../../components/Skeleton';
import { ApiError, errorText, type Me, type Provider } from '../../lib/tournament/api';
import {
  applicantStage,
  fetchApplication,
  fileSize,
  proofKind,
  removeProof,
  sendApplication,
  uploadProof
} from '../../lib/tournament/applications';
import { latestValue } from '../../lib/resource';
import { ApplicantStatus } from './ApplicantStatus';
import { ErrorLine } from './Field';
import { TournamentHero } from './Hero';
import { session } from './session';
import { SignIn } from './SignIn';

const TITLE = 'Apply to run events';

/** The proof uploaded: its type and size, and its name when it was picked on this page. */
type Proof = ProofSlot & { name: string | null };

function SignedOut(props: { providers: readonly Provider[] }) {
  return (
    <>
      <TournamentHero title={TITLE} />
      <section class='tm-box'>
        <div class='tm-box-bar'>
          <strong>Sign in</strong>
          <span class='tm-grow' />
          <span class='tm-flag'>Signed out</span>
        </div>
        <div class='tm-box-bar'>
          <SignIn providers={props.providers} next='/apply' />
        </div>
      </section>
    </>
  );
}

/** The proof row: pick a file and it uploads; once up, its name and size, and Remove. */
function ProofField(props: {
  proof: Proof | null;
  onChange: (proof: Proof | null) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [uploading, setUploading] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  async function upload(file: File) {
    setError(null);
    if (file.size > PROOF_MAX_BYTES) {
      setError('Up to 8 MB');
      return;
    }
    setUploading(file.name);
    props.onBusy(true);
    try {
      const { proof } = await uploadProof(file);
      props.onChange({ ...proof, name: file.name });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setUploading(null);
      props.onBusy(false);
    }
  }
  async function remove() {
    setError(null);
    try {
      await removeProof();
      props.onChange(null);
    } catch (err) {
      setError(errorText(err));
    }
  }
  return (
    <div class='tm-box-bar tm-form-row'>
      <span class='tm-form-row-label'>Proof</span>
      <div class='tm-apply-proof'>
        <Show
          when={props.proof}
          fallback={
            <Show
              when={uploading()}
              fallback={
                <label class='btn btn-secondary tm-apply-pick'>
                  Choose file
                  <input
                    type='file'
                    class='sr-only'
                    aria-label='Proof'
                    accept='.png,.jpg,.jpeg,.webp,.pdf'
                    onChange={event => {
                      const input = event.currentTarget;
                      const file = input.files?.[0];
                      // Cleared, so picking the same file again uploads it again.
                      input.value = '';
                      if (file) {
                        void upload(file);
                      }
                    }}
                  />
                </label>
              }
            >
              {name => (
                <span class='tm-apply-file muted' role='status'>
                  Uploading {name()}
                </span>
              )}
            </Show>
          }
        >
          {proof => (
            <span class='tm-apply-file'>
              <span class='tm-apply-name'>{proof().name ?? proofKind(proof().type)}</span>
              <span class='muted tm-num tm-nowrap'>{fileSize(proof().size)}</span>
              <button type='button' class='btn btn-ghost tm-small' onClick={() => void remove()}>
                Remove
              </button>
            </span>
          )}
        </Show>
        <ErrorLine message={error()} />
      </div>
    </div>
  );
}

/**
 * The Application: the proof, the explanation with its count, and Send
 * application, which waits for one or the other. A refusal over the profile
 * or a pending Application rereads the account (`onStale`).
 */
function ApplicationForm(props: {
  proof: ProofSlot | null;
  onSent: (sent: MyApplication) => void;
  onStale: () => void;
}) {
  // The proof picked or removed here; until then, the one the page opened with.
  const [picked, setProof] = createSignal<Proof | null | undefined>(undefined);
  const proof = () => {
    const current = picked();
    return current === undefined ? props.proof && { ...props.proof, name: null } : current;
  };
  const [explanation, setExplanation] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const ready = () => proof() !== null || explanation().trim() !== '';
  async function send(event: Event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { application } = await sendApplication(explanation(), proof() !== null);
      props.onSent(application);
    } catch (err) {
      setError(errorText(err));
      if (err instanceof ApiError && (err.body?.profile === true || err.status === 409)) {
        props.onStale();
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <form class='tm-box tm-apply-form' onSubmit={event => void send(event)}>
      <ProofField proof={proof()} onChange={setProof} onBusy={setBusy} />
      <div class='tm-box-bar tm-form-row'>
        <label class='tm-form-row-label' for='apply-explanation'>
          Explanation
        </label>
        <div class='tm-apply-explain'>
          <textarea
            id='apply-explanation'
            class='tm-input tm-textarea'
            maxlength={EXPLANATION_MAX}
            value={explanation()}
            onInput={event => setExplanation(event.currentTarget.value)}
          />
          <span class='muted tm-num tm-apply-count'>
            {explanation().length} / {EXPLANATION_MAX}
          </span>
        </div>
      </div>
      <div class='tm-box-bar tm-apply-foot'>
        <button type='submit' class='btn btn-primary' disabled={!ready() || busy()}>
          Send application
        </button>
        <ErrorLine message={error()} />
      </div>
    </form>
  );
}

/** Signed in: where the account stands, then the form when it may apply now. */
function Applying(props: { user: Me }) {
  const [params] = useSearchParams<{ again?: string }>();
  const [state, { refetch, mutate }] = createResource(fetchApplication);
  // Settings' Apply again opens the form as the page opens.
  const [again, setAgain] = createSignal(params.again !== undefined);
  const current = () => latestValue(state);
  const stage = () => applicantStage(props.user.role, current()?.application ?? null);
  const open = () => stage() === 'none' || ((stage() === 'rejected' || stage() === 'revoked') && again());
  const sent = (application: MyApplication) => mutate(prev => prev && { ...prev, application, proof: null });
  return (
    <>
      <TournamentHero title={TITLE} />
      <Show
        when={current()}
        fallback={
          <Show when={state.error} fallback={<Skeleton height='160px' />}>
            <ErrorLine message={errorText(state.error)} />
            <button type='button' class='btn btn-secondary tm-small' onClick={() => void refetch()}>
              Retry
            </button>
          </Show>
        }
      >
        {s => (
          <div class='tm-apply'>
            <Show when={stage() !== 'none'}>
              <ApplicantStatus
                stage={stage()}
                application={s().application}
                again={!open()}
                onApplyAgain={() => setAgain(true)}
                onChanged={() => void refetch()}
              />
            </Show>
            <Show when={open()}>
              <Show
                when={s().eligible.profile}
                fallback={
                  <p class='tm-apply-profile'>
                    <A class='btn btn-primary' href='/settings'>
                      Complete your profile
                    </A>
                  </p>
                }
              >
                <ApplicationForm proof={s().proof} onSent={sent} onStale={() => void refetch()} />
              </Show>
            </Show>
          </div>
        )}
      </Show>
    </>
  );
}

export function ApplyPage() {
  const current = () => latestValue(session);
  onMount(() => {
    document.title = `${TITLE} — Ciphermaniac`;
  });
  return (
    <div class='tm-page tm-narrow'>
      <Show when={current()}>
        {s => (
          <Show when={s().user} fallback={<SignedOut providers={s().providers} />}>
            {user => <Applying user={user()} />}
          </Show>
        )}
      </Show>
    </div>
  );
}
