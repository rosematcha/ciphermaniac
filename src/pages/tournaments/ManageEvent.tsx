/**
 * /host/:code: running an event. Staff land here from their list or from an
 * invite link (`?invite=`), which adds them to the event's staff on the way in.
 */

import { A, useSearchParams } from '@solidjs/router';
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { POD_LABELS, type PodCategory } from '../../../shared/tournament/types';
import { Segmented } from '../../components/Segmented';
import { Tabs } from '../../components/Tabs';
import { joinStaff, type Manage } from '../../lib/tournament/api';
import { divisionLookup, namesById } from '../../lib/tournament/present';
import { session } from './session';
import { latestValue } from '../../lib/resource';
import { DecklistsPanel } from './DecklistsPanel';
import { EventPanel } from './EventPanel';
import { ErrorLine } from './Field';
import { createManage } from './manageState';
import { PlayersPanel } from './PlayersPanel';
import { RoundPanel } from './RoundPanel';
import { SignIn } from './SignIn';
import { StandingsTable } from './StandingsTable';
import { TomSyncPanel } from './TomSyncPanel';

type Tab = 'round' | 'players' | 'standings' | 'decklists' | 'event';

const TABS: { value: Tab; label: string }[] = [
  { value: 'round', label: 'Pairings' },
  { value: 'players', label: 'Players' },
  { value: 'standings', label: 'Standings' },
  { value: 'decklists', label: 'Decklists' },
  { value: 'event', label: 'Event' }
];

/** Other staff change the event too; the console looks again this often while visible. */
const REFRESH_MS = 15_000;

function Hero(props: { manage: Manage }) {
  const info = () => props.manage.tournament.info;
  return (
    <section class='hero'>
      <h1>{info().name}</h1>
      <p class='hero-meta'>
        <span class='num'>{props.manage.code}</span>
        <span class='dot'>·</span>
        {props.manage.mode === 'tom' ? 'Run in TOM' : 'Swiss on this site'}
        <span class='dot'>·</span>
        {props.manage.tournament.players.length} players
        <span class='dot'>·</span>
        <A href={`/t/${props.manage.code}`}>Public page</A>
        <span class='dot'>·</span>
        <A href={`/t/${props.manage.code}?screen=1`}>Big screen</A>
      </p>
    </section>
  );
}

function Console(props: { state: ReturnType<typeof createManage>; manage: Manage }) {
  const [tab, setTab] = createSignal<Tab>('round');
  const [podChoice, setPodChoice] = createSignal<PodCategory | null>(null);
  const pods = () => props.manage.tournament.pods;
  const pod = createMemo(() => pods().find(p => p.category === podChoice()) ?? pods()[0]);
  const names = createMemo(() => namesById(props.manage.tournament));
  const divisionOf = createMemo(() => divisionLookup(props.manage.tournament));
  return (
    <>
      <Hero manage={props.manage} />
      <Show when={props.manage.mode === 'tom'}>
        <TomSyncPanel manage={props.manage} onSynced={props.state.load} />
      </Show>
      <Tabs options={TABS} selected={tab()} onSelect={setTab} ariaLabel='Event sections' />
      <Show when={pods().length > 1 && (tab() === 'round' || tab() === 'standings')}>
        <Segmented
          options={pods().map(p => ({ value: p.category, label: POD_LABELS[p.category] }))}
          selected={pod()?.category ?? 'masters'}
          onSelect={setPodChoice}
          ariaLabel='Division'
        />
      </Show>
      <ErrorLine message={props.state.error()} />
      <Show when={tab() === 'round'}>
        <Show when={pod()} fallback={<p class='muted'>Add players to start pairing.</p>}>
          {p => <RoundPanel state={props.state} manage={props.manage} pod={p()} />}
        </Show>
      </Show>
      <Show when={tab() === 'players'}>
        <PlayersPanel state={props.state} manage={props.manage} />
      </Show>
      <Show when={tab() === 'standings'}>
        <For each={pod() ? [pod()!] : []}>
          {p => (
            <StandingsTable
              tournament={props.manage.tournament}
              pod={p}
              names={names()}
              decks={props.manage.decks}
              divisionOf={divisionOf()}
            />
          )}
        </For>
      </Show>
      <Show when={tab() === 'decklists'}>
        <DecklistsPanel state={props.state} manage={props.manage} />
      </Show>
      <Show when={tab() === 'event'}>
        <EventPanel state={props.state} manage={props.manage} />
      </Show>
    </>
  );
}

export function ManageEvent(props: { code: string }) {
  const [params] = useSearchParams<{ invite?: string }>();
  const state = createManage(() => props.code);
  const [joinError, setJoinError] = createSignal<string | null>(null);
  const user = () => latestValue(session)?.user;

  async function enter(code: string, invite: string | undefined) {
    if (invite) {
      await joinStaff(code, invite).catch(err => setJoinError(err instanceof Error ? err.message : String(err)));
    }
    await state.load();
  }

  createEffect(() => {
    if (user()) {
      void enter(props.code, params.invite);
    }
  });

  onMount(() => {
    const timer = setInterval(() => {
      if (!document.hidden && state.data() && !state.busy()) {
        void state.load();
      }
    }, REFRESH_MS);
    onCleanup(() => clearInterval(timer));
  });

  createEffect(() => {
    document.title = `${state.data()?.tournament.info.name ?? props.code} — Run an event — Ciphermaniac`;
  });

  return (
    <Show
      when={user()}
      fallback={
        <Show when={latestValue(session)}>
          {s => (
            <SignIn
              providers={s().providers}
              next={`/host/${props.code}${params.invite ? `?invite=${params.invite}` : ''}`}
            />
          )}
        </Show>
      }
    >
      <ErrorLine message={joinError()} />
      <Show when={state.data()} fallback={<ErrorLine message={state.loadError()?.message} />}>
        {manage => <Console state={state} manage={manage()} />}
      </Show>
    </Show>
  );
}
