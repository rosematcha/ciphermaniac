/**
 * /history: the events run here that the signed-in account played, through
 * its POP ID at sanctioned events or its Claims at unsanctioned ones, newest
 * first (see HistoryList). Signed out, one box to sign in.
 */

import { createResource, onMount, Show } from 'solid-js';
import { Skeleton } from '../../components/Skeleton';
import { errorText, fetchHistory, type Provider } from '../../lib/tournament/api';
import { latestValue, resolved } from '../../lib/resource';
import { ErrorLine } from './Field';
import { TournamentHero } from './Hero';
import { HistoryList } from './HistoryList';
import { session } from './session';
import { SignIn } from './SignIn';

const eventCount = (n: number) => `${n} event${n === 1 ? '' : 's'}`;

function SignedOut(props: { providers: readonly Provider[] }) {
  return (
    <>
      <TournamentHero title='History' />
      <section class='tm-box'>
        <div class='tm-box-bar'>
          <strong>Sign in</strong>
          <span class='tm-grow' />
          <span class='tm-flag'>Signed out</span>
        </div>
        <div class='tm-box-bar'>
          <SignIn providers={props.providers} next='/history' />
        </div>
      </section>
    </>
  );
}

function MyHistory() {
  const [history, { refetch }] = createResource(() => fetchHistory().then(answer => answer.entries));
  const entries = () => resolved(history);
  return (
    <>
      <TournamentHero
        title='History'
        status={<Show when={entries()}>{list => <span class='muted'>{eventCount(list().length)}</span>}</Show>}
      />
      <Show
        when={entries()}
        fallback={
          <Show when={history.error} fallback={<Skeleton height='160px' />}>
            <ErrorLine message={errorText(history.error)} />
            <button type='button' class='btn btn-secondary tm-small' onClick={() => void refetch()}>
              Retry
            </button>
          </Show>
        }
      >
        {list => (
          <Show when={list().length > 0} fallback={<p class='muted tm-empty'>No events yet</p>}>
            <HistoryList entries={list()} />
          </Show>
        )}
      </Show>
    </>
  );
}

export function HistoryPage() {
  const current = () => latestValue(session);
  onMount(() => {
    document.title = 'History — Ciphermaniac';
  });
  return (
    <div class='tm-page'>
      <Show when={current()}>
        {s => (
          <Show when={s().user} fallback={<SignedOut providers={s().providers} />}>
            <MyHistory />
          </Show>
        )}
      </Show>
    </div>
  );
}
