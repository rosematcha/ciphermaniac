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
import { createResource, createSignal, type JSX, onMount, Show, untrack } from 'solid-js';
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

type Path = 'community' | 'store';

const PATHS: Record<Path, { title: string; joined: string; line: string; held: string }> = {
  community: {
    title: 'I want to run a tournament for fun',
    joined: 'Community organizer',
    line: "Run unofficial, unsanctioned events using Ciphermaniac's swiss system.",
    held: 'You are currently approved for unsanctioned events.'
  },
  store: {
    title: 'I run an official Play! Pokémon store',
    joined: 'I run an official Play! Pokémon store',
    line: 'Sync TOM with Ciphermaniac to run sanctioned events with our tools. Requires admin approval.',
    held: 'You are currently not approved for sanctioned events.'
  }
};

function SignedOut(props: { offer: SignInOffer }) {
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
          <SignIn offer={props.offer} next='/apply' />
        </div>
      </section>
    </>
  );
}

/** One way in: what it is, and, for a Community organizer, what it may run and may not yet. */
function PathRow(props: { path: Path; joined: boolean; children: JSX.Element }) {
  const words = () => PATHS[props.path];
  return (
    <div class='tm-path'>
      <div class='tm-path-text'>
        <h2 class='tm-path-title'>{props.joined ? words().joined : words().title}</h2>
        <span class='muted'>{words().line}</span>
        <Show when={props.joined}>
          <span class='tm-path-held' classList={{ 'is-held': props.path === 'community' }}>
            {words().held}
          </span>
        </Show>
      </div>
      {props.children}
    </div>
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
    <span class='tm-path-step'>
      <button type='button' class='btn btn-primary' disabled={busy()} onClick={() => void start()}>
        Community organizer
      </button>
      <ErrorLine message={error()} />
    </span>
  );
}

/**
 * The two ways in, one row each: a player may become a Community organizer
 * at once; a Community organizer is told it runs unsanctioned events alone,
 * with the way to its events; any account may open the store application.
 */
function PathRows(props: { role: Me['role']; storeOpen: boolean; onStore: () => void }) {
  const joined = () => props.role === 'community';
  return (
    <section class='tm-box tm-paths'>
      <Show when={canJoinCommunity(props.role) || joined()}>
        <PathRow path='community' joined={joined()}>
          <Show when={joined()} fallback={<CommunityStart />}>
            <A class='btn btn-secondary' href='/host'>
              Your events
            </A>
          </Show>
        </PathRow>
      </Show>
      <PathRow path='store' joined={joined()}>
        <button type='button' class='btn btn-secondary' aria-expanded={props.storeOpen} onClick={() => props.onStore()}>
          Apply as store
        </button>
      </PathRow>
    </section>
  );
}

/** Signed in: where the account stands, then the rows when it may take one now. */
function Applying(props: { user: Me }) {
  const [params] = useSearchParams<{ again?: string }>();
  const [state, { refetch, mutate }] = createResource(fetchApplication);
  // Settings' Apply again opens the rows as the page opens, at the store, which is what was applied for.
  const [again, setAgain] = createSignal(params.again !== undefined);
  const [storeOpen, setStoreOpen] = createSignal(untrack(again));
  const current = () => latestValue(state);
  createSessionCatchUp(
    () => props.user.role,
    () => current()?.application
  );
  const stage = () => applicantStage(props.user.role, current()?.application ?? null);
  const open = () => stage() !== 'pending' && ((stage() !== 'rejected' && stage() !== 'revoked') || again());
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
            <Show when={stage() !== 'none' && stage() !== 'community'}>
              <ApplicantStatus
                stage={stage()}
                application={s().application}
                again={!open()}
                onApplyAgain={() => {
                  setAgain(true);
                  setStoreOpen(true);
                }}
                onChanged={() => void refetch()}
              />
            </Show>
            <Show when={open()}>
              <PathRows role={props.user.role} storeOpen={storeOpen()} onStore={() => setStoreOpen(true)} />
              <Show when={storeOpen()}>
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
