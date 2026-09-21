import { A, useParams } from '@solidjs/router';
import { createEffect, createMemo, createResource, Show } from 'solid-js';
import { aliasedPlayerId } from '../../../shared/live/seatAliases';
import type { LiveRound, LiveSeat } from '../../../shared/live/types';
import { createProfileLookup, recordLabel, seatMatchesSlug } from '../../../shared/live/view';
import { EmptyState } from '../../components/EmptyState';
import { Section } from '../../components/Section';
import { Skeleton } from '../../components/Skeleton';
import { fetchPlayerIndexSlim } from '../../lib/data';
import { createLiveIndex, createPolled, liveDelay } from '../../lib/livePoll';
import { fetchPostedRounds } from '../../lib/liveRounds';
import { latestValue, resolved } from '../../lib/resource';
import { useDeckReports } from './deckReports';
import { LiveRun } from './LiveRun';
import '../../styles/pages/players-tables.css';
import '../../styles/pages/players.css';
import '../../styles/pages/live.css';

/** The newest posted round the slug names a seat in. */
function latestSeat(rounds: readonly (LiveRound | null)[], slug: string): LiveSeat | null {
  for (const round of [...rounds].sort((a, b) => (b?.round ?? 0) - (a?.round ?? 0))) {
    for (const match of round?.matches ?? []) {
      const found = match.seats.find(seat => seatMatchesSlug(seat, slug));
      if (found) {
        return found;
      }
    }
  }
  return null;
}

/**
 * /live/:slug/player/:seat — one player's run at this event, for the players
 * the site holds no career for.
 *
 * The slug is folded and lower-cased, so it is never printed: the page titles
 * itself from the seat it resolves to, and says the event's name until one
 * does. A player who does have a career is redirected there by the links; only
 * a hand-typed URL lands here for them, and the page links them on.
 */
export function LiveSeatPage() {
  const params = useParams<{ slug: string; seat: string }>();

  const index = createLiveIndex(() => params.slug);
  const indexData = () => latestValue(index);
  // Every posted round, not just the one being played: someone who dropped
  // after round five has no seat in round six, and their page would otherwise
  // be empty for the rest of the event. The archive means this is one request
  // per poll, and `LiveRun` reads the same rounds back out of it.
  const rounds = createPolled(
    () => (indexData()?.round ? ([params.slug, indexData()!.round] as const) : null),
    ([slug, current]) => fetchPostedRounds(slug, current),
    () => liveDelay(indexData())
  );

  // The seat as the round file spells it, which is what follows and deck
  // reports key on; the URL only ever narrows the search.
  const seat = createMemo<LiveSeat | null>(() => latestSeat(latestValue(rounds) ?? [], params.seat));

  const [players] = createResource(
    () => (seat() ? 'players' : null),
    () => fetchPlayerIndexSlim()
  );
  const profileOf = createMemo(() => createProfileLookup(resolved(players) ?? [], aliasedPlayerId));
  const career = () => {
    const found = seat();
    return found ? profileOf()(found) : null;
  };

  const reports = useDeckReports(() => params.slug, indexData);
  const names = () => [seat()?.name ?? ''].filter(Boolean);
  const countries = () => [seat()?.country ?? ''].filter(Boolean);

  createEffect(() => {
    const event = indexData()?.name ?? 'Live';
    const who = seat()?.name;
    document.title = who ? `${who} — ${event} — Ciphermaniac` : `${event} — Ciphermaniac`;
  });

  return (
    <>
      <section class='hero'>
        <Show when={seat()} fallback={<h1>Player not in this event</h1>}>
          {found => <h1>{found().name}</h1>}
        </Show>
        <div class='hero-meta'>
          <A href={`/live/${params.slug}`}>{indexData()?.name ?? 'Live rounds'}</A>
          <Show when={seat()}>
            {found => (
              <>
                <span class='dot'>·</span>
                <span>{recordLabel(found())}</span>
                <Show when={found().dropped}>
                  <span class='dot'>·</span>
                  <span>dropped</span>
                </Show>
              </>
            )}
          </Show>
          <Show when={career()}>
            {profile => (
              <>
                <span class='dot'>·</span>
                <A href={`/players/${encodeURIComponent(profile().playerId)}`}>Career</A>
              </>
            )}
          </Show>
        </div>
      </section>

      <Section>
        <Show when={latestValue(rounds)} fallback={<Skeleton height='220px' />}>
          <Show
            when={seat() && indexData()}
            fallback={
              <EmptyState
                title='No seat under this name.'
                description='No round posted at this event has a player the link names. The rounds it covered may have been pruned, or the name may be spelled another way on the pairings.'
                actions={
                  <A href={`/live/${params.slug}`} class='btn btn-secondary'>
                    All tables
                  </A>
                }
              />
            }
          >
            <LiveRun
              slug={params.slug}
              names={names()}
              countries={countries()}
              rounds={indexData()!.round}
              version={indexData()!.hash}
              reports={reports}
              profileOf={found => profileOf()(found)}
            />
          </Show>
        </Show>
      </Section>
    </>
  );
}
