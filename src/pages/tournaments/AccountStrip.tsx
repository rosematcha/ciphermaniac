import { A } from '@solidjs/router';
import { Show } from 'solid-js';
import { latestValue } from '../../lib/resource';
import { session } from './session';

/** Who is signed in, and the way to Settings, at the top of every tournament page. */
export function AccountStrip() {
  const user = () => latestValue(session)?.user;
  return (
    <Show when={user()}>
      {me => (
        <p class='tm-account-strip'>
          <span class='muted'>Signed in as</span> <span>{me().name}</span>
          <span class='dot' aria-hidden='true'>
            ·
          </span>
          <A href='/settings'>Settings</A>
        </p>
      )}
    </Show>
  );
}
