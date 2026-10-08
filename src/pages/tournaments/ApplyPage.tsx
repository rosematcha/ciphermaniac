/**
 * /apply: an account starts running events, one of two ways, picked from two
 * rows. A Community organizer runs unsanctioned events under its own name,
 * and becomes one at once; a Store is a certified Play! Pokémon league
 * location, which an admin approves from its Application (see
 * StoreApplicationForm). Only an account whose profile is complete, its POP
 * ID included, may apply for a store; an incomplete one is sent to Settings.
 * An account with an Application pending sees where it stands instead (see
 * ApplicantStatus); a rejected one, or one whose access was removed, opens
 * the rows again from there. Signed out, one box to sign in.
 */

import { A, useNavigate, useSearchParams } from '@solidjs/router';
import { createResource, createSignal, For, onMount, Show, untrack } from 'solid-js';
import { canJoinCommunity } from '../../../shared/accounts/roles';
import type { MyApplication } from '../../../shared/accounts/types';
import { Skeleton } from '../../components/Skeleton';
import { errorText, type Me, type SignInOffer } from '../../lib/tournament/api';
import { applicantStage, fetchApplication } from '../../lib/tournament/applications';
import { joinCommunity } from '../../lib/tournament/stores';
import { latestValue } from '../../lib/resource';
import { ApplicantStatus, createSessionCatchUp } from './ApplicantStatus';
import { ErrorLine } from './Field';
import { TournamentHero } from './Hero';
import { refreshSession, session } from './session';
import { SignIn } from './SignIn';
import { StoreApplicationForm } from './StoreApplicationForm';
import '../../styles/pages/tournament-store-apply.css';

const TITLE = 'Run events';
const SUBTITLE = 'Select a permissions level for your account.';

type Path = 'community' | 'store';

const PATHS: { value: Path; title: string; line: string }[] = [
  {
    value: 'community',
    title: 'Community organizer',
    line: "Run unsanctioned tournaments using Ciphermaniac's in-built Swiss system"
  },
  {
    value: 'store',
    title: 'Organized play location',
    line: "Run official Play! Pokémon events through TOM with Ciphermaniac's additional features"
  }
];

function SignedOut(props: { offer: SignInOffer }) {
  return (
    <>
      <TournamentHero title={TITLE} meta={<span class='muted'>{SUBTITLE}</span>} />
      <section class='tm-box'>
        <div class='tm-box-bar'>
          <strong>Sign in</strong>
          <span class='tm-grow' />
          <span class='tm-flag'>Signed out</span>
        </div>
        <div class='tm-box-bar'>
          <SignIn offer={props.offer} next='/apply' />
        </div>
      </section>
    </>
  );
}

/** The two ways in, as full-width radio rows; a path the account cannot take is left out. */
function PathChoice(props: { paths: readonly Path[]; chosen: Path | null; onChoose: (path: Path) => void }) {
  return (
    <fieldset class='tm-box tm-choices'>
      <legend class='sr-only'>How you run events</legend>
      <For each={PATHS.filter(path => props.paths.includes(path.value))}>
        {path => (
          <label class='tm-choice' classList={{ 'is-on': props.chosen === path.value }}>
            <input
              type='radio'
              name='apply-path'
              value={path.value}
              checked={props.chosen === path.value}
              onChange={() => props.onChoose(path.value)}
            />
            <span class='tm-choice-text'>
              <strong>{path.title}</strong>
              <span class='muted'>{path.line}</span>
            </span>
          </label>
        )}
      </For>
    </fieldset>
  );
}

/** Becoming a Community organizer: one press, then on to the events page. */
function CommunityStart() {
  const navigate = useNavigate();
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  async function start() {
    setBusy(true);
    setError(null);
    try {
      await joinCommunity();
      await refreshSession();
      navigate('/host');
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }
  return (
    <div class='tm-apply-foot'>
      <button type='button' class='btn btn-primary' disabled={busy()} onClick={() => void start()}>
        Start running events
      </button>
      <ErrorLine message={error()} />
    </div>
  );
}

/** Signed in: where the account stands, then the rows when it may take one now. */
function Applying(props: { user: Me }) {
  const [params] = useSearchParams<{ again?: string }>();
  const [state, { refetch, mutate }] = createResource(fetchApplication);
  // Settings' Apply again opens the rows as the page opens, at the store, which is what was applied for.
  const [again, setAgain] = createSignal(params.again !== undefined);
  const [chosen, setChosen] = createSignal<Path | null>(untrack(again) ? 'store' : null);
  const current = () => latestValue(state);
  createSessionCatchUp(
    () => props.user.role,
    () => current()?.application
  );
  const stage = () => applicantStage(props.user.role, current()?.application ?? null);
  const open = () => stage() !== 'pending' && ((stage() !== 'rejected' && stage() !== 'revoked') || again());
  const paths = (): Path[] => (canJoinCommunity(props.user.role) ? ['community', 'store'] : ['store']);
  const sent = (application: MyApplication) => mutate(prev => prev && { ...prev, application, proof: null });
  return (
    <>
      <TournamentHero title={TITLE} meta={<span class='muted'>{SUBTITLE}</span>} />
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
                onApplyAgain={() => {
                  setAgain(true);
                  setChosen('store');
                }}
                onChanged={() => void refetch()}
              />
            </Show>
            <Show when={open()}>
              <PathChoice paths={paths()} chosen={chosen()} onChoose={setChosen} />
              <Show when={chosen() === 'community' && paths().includes('community')}>
                <CommunityStart />
              </Show>
              <Show when={chosen() === 'store'}>
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
                  <Show
                    when={s().eligible.email}
                    fallback={
                      // Placeholder copy until the recovery-email section in Settings exists.
                      <p class='tm-apply-profile'>
                        Add an email first.{' '}
                        <A class='tm-link-inline' href='/settings'>
                          Settings
                        </A>
                      </p>
                    }
                  >
                    <StoreApplicationForm
                      proof={s().proof}
                      onSent={sent}
                      onStale={() => {
                        void refetch();
                        void refreshSession();
                      }}
                    />
                  </Show>
                </Show>
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
    <div class='tm-page tm-narrow tm-apply-page'>
      <Show when={current()}>
        {s => (
          <Show when={s().user} fallback={<SignedOut offer={s()} />}>
            {user => <Applying user={user()} />}
          </Show>
        )}
      </Show>
    </div>
  );
}
