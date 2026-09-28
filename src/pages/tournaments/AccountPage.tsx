/**
 * /account: sign in, sign out, and the player profile decklists and "find my
 * pairing" use.
 */

import { useSearchParams } from '@solidjs/router';
import { createEffect, createSignal, onMount, Show } from 'solid-js';
import type { PlayerProfile } from '../../../shared/tournament/profile';
import { saveProfile, signOut } from '../../lib/tournament/api';
import { refreshSession, session, setSession } from './session';
import { latestValue } from '../../lib/resource';
import { ErrorLine } from './Field';
import { emptyProfile, ProfileFields, profileProblems } from './ProfileFields';
import { SignIn } from './SignIn';

export function AccountPage() {
  const [params] = useSearchParams<{ signin?: string }>();
  const current = () => latestValue(session);
  const [profile, setProfile] = createSignal<PlayerProfile>(emptyProfile());
  const [touched, setTouched] = createSignal(false);
  const [status, setStatus] = createSignal<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = createSignal<string | null>(null);
  onMount(() => {
    document.title = 'Account — Ciphermaniac';
  });
  createEffect(() => {
    const user = current()?.user;
    if (user && !touched()) {
      setProfile(emptyProfile(user));
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

  async function leave() {
    await signOut().catch(() => undefined);
    await refreshSession();
  }

  return (
    <div class='tm-narrow'>
      <section class='hero'>
        <h1>Account</h1>
      </section>
      <Show when={params.signin === 'failed'}>
        <p class='tm-error' role='alert'>
          Sign-in didn’t go through. Try again.
        </p>
      </Show>
      <Show
        when={current()?.user}
        fallback={<Show when={current()}>{s => <SignIn providers={s().providers} next='/account' />}</Show>}
      >
        {user => (
          <>
            <div class='tm-account-head'>
              <Show when={user().avatar}>
                {src => <img class='tm-avatar' src={src()} alt='' width='32' height='32' />}
              </Show>
              <span>{user().name}</span>
              <button type='button' class='btn btn-ghost' onClick={() => void leave()}>
                Sign out
              </button>
            </div>
            <form class='tm-form' onSubmit={event => void save(event)}>
              <h2>Player profile</h2>
              <ProfileFields idPrefix='account' value={profile()} errors={problems()} onChange={setProfile} />
              <div class='tm-actions'>
                <button type='submit' class='btn btn-primary' disabled={status() === 'saving'}>
                  Save
                </button>
                <Show when={status() === 'saved'}>
                  <span class='muted'>Saved</span>
                </Show>
              </div>
              <ErrorLine message={error()} />
            </form>
          </>
        )}
      </Show>
    </div>
  );
}
