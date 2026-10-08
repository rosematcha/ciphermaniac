import { Show } from 'solid-js';
import { latestValue } from '../../lib/resource';
import { AccountMenu } from './AccountMenu';
import { session } from './session';

/**
 * Who is signed in, at the top right of every tournament page: the account
 * button the dashboard and the console carry, its menu holding History and
 * Settings. It takes no height, so it sits level with the page's title.
 */
export function AccountStrip() {
  const user = () => latestValue(session)?.user;
  return (
    <Show when={user()}>
      {me => (
        <div class='tm-account-strip'>
          <AccountMenu user={me()} pending={0} />
        </div>
      )}
    </Show>
  );
}
