import { createSignal, createUniqueId, For, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { PASSWORD_MIN } from '../../../shared/accounts/clerk';
import { type OAuthProvider, type Provider, type SignInOffer, signInUrl } from '../../lib/tournament/api';
import type { ClerkMode } from '../../lib/tournament/clerk';

/*
 * The providers' own marks, unaltered: Google's standard-colour G (its
 * guidelines forbid recolouring or resizing it) and Discord's symbol in white
 * on Blurple.
 */
const GoogleG = () => (
  <svg viewBox='0 0 48 48' aria-hidden='true'>
    <path
      fill='#EA4335'
      d='M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z'
    />
    <path
      fill='#4285F4'
      d='M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z'
    />
    <path
      fill='#FBBC05'
      d='M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z'
    />
    <path
      fill='#34A853'
      d='M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z'
    />
  </svg>
);

const DiscordMark = () => (
  <svg viewBox='0 0 127.14 96.36' aria-hidden='true'>
    <path
      fill='#ffffff'
      d='M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z'
    />
  </svg>
);

const PROVIDERS: Record<OAuthProvider, { label: string; Mark: () => JSX.Element }> = {
  google: { label: 'Sign in with Google', Mark: GoogleG },
  discord: { label: 'Sign in with Discord', Mark: DiscordMark }
};

/** Google first, so it is at least as prominent as any other provider (its branding rules). */
const ORDER: OAuthProvider[] = ['google', 'discord'];

/** A name-only sign-in, offered by a local server with DEV_LOGIN on, for testing. */
function DevSignIn(props: { next: string }) {
  const [devName, setDevName] = createSignal('');
  return (
    <form
      class='tm-inline-form'
      onSubmit={event => {
        event.preventDefault();
        window.location.href = signInUrl('dev', props.next, devName());
      }}
    >
      <input
        class='tm-input'
        placeholder='Test user name'
        aria-label='Test user name'
        value={devName()}
        onInput={event => setDevName(event.currentTarget.value)}
      />
      <button type='submit' class='btn btn-ghost'>
        Dev sign-in
      </button>
    </form>
  );
}

const oauthOf = (providers: readonly Provider[]) => ORDER.filter(p => providers.includes(p));

/**
 * Sign-in buttons for whichever providers the server has configured, drawn to
 * each provider's branding guidelines and the same size. `stacked` puts them
 * one over the other at full width. `dev` adds the local test sign-in.
 */
function ProviderButtons(props: { providers: readonly Provider[]; next: string; stacked?: boolean; dev: boolean }) {
  return (
    <div class='tm-signin' classList={{ 'is-stacked': props.stacked }}>
      <For each={oauthOf(props.providers)}>
        {provider => (
          <a class={`tm-sso tm-sso-${provider}`} href={signInUrl(provider, props.next)} rel='external'>
            {PROVIDERS[provider].Mark()}
            <span>{PROVIDERS[provider].label}</span>
          </a>
        )}
      </For>
      <Show when={props.dev}>
        <DevSignIn next={props.next} />
      </Show>
      <Show when={props.providers.length === 0}>
        <p class='muted'>Sign-in is not set up on this server.</p>
      </Show>
    </div>
  );
}

/** The Clerk client, loaded on first use so the pages that only show this form don't carry it. */
const clerkClient = () => import('../../lib/tournament/clerk');

/**
 * A username and password, checked by Clerk (lib/tournament/clerk.ts). The
 * same form signs in or makes an account. Clerk starts loading when the form
 * first takes focus. Its bot check draws into #clerk-captcha, which only the
 * form making an account at that moment holds, so a page with two forms has
 * one.
 */
function UsernameForm(props: { publishableKey: string; next: string }) {
  const [mode, setMode] = createSignal<ClerkMode>('in');
  const [username, setUsername] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [problem, setProblem] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const hintId = createUniqueId();
  const making = () => mode() === 'up';
  let warmed = false;
  function warm() {
    if (!warmed) {
      warmed = true;
      const key = props.publishableKey;
      clerkClient()
        .then(clerk => clerk.prepareClerk(key))
        .catch(() => (warmed = false));
    }
  }
  async function submit(event: SubmitEvent) {
    event.preventDefault();
    const credentials = { mode: mode(), username: username().trim(), password: password() };
    setBusy(true);
    setProblem(null);
    const clerk = await clerkClient().catch(() => null);
    try {
      if (!clerk) {
        throw new Error('The sign-in client did not load');
      }
      // Busy until the browser leaves for the answer.
      clerk.postClerkToken(await clerk.clerkToken(props.publishableKey, credentials), props.next);
    } catch (error) {
      setProblem(clerk?.clerkProblem(error) ?? 'Sign-in failed. Try again.');
      setBusy(false);
    }
  }
  // Back from the page sign-in led to, the browser may restore this one as it was left: busy.
  const restored = (event: PageTransitionEvent) => {
    if (event.persisted) {
      setBusy(false);
      setPassword('');
    }
  };
  onMount(() => window.addEventListener('pageshow', restored));
  onCleanup(() => window.removeEventListener('pageshow', restored));
  function swap() {
    setMode(making() ? 'in' : 'up');
    setProblem(null);
  }
  return (
    <form class='tm-signin-form' onFocusIn={warm} onSubmit={event => void submit(event)}>
      <label class='tm-field'>
        <span class='tm-label'>Username</span>
        <input
          class='tm-input'
          name='username'
          autocomplete='username'
          autocapitalize='none'
          spellcheck={false}
          required
          aria-invalid={problem() ? 'true' : undefined}
          value={username()}
          onInput={event => setUsername(event.currentTarget.value)}
        />
      </label>
      <label class='tm-field'>
        <span class='tm-label'>Password</span>
        <input
          class='tm-input'
          type='password'
          name='password'
          autocomplete={making() ? 'new-password' : 'current-password'}
          minLength={making() ? PASSWORD_MIN : undefined}
          required
          aria-invalid={problem() ? 'true' : undefined}
          aria-describedby={making() ? hintId : undefined}
          value={password()}
          onInput={event => setPassword(event.currentTarget.value)}
        />
        <Show when={making()}>
          <span class='tm-signin-hint' id={hintId}>
            At least {PASSWORD_MIN} characters
          </span>
        </Show>
      </label>
      <Show when={problem()}>
        {text => (
          <p class='tm-error' role='alert'>
            {text()}
          </p>
        )}
      </Show>
      <Show when={making() && busy()}>
        <div id='clerk-captcha' />
      </Show>
      <div class='tm-signin-acts'>
        <button type='submit' class='btn btn-primary tm-signin-submit' disabled={busy()}>
          {making() ? 'Create account' : 'Sign in'}
        </button>
        <button type='button' class='tm-signin-swap' disabled={busy()} onClick={swap}>
          {making() ? 'I have an account' : 'Create an account'}
        </button>
      </div>
    </form>
  );
}

/**
 * Every way in the server offers. With username and password sign-in, the
 * provider buttons sit on one side and the form on the other, an "or" between
 * them; they stack when the space they're given is narrow. The local test
 * sign-in then gets a row of its own beneath.
 */
export function SignIn(props: { offer: SignInOffer; next: string; stacked?: boolean }) {
  const providers = () => props.offer.providers;
  const clerkKey = () => (providers().includes('clerk') ? (props.offer.clerkKey ?? null) : null);
  const dev = () => providers().includes('dev');
  const buttons = () => oauthOf(providers()).length > 0;
  return (
    <Show
      when={clerkKey()}
      fallback={<ProviderButtons providers={providers()} next={props.next} stacked={props.stacked} dev={dev()} />}
    >
      {key => (
        <div class='tm-signin-split'>
          <div class='tm-signin-cols' classList={{ 'is-alone': !buttons() }}>
            <Show when={buttons()}>
              <ProviderButtons providers={providers()} next={props.next} stacked dev={false} />
              <div class='tm-signin-or' aria-hidden='true'>
                <span>or</span>
              </div>
            </Show>
            <UsernameForm publishableKey={key()} next={props.next} />
          </div>
          <Show when={dev()}>
            <div class='tm-signin-dev'>
              <DevSignIn next={props.next} />
            </div>
          </Show>
        </div>
      )}
    </Show>
  );
}
