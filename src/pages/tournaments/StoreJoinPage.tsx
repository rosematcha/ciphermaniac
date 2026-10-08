/**
 * /stores/join?invite=: a store's invite link. Signed in, it joins the store
 * at once and goes on to the store's page; a link used, withdrawn or run out
 * says so. Signed out, sign-in comes back here.
 */

import { useNavigate, useSearchParams } from '@solidjs/router';
import { createEffect, createSignal, Show, untrack } from 'solid-js';
import { errorText } from '../../lib/tournament/api';
import { joinStore } from '../../lib/tournament/stores';
import { latestValue } from '../../lib/resource';
import { ErrorLine } from './Field';
import { TournamentHero } from './Hero';
import { refreshSession, session } from './session';
import { SignIn } from './SignIn';

const TITLE = 'Join a store';

export function StoreJoinPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams<{ invite?: string }>();
  const [error, setError] = createSignal<string | null>(null);
  const user = () => latestValue(session)?.user;
  let tried = false;
  createEffect(() => {
    const token = params.invite;
    if (!user() || tried) {
      return;
    }
    tried = true;
    if (!token) {
      setError('This invite link was used or has run out');
      return;
    }
    untrack(() => void join(token));
  });
  async function join(token: string) {
    try {
      const { storeId } = await joinStore(token);
      await refreshSession();
      navigate(`/stores/${storeId}`, { replace: true });
    } catch (err) {
      setError(errorText(err));
    }
  }
  return (
    <div class='tm-page tm-narrow'>
      <TournamentHero title={TITLE} />
      <Show when={latestValue(session)}>
        {s => (
          <Show
            when={s().user}
            fallback={
              <section class='tm-box'>
                <div class='tm-box-bar'>
                  <SignIn
                    offer={s()}
                    next={`/stores/join?${new URLSearchParams({ invite: params.invite ?? '' }).toString()}`}
                  />
                </div>
              </section>
            }
          >
            <Show
              when={error()}
              fallback={
                <p class='muted' role='status'>
                  Joining
                </p>
              }
            >
              <ErrorLine message={error()} />
            </Show>
          </Show>
        )}
      </Show>
    </div>
  );
}
