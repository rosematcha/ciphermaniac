/**
 * /settings (and the older /account). Signed in: who you are (a small
 * picture or initial, your name, your events, sign out, and which sign-ins
 * are linked), your username, the player profile that decklists and
 * "find my table" fill themselves in from (its name is the one the site
 * calls you by), History: the way to it, whether it is public at
 * /u/<username> and which name it shows, and Organizer: where the account
 * stands on running events, with the way to apply, its events or the admin
 * page, and My data: export, wipe or delete (MyData). A POP ID another account holds is refused, with the way to the
 * feedback form, where an admin settles who holds it. Signed out: one box to
 * sign in.
 */

import { A, useNavigate, useSearchParams } from '@solidjs/router';
import { createEffect, createMemo, createResource, createSignal, For, on, onMount, Show } from 'solid-js';
import { displayName, HANDLE_MAX, handleProblem, normalizeHandle } from '../../../shared/accounts/handle';
import type { PlayerProfile } from '../../../shared/tournament/profile';
import {
  ApiError,
  errorText,
  linkUrl,
  type Me,
  type OAuthProvider,
  type Provider,
  saveHandle,
  saveProfile,
  setProfileName,
  setPublicProfile,
  type SignInOffer,
  signOut
} from '../../lib/tournament/api';
import { applicantStage, fetchApplication } from '../../lib/tournament/applications';
import { latestValue } from '../../lib/resource';
import { Skeleton } from '../../components/Skeleton';
import { ApplicantStatus } from './ApplicantStatus';
import { OrganizerRoles } from './OrganizerRoles';
import { Avatar } from './Avatar';
import { MyData } from './MyData';
import { ErrorLine } from './Field';
import { emptyProfile, ProfileFields, profileProblems } from './ProfileFields';
import { refreshSession, session, setSession } from './session';
import { SettingRow, Toggle } from './SettingControls';
import { SettingInfo } from './SettingInfo';
import { SignIn } from './SignIn';

/**
 * Takes in the fields one save changed, and only those: each answer carries
 * the whole account as its request read it, so an answer landing after
 * another save's would put back what that save changed. The name follows
 * from the profile and username as they now stand.
 */
function mergeUser(user: Me, ...fields: (keyof Me)[]) {
  setSession(prev => {
    if (!prev?.user) {
      return prev;
    }
    const next: Me = { ...prev.user, ...Object.fromEntries(fields.map(field => [field, user[field]])) };
    return { ...prev, user: { ...next, name: displayName(next) } };
  });
}

const PROVIDER_NAMES: Record<OAuthProvider, string> = { google: 'Google', discord: 'Discord' };

function Identity(props: { user: Me; providers: readonly Provider[] }) {
  const navigate = useNavigate();
  async function leave() {
    await signOut().catch(() => undefined);
    await refreshSession();
    navigate('/');
  }
  const offered = () => (['google', 'discord'] as const).filter(provider => props.providers.includes(provider));
  return (
    <section class='tm-identity'>
      <Avatar name={props.user.name} src={props.user.avatar} />
      <h1>{props.user.name}</h1>
      <div class='tm-identity-acts'>
        <A class='btn btn-secondary' href='/host'>
          Your events
        </A>
        <button type='button' class='btn btn-ghost' onClick={() => void leave()}>
          Sign out
        </button>
      </div>
      <p class='tm-identity-links'>
        <For each={offered()}>
          {provider => (
            <Show
              when={props.user.providers.includes(provider)}
              fallback={
                <a class='tm-link-inline' href={linkUrl(provider)} rel='external'>
                  Link {PROVIDER_NAMES[provider]}
                </a>
              }
            >
              <span class='muted'>{PROVIDER_NAMES[provider]} linked</span>
            </Show>
          )}
        </For>
      </p>
    </section>
  );
}

/** The username, checked as it is typed; the server says whether someone else holds it. */
function Username(props: { user: Me }) {
  // eslint-disable-next-line solid/reactivity -- the input edits a copy of the username it opened with
  const [handle, setHandle] = createSignal(props.user.handle);
  const [error, setError] = createSignal<string | null>(null);
  const [saved, setSaved] = createSignal(false);
  // A wipe hands the account a new username; the input follows it, and only when it changes.
  const current = createMemo(() => props.user.handle);
  createEffect(on(current, next => setHandle(next), { defer: true }));
  const wanted = () => normalizeHandle(handle());
  const problem = () => (wanted() === props.user.handle ? null : handleProblem(wanted()));
  async function save(event: Event) {
    event.preventDefault();
    if (problem()) {
      return;
    }
    try {
      const result = await saveHandle(wanted());
      mergeUser(result.user, 'handle');
      setError(null);
      setSaved(true);
    } catch (err) {
      setError(errorText(err));
    }
  }
  return (
    <section>
      <h2 class='tm-subhead tm-box-head'>Username</h2>
      <form class='tm-box' onSubmit={event => void save(event)}>
        <div class='tm-box-bar'>
          <input
            class='tm-input tm-grow'
            maxlength={HANDLE_MAX}
            aria-label='Username'
            autocapitalize='none'
            autocomplete='username'
            spellcheck={false}
            aria-invalid={problem() !== null}
            value={handle()}
            onInput={event => {
              setHandle(event.currentTarget.value);
              setError(null);
              setSaved(false);
            }}
          />
          <Show when={saved()}>
            <span class='muted' role='status'>
              Saved
            </span>
          </Show>
          <button
            class='btn btn-secondary'
            type='submit'
            disabled={wanted() === props.user.handle || problem() !== null}
          >
            Save username
          </button>
        </div>
      </form>
      <ErrorLine message={problem() ?? error()} />
    </section>
  );
}

function Profile(props: { user: Me }) {
  // eslint-disable-next-line solid/reactivity -- the form edits a copy of the profile it opened with
  const [profile, setProfile] = createSignal<PlayerProfile>(emptyProfile(props.user));
  const [touched, setTouched] = createSignal(false);
  const [status, setStatus] = createSignal<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = createSignal<string | null>(null);
  /** Whether the POP ID was refused as another account's, which the feedback form is the way to settle. */
  const [clash, setClash] = createSignal(false);
  createEffect(() => {
    if (!touched()) {
      setProfile(emptyProfile(props.user));
    }
  });
  const problems = () => (touched() ? profileProblems(profile()) : {});

  async function save(event: Event) {
    event.preventDefault();
    setTouched(true);
    if (Object.keys(profileProblems(profile())).length > 0) {
      return;
    }
    setStatus('saving');
    setError(null);
    setClash(false);
    try {
      const { user } = await saveProfile(profile());
      mergeUser(user, 'popId', 'firstName', 'lastName', 'birthDate');
      setStatus('saved');
    } catch (err) {
      setError(errorText(err));
      setClash(err instanceof ApiError && err.body?.popIdTaken === true);
      setStatus('idle');
    }
  }

  return (
    <section>
      <h2 class='tm-subhead tm-box-head'>Player profile</h2>
      <form class='tm-box' onSubmit={event => void save(event)}>
        <div class='tm-box-bar tm-profile-bar'>
          <ProfileFields
            idPrefix='settings'
            value={profile()}
            errors={problems()}
            onChange={value => {
              setTouched(true);
              setStatus('idle');
              setProfile(value);
            }}
          />
        </div>
        <div class='tm-box-bar tm-set-foot'>
          <Show when={status() === 'saved'}>
            <span class='muted' role='status'>
              Saved
            </span>
          </Show>
          <button type='submit' class='btn btn-primary' disabled={status() === 'saving'}>
            Save profile
          </button>
        </div>
      </form>
      <Show when={clash()} fallback={<ErrorLine message={error()} />}>
        <p class='tm-error' role='alert'>
          {error()}
          <span class='dot' aria-hidden='true'>
            {' · '}
          </span>
          <A class='tm-link-inline' href='/feedback?from=/settings'>
            Feedback
          </A>
        </p>
      </Show>
    </section>
  );
}

/** The public profile's address in full, as it is shared. */
const profileUrl = (handle: string) => `${location.origin}/u/${handle}`;

/**
 * History: the way to it, and the public profile, off unless the account
 * turns it on; on, which name it shows, its link and a way to copy it. The
 * address is the username, so a link shared before works again once the
 * profile is turned back on.
 */
function HistorySection(props: { user: Me }) {
  const [busy, setBusy] = createSignal(false);
  const [copied, setCopied] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  async function change(field: 'publicProfile' | 'profileName', ask: () => Promise<{ user: Me }>) {
    if (busy()) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { user } = await ask();
      mergeUser(user, field);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    await navigator.clipboard.writeText(profileUrl(props.user.handle));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <section>
      <h2 class='tm-subhead tm-box-head'>History</h2>
      <div class='tm-box'>
        <SettingRow label='Your history'>
          <A class='btn btn-secondary' href='/history'>
            View history
          </A>
        </SettingRow>
        <SettingRow
          label='Public profile'
          info={<SettingInfo text='Enables a public profile page to share your performance at events.' />}
        >
          <span class='tm-set-inline' aria-busy={busy()}>
            <Toggle
              label='Public profile'
              value={props.user.publicProfile}
              onChange={on => void change('publicProfile', () => setPublicProfile(on))}
            />
          </span>
        </SettingRow>
        <Show when={props.user.publicProfile}>
          <SettingRow label='Name shown' info={<SettingInfo text='Affects only what is shown on your profile page.' />}>
            <span class='tm-set-inline' aria-busy={busy()}>
              <Toggle
                label='Name shown'
                value={props.user.profileName === 'real'}
                on='Real name'
                off='Username'
                onChange={real => void change('profileName', () => setProfileName(real ? 'real' : 'handle'))}
              />
            </span>
          </SettingRow>
          <SettingRow label='Profile link'>
            <span class='tm-set-inline tm-profile-link'>
              <A class='tm-link-inline' href={`/u/${props.user.handle}`}>
                {profileUrl(props.user.handle).replace(/^https?:\/\//, '')}
              </A>
              <button type='button' class='btn btn-secondary' onClick={() => void copy()}>
                {copied() ? 'Copied' : 'Copy'}
              </button>
            </span>
          </SettingRow>
        </Show>
      </div>
      <ErrorLine message={error()} />
    </section>
  );
}

/**
 * Organizer: a store Application pending or not approved (see
 * ApplicantStatus), then every way the account runs events (OrganizerRoles).
 * An account that runs none and has applied for nothing sees only the way to
 * apply.
 */
function OrganizerSection(props: { user: Me }) {
  const [state, { refetch }] = createResource(fetchApplication);
  const current = () => latestValue(state);
  const runs = () => props.user.role !== null || props.user.stores.length > 0;
  /** Only an Application still open or turned down is told apart from the rows below; anything else reads as none. */
  const stage = () => {
    const read = applicantStage(props.user.role, current()?.application ?? null);
    return read === 'pending' || read === 'rejected' ? read : 'none';
  };
  const status = () => stage() !== 'none' || !runs();
  return (
    <section>
      <h2 class='tm-subhead tm-box-head'>Organizer</h2>
      <Show
        when={current() !== undefined}
        fallback={
          <Show when={state.error} fallback={<Skeleton height='58px' />}>
            <ErrorLine message={errorText(state.error)} />
            <button type='button' class='btn btn-secondary tm-small' onClick={() => void refetch()}>
              Retry
            </button>
          </Show>
        }
      >
        <div class='tm-organizer'>
          <Show when={status()}>
            <ApplicantStatus
              stage={stage()}
              application={current()?.application ?? null}
              onChanged={() => void refetch()}
            />
          </Show>
          <Show when={runs()}>
            <OrganizerRoles user={props.user} applying={stage() !== 'none'} />
          </Show>
        </div>
      </Show>
    </section>
  );
}

/** Signed out: one box, a line on who signs in, and the providers. */
function SignedOut(props: { offer: SignInOffer }) {
  return (
    <>
      <h1 class='tm-settings-title'>Settings</h1>
      <section class='tm-box'>
        <div class='tm-box-bar'>
          <strong>Sign in</strong>
          <span class='tm-grow' />
          <span class='tm-flag'>Signed out</span>
        </div>
        <div class='tm-box-bar'>
          <SignIn offer={props.offer} next='/settings' />
        </div>
      </section>
    </>
  );
}

export function SettingsPage() {
  const [params] = useSearchParams<{ signin?: string; link?: string }>();
  const current = () => latestValue(session);
  onMount(() => {
    document.title = 'Settings — Ciphermaniac';
  });
  return (
    <div class='tm-page tm-settings'>
      <Show when={params.signin === 'failed'}>
        <p class='tm-error' role='alert'>
          Sign-in didn’t go through. Try again.
        </p>
      </Show>
      <Show when={params.link === 'used'}>
        <p class='tm-error' role='alert'>
          That account is already linked to another user.
        </p>
      </Show>
      <Show when={current()}>
        {s => (
          <Show when={s().user} fallback={<SignedOut offer={s()} />}>
            {user => (
              <>
                <Identity user={user()} providers={s().providers} />
                <Username user={user()} />
                <Profile user={user()} />
                <HistorySection user={user()} />
                <OrganizerSection user={user()} />
                <MyData
                  user={user()}
                  onWiped={wiped => mergeUser(wiped, 'handle', 'popId', 'firstName', 'lastName', 'birthDate')}
                />
              </>
            )}
          </Show>
        )}
      </Show>
    </div>
  );
}
