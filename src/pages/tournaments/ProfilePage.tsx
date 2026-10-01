/**
 * /u/:slug: an account's public profile, for anyone with the link: its name
 * and picture, then its History as the account sees it (see HistoryList),
 * read-only. A profile turned off and an address that never was one look
 * the same: not found.
 */

import { createEffect, createResource, Show } from 'solid-js';
import { Skeleton } from '../../components/Skeleton';
import { ApiError, errorText, fetchProfile } from '../../lib/tournament/api';
import { resolved } from '../../lib/resource';
import { Avatar } from './Avatar';
import { ErrorLine } from './Field';
import { TournamentHero } from './Hero';
import { HistoryList } from './HistoryList';

const eventCount = (n: number) => `${n} event${n === 1 ? '' : 's'}`;

const missing = (error: unknown) => error instanceof ApiError && error.status === 404;

export function ProfilePage(props: { slug: string }) {
  const [profile, { refetch }] = createResource(() => props.slug, fetchProfile);
  const shown = () => resolved(profile);
  createEffect(() => {
    const name = shown()?.name;
    if (name) {
      document.title = `${name} — Ciphermaniac`;
    }
  });
  return (
    <div class='tm-page'>
      <Show when={!missing(profile.error)} fallback={<TournamentHero title='Profile not found' />}>
        <Show
          when={shown()}
          fallback={
            <Show when={profile.error} fallback={<Skeleton width='280px' height='28px' />}>
              <ErrorLine message={errorText(profile.error)} />
              <button type='button' class='btn btn-secondary tm-small' onClick={() => void refetch()}>
                Retry
              </button>
            </Show>
          }
        >
          {p => (
            <>
              <section class='tm-hero tm-profile-hero'>
                <Avatar name={p().name} src={p().avatar} />
                <div class='tm-hero-text'>
                  <h1>{p().name}</h1>
                  <p class='tm-status muted'>{eventCount(p().entries.length)}</p>
                </div>
              </section>
              <Show when={p().entries.length > 0} fallback={<p class='muted tm-empty'>No events yet</p>}>
                <HistoryList entries={p().entries} />
              </Show>
            </>
          )}
        </Show>
      </Show>
    </div>
  );
}
