/**
 * /settings (and the older /account). Signed in: who you are (a small
 * picture or initial, your name, your events, sign out, and which sign-ins
 * are linked), your account name, and the player profile that decklists and
 * "find my table" fill themselves in from. Signed out: one box to sign in,
 * which only organizers and staff need.
 */

import { A, useNavigate, useSearchParams } from '@solidjs/router';
import { createEffect, createSignal, For, onMount, Show } from 'solid-js';
import type { PlayerProfile } from '../../../shared/tournament/profile';
import { linkUrl, type Me, type Provider, saveAccountName, saveProfile, signOut } from '../../lib/tournament/api';
import { latestValue } from '../../lib/resource';
import { ErrorLine } from './Field';
import { emptyProfile, ProfileFields, profileProblems } from './ProfileFields';
import { refreshSession, session, setSession } from './session';
import { SignIn } from './SignIn';

const PROVIDER_NAMES: Record<Exclude<Provider, 'dev'>, string> = { google: 'Google', discord: 'Discord' };

/** A small picture, or the name's initial where the provider gave none. */
function Avatar(props: { user: Me }) {
  return (
    <Show when={props.user.avatar} fallback={<span class='tm-avatar tm-initial'>{props.user.name.slice(0, 1)}</span>}>
      {src => <img class='tm-avatar' src={src()} alt='' width='40' height='40' />}
    </Show>
  );
}

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
      <Avatar user={props.user} />
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
                <A class='tm-link-inline' href={linkUrl(provider)}>
                  Link {PROVIDER_NAMES[provider]}
                </A>
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
      setError(err instanceof Error ? err.message : String(err));
    }
  }
  return (
    <section>
      <h2 class='tm-th tm-box-head'>Account name</h2>
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
    try {
      const { user } = await saveProfile(profile());
      setSession(prev => (prev ? { ...prev, user } : prev));
      setStatus('saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('idle');
    }
  }

  return (
    <section>
      <h2 class='tm-th tm-box-head'>Player profile</h2>
      <form class='tm-box' onSubmit={event => void save(event)}>
        <p class='tm-box-bar muted'>Filled in automatically when you submit a decklist or look for your table.</p>
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
      <ErrorLine message={error()} />
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
              </>
            )}
          </Show>
        )}
      </Show>
    </div>
  );
}
