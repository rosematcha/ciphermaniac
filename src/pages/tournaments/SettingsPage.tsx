/**
 * /settings (and the older /account). Signed in: who you are (a small
 * picture or initial, your name, your events, sign out, and which sign-ins
 * are linked), your account name, the player profile that decklists and
 * "find my table" fill themselves in from, History: the way to it, and
 * whether it is public at /u/<address>, and Organizer: where the account
 * stands on running events, with the way to apply, its events or the admin
 * page. A POP ID another account holds is refused, with the way to the
 * feedback form, where an admin settles who holds it. Signed out: one box to
 * sign in.
 */

import { A, useNavigate, useSearchParams } from '@solidjs/router';
import { createEffect, createResource, createSignal, For, onMount, Show } from 'solid-js';
import { canApply, canCreateEvents } from '../../../shared/accounts/roles';
import type { PlayerProfile } from '../../../shared/tournament/profile';
import {
  ApiError,
  errorText,
  linkUrl,
  type Me,
  type Provider,
  saveAccountName,
  saveProfile,
  setPublicProfile,
  signOut
} from '../../lib/tournament/api';
import { applicantStage, fetchApplication } from '../../lib/tournament/applications';
import { latestValue } from '../../lib/resource';
import { Skeleton } from '../../components/Skeleton';
import { ApplicantStatus } from './ApplicantStatus';
import { Avatar } from './Avatar';
import { ErrorLine } from './Field';
import { emptyProfile, ProfileFields, profileProblems } from './ProfileFields';
import { refreshSession, session, setSession } from './session';
import { SettingRow, Toggle } from './SettingControls';
import { SignIn } from './SignIn';

const PROVIDER_NAMES: Record<Exclude<Provider, 'dev'>, string> = { google: 'Google', discord: 'Discord' };

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
        {/* An Organizer's or Admin's events are under Organizer, below. */}
        <Show when={!canCreateEvents(props.user.role)}>
          <A class='btn btn-secondary' href='/host'>
            Your events
          </A>
        </Show>
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

function AccountName(props: { user: Me }) {
  // eslint-disable-next-line solid/reactivity -- the input edits a copy of the name it opened with
  const [name, setName] = createSignal(props.user.name);
  const [error, setError] = createSignal<string | null>(null);
  const [saved, setSaved] = createSignal(false);
  async function save(event: Event) {
    event.preventDefault();
    try {
      const result = await saveAccountName(name());
      setSession(prev => (prev ? { ...prev, user: result.user } : prev));
      setError(null);
      setSaved(true);
    } catch (err) {
      setError(errorText(err));
    }
  }
  return (
    <section>
      <h2 class='tm-subhead tm-box-head'>Account name</h2>
      <form class='tm-box' onSubmit={event => void save(event)}>
        <div class='tm-box-bar'>
          <input
            class='tm-input tm-grow'
            maxlength='40'
            aria-label='Account name'
            value={name()}
            onInput={event => {
              setName(event.currentTarget.value);
              setSaved(false);
            }}
          />
          <Show when={saved()}>
            <span class='muted' role='status'>
              Saved
            </span>
          </Show>
          <button class='btn btn-secondary' type='submit' disabled={name().trim() === props.user.name}>
            Save name
          </button>
        </div>
      </form>
      <ErrorLine message={error()} />
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
      setSession(prev => (prev ? { ...prev, user } : prev));
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
const profileUrl = (slug: string) => `${location.origin}/u/${slug}`;

/**
 * History: the way to it, and the public profile, off unless the account
 * turns it on; on, its link and a way to copy it. Turned off and on again,
 * the profile gets a new address, so an old shared link stays dead.
 */
function HistorySection(props: { user: Me }) {
  const [busy, setBusy] = createSignal(false);
  const [copied, setCopied] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  async function turn(on: boolean) {
    setBusy(true);
    setError(null);
    try {
      const { user } = await setPublicProfile(on);
      setSession(prev => (prev ? { ...prev, user } : prev));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  async function copy(slug: string) {
    await navigator.clipboard.writeText(profileUrl(slug));
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
        <SettingRow label='Public profile'>
          <span class='tm-set-inline' aria-busy={busy()}>
            <Toggle
              label='Public profile'
              value={props.user.publicSlug !== null}
              onChange={on => {
                if (!busy()) {
                  void turn(on);
                }
              }}
            />
          </span>
        </SettingRow>
        <Show when={props.user.publicSlug}>
          {slug => (
            <SettingRow label='Profile link'>
              <span class='tm-set-inline tm-profile-link'>
                <A class='tm-link-inline tm-num' href={`/u/${slug()}`}>
                  {profileUrl(slug()).replace(/^https?:\/\//, '')}
                </A>
                <button type='button' class='btn btn-secondary' onClick={() => void copy(slug())}>
                  {copied() ? 'Copied' : 'Copy'}
                </button>
              </span>
            </SettingRow>
          )}
        </Show>
      </div>
      <ErrorLine message={error()} />
    </section>
  );
}

/**
 * Organizer: where the account stands on running events (see
 * ApplicantStatus). Its Application is only asked for while it may apply;
 * an Organizer's or Admin's stage is its role.
 */
function OrganizerSection(props: { user: Me }) {
  // Keyed by what the role leaves to ask; a false key would never resolve.
  const [state, { refetch }] = createResource(
    () => (canApply(props.user.role) ? 'application' : 'role'),
    asked => (asked === 'application' ? fetchApplication() : null)
  );
  const current = () => latestValue(state);
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
        <ApplicantStatus
          stage={applicantStage(props.user.role, current()?.application ?? null)}
          application={current()?.application ?? null}
          onChanged={() => void refetch()}
        />
      </Show>
    </section>
  );
}

/** Signed out: one box, a line on who signs in, and the providers. */
function SignedOut(props: { providers: readonly Provider[] }) {
  return (
    <>
      <h1 class='tm-settings-title'>Settings</h1>
      <section class='tm-box'>
        <div class='tm-box-bar'>
          <strong>Sign in</strong>
          <span class='tm-grow' />
          <span class='tm-flag'>Signed out</span>
        </div>
        <p class='tm-box-bar muted'>Sign in to run or staff an event. Players don’t need an account.</p>
        <div class='tm-box-bar'>
          <SignIn providers={props.providers} next='/settings' />
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
    <div class='tm-page tm-narrow tm-settings'>
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
          <Show when={s().user} fallback={<SignedOut providers={s().providers} />}>
            {user => (
              <>
                <Identity user={user()} providers={s().providers} />
                <AccountName user={user()} />
                <Profile user={user()} />
                <HistorySection user={user()} />
                <OrganizerSection user={user()} />
              </>
            )}
          </Show>
        )}
      </Show>
    </div>
  );
}
