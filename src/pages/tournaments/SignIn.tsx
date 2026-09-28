import { createSignal, For, Show } from 'solid-js';
import { type Provider, signInUrl } from '../../lib/tournament/api';

const PROVIDER_LABELS: Record<Exclude<Provider, 'dev'>, string> = {
  google: 'Continue with Google',
  discord: 'Continue with Discord'
};

/**
 * Sign-in buttons for whichever providers the server has configured. A local
 * server with DEV_LOGIN on also offers a name-only sign-in for testing.
 */
export function SignIn(props: { providers: readonly Provider[]; next: string }) {
  const [devName, setDevName] = createSignal('');
  const oauth = () => props.providers.filter((p): p is Exclude<Provider, 'dev'> => p !== 'dev');
  return (
    <div class='tm-signin'>
      <For each={oauth()}>
        {provider => (
          <a class='btn btn-secondary' href={signInUrl(provider, props.next)}>
            {PROVIDER_LABELS[provider]}
          </a>
        )}
      </For>
      <Show when={props.providers.includes('dev')}>
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
      </Show>
      <Show when={props.providers.length === 0}>
        <p class='muted'>Sign-in is not set up on this server.</p>
      </Show>
    </div>
  );
}
