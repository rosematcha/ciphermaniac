import { A, useParams, useSearchParams } from '@solidjs/router';
import { createEffect, createMemo, createResource, createSignal, Show } from 'solid-js';
import { fetchPlayerDecks, fetchPlayerProfile } from '../lib/data';
import { EmptyState } from '../components/EmptyState';
import { Skeleton } from '../components/Skeleton';
import { Tabs } from '../components/Tabs';
import { resolved } from '../lib/resource';
import type { PlayerProfile } from '../types';
import type { EventDetailSource } from './playerProfile/EventDetail';
import { DecksTab } from './playerProfile/DecksTab';
import { HistoryTable } from './playerProfile/HistoryTable';
import { MatchupsTab } from './playerProfile/MatchupsTab';
import { type CareerRounds, careerSummary } from './playerProfile/model';
import '../styles/pages/players-tables.css';
import '../styles/pages/players.css';

type ProfileTab = 'history' | 'decks' | 'matchups';

const TAB_VALUES: readonly ProfileTab[] = ['history', 'decks', 'matchups'];
const TAB_OPTIONS: { value: ProfileTab; label: string }[] = [
  { value: 'history', label: 'History' },
  { value: 'decks', label: 'Decks' },
  { value: 'matchups', label: 'Matchups' }
];

/**
 * /players/:id — a player's career: the name and a line of career figures,
 * then History / Decks / Matchups. History and Decks are the same event rows
 * (chronological, or grouped under the deck they were played with), each
 * opening to that event's decklist and rounds; Matchups rolls the rounds up.
 */
export function PlayerProfilePage() {
  const params = useParams<{ id: string }>();
  const [profile] = createResource(() => params.id, fetchPlayerProfile);

  // Non-suspending read (see lib/resource.ts). Param-keyed: show the skeleton
  // on player change, not the previous player's profile.
  const profileData = () => resolved(profile);

  createEffect(() => {
    document.title = `${profileData()?.name ?? 'Player'} — Ciphermaniac`;
  });

  return (
    <Show
      when={profileData()}
      fallback={
        <Show when={profile.error || profileData() === null} fallback={<ProfileSkeleton />}>
          <EmptyState
            title='Player not found.'
            description="No career profile exists for this player ID. They may not have a Limitless Labs ID, or the index hasn't been rebuilt."
            actions={
              <A href='/players' class='btn btn-secondary'>
                Back to players
              </A>
            }
          />
        </Show>
      }
    >
      <ProfileBody profile={profileData()!} playerId={params.id} />
    </Show>
  );
}

function ProfileBody(props: { profile: PlayerProfile; playerId: string }) {
  const summary = createMemo(() => careerSummary(props.profile));
  const s = () => props.profile.summary;

  // The tab lives in the URL so a shared link lands on Matchups; History is
  // the default and stays out of the URL.
  const [searchParams, setSearchParams] = useSearchParams<{ tab?: string }>();
  const tab = (): ProfileTab =>
    (TAB_VALUES as readonly string[]).includes(searchParams.tab ?? '') ? (searchParams.tab as ProfileTab) : 'history';
  const setTab = (next: ProfileTab) =>
    setSearchParams({ tab: next === 'history' ? undefined : next }, { replace: true });

  // Rounds ride along in the profile, so Matchups and an opened event's Rounds
  // pane render with no fetch. Decklists are the one heavy per-player payload,
  // so they stay lazy — gated via a signal rather than created in a click
  // handler, which would leak.
  const [decksRequested, setDecksRequested] = createSignal(false);
  const [decks] = createResource(() => (decksRequested() ? props.playerId : null), fetchPlayerDecks);
  const source: EventDetailSource = {
    ensure: () => setDecksRequested(true),
    cards: tournamentId => resolved(decks)?.decks?.[tournamentId],
    rounds: tournamentId => careerRounds()[tournamentId],
    loading: () => decks.loading
  };

  const archetypeName = (base: string | null): string => (base ? (props.profile.archetypeNames[base] ?? base) : '');
  // A profile cached before the aggregator started emitting rounds has none.
  const careerRounds = (): CareerRounds => props.profile.rounds ?? {};

  return (
    <>
      <section class='hero'>
        <h1>{props.profile.name}</h1>
        <div class='hero-meta'>
          <Show when={props.profile.countries.length}>
            <span>{props.profile.countries.join(' · ')}</span>
            <span class='dot'>·</span>
          </Show>
          <span>
            {s().eventCount} {s().eventCount === 1 ? 'event' : 'events'}, {summary().span}
          </span>
          <span class='dot'>·</span>
          <A href={`/players/compare?a=${encodeURIComponent(props.playerId)}`}>Compare</A>
        </div>
        <dl class='player-stats'>
          <div class='player-stat'>
            <dd>{summary().record}</dd>
            <dt>record</dt>
          </div>
          <div class='player-stat is-lead'>
            <dd>{summary().winRate == null ? '—' : `${summary().winRate}%`}</dd>
            <dt>win rate</dt>
          </div>
          <div class='player-stat'>
            <dd>
              {s().day2s}
              <small>{summary().day2Rate}%</small>
            </dd>
            <dt>Day 2s</dt>
          </div>
          <div class='player-stat'>
            <dd>{s().topCuts}</dd>
            <dt>top cuts</dt>
          </div>
          <div class='player-stat'>
            <dd>{s().tournamentWins}</dd>
            <dt>{s().tournamentWins === 1 ? 'title' : 'titles'}</dt>
          </div>
          <div class='player-stat'>
            <dd>{summary().medianFinish}</dd>
            <dt>median finish</dt>
          </div>
        </dl>
      </section>

      <section class='player-tabs'>
        <Tabs<ProfileTab> options={TAB_OPTIONS} selected={tab()} onSelect={setTab} ariaLabel='Profile section' />
        <Show when={tab() === 'history'}>
          <HistoryTable entries={props.profile.tournaments} archetypeName={archetypeName} source={source} />
        </Show>
        <Show when={tab() === 'decks'}>
          <DecksTab profile={props.profile} archetypeName={archetypeName} source={source} />
        </Show>
        <Show when={tab() === 'matchups'}>
          <MatchupsTab rounds={careerRounds()} />
        </Show>
      </section>
    </>
  );
}

function ProfileSkeleton() {
  return (
    <>
      <section class='hero'>
        <Skeleton width='280px' height='32px' />
        <div style={{ 'margin-top': '6px' }}>
          <Skeleton width='220px' height='13px' />
        </div>
        <div style={{ 'margin-top': '10px' }}>
          <Skeleton width='520px' height='13px' />
        </div>
      </section>
      <section>
        <Skeleton width='240px' height='36px' />
        <div style={{ 'margin-top': '20px' }}>
          <Skeleton height='420px' />
        </div>
      </section>
    </>
  );
}
