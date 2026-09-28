/**
 * /settings (and the older /account): who is signed in, signing out, and the
 * player profile that decklists and "find my pairing" read.
 */

import { A, useNavigate, useSearchParams } from '@solidjs/router';
import { createEffect, createSignal, For, onMount, Show } from 'solid-js';
import type { PlayerProfile } from '../../../shared/tournament/profile';
import { linkUrl, type Me, saveAccountName, saveProfile, signOut } from '../../lib/tournament/api';
import { latestValue } from '../../lib/resource';
import { ErrorLine } from './Field';
import { emptyProfile, ProfileFields, profileProblems } from './ProfileFields';
import { refreshSession, session, setSession } from './session';
import { SignIn } from './SignIn';

function Account(props: { user: Me; providers: ('google' | 'discord' | 'dev')[] }) {
  const navigate = useNavigate();
  // eslint-disable-next-line solid/reactivity -- the input edits a copy of the name it opened with
  const [name, setName] = createSignal(props.user.name);
  const [error, setError] = createSignal<string | null>(null);
  async function saveName(event: Event) {
    event.preventDefault();
    try {
      const result = await saveAccountName(name());
      setSession(prev => (prev ? { ...prev, user: result.user } : prev));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }
  async function leave() {
    await signOut().catch(() => undefined);
    await refreshSession();
    navigate('/');
  }
  return (
    <section class='tm-section-block'>
      <h2 class='tm-subhead'>Account</h2>
      <div class='tm-account-row'>
        <Show when={props.user.avatar}>
          {src => <img class='tm-avatar' src={src()} alt='' width='36' height='36' />}
        </Show>
        <span class='tm-account-name'>{props.user.name}</span>
        <A class='btn btn-ghost' href='/host'>
          Your events
        </A>
        <button type='button' class='btn btn-secondary' onClick={() => void leave()}>
          Sign out
        </button>
      </div>
      <form class='tm-actions' onSubmit={event => void saveName(event)}>
        <label class='tm-label' for='account-name'>
          Account name
        </label>
        <input
          id='account-name'
          class='tm-input tm-account-name-input'
          maxlength='40'
          value={name()}
          onInput={event => setName(event.currentTarget.value)}
        />
        <button class='btn btn-secondary' type='submit'>
          Save name
        </button>
      </form>
      <ErrorLine message={error()} />
      <div class='tm-actions'>
        <For each={(['google', 'discord'] as const).filter(provider => props.providers.includes(provider))}>
          {provider =>
            props.user.providers?.includes(provider) ? (
              <span class='muted'>{provider === 'google' ? 'Google' : 'Discord'} linked</span>
            ) : (
              <A class='btn btn-ghost' href={linkUrl(provider)}>
                Link {provider === 'google' ? 'Google' : 'Discord'}
              </A>
            )
          }
        </For>
      </div>
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
    <form class='tm-section-block' onSubmit={event => void save(event)}>
      <h2 class='tm-subhead'>Player profile</h2>
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
      <div class='tm-actions'>
        <button type='submit' class='btn btn-primary' disabled={status() === 'saving'}>
          Save profile
        </button>
        <Show when={status() === 'saved'}>
          <span class='muted' role='status'>
            Saved
          </span>
        </Show>
      </div>
      <ErrorLine message={error()} />
    </form>
  );
}

export function SettingsPage() {
  const [params] = useSearchParams<{ signin?: string; link?: string }>();
  const current = () => latestValue(session);
  onMount(() => {
    document.title = 'Settings — Ciphermaniac';
  });
  return (
    <div class='tm-page tm-narrow'>
      <section class='hero'>
        <h1>Settings</h1>
      </section>
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
      <Show
        when={current()?.user}
        fallback={<Show when={current()}>{s => <SignIn providers={s().providers} next='/settings' />}</Show>}
      >
        {user => (
          <>
            <Account user={user()} providers={current()?.providers ?? []} />
            <Profile user={user()} />
          </>
        )}
      </Show>
    </div>
  );
}
