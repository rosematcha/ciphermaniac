/**
 * /t/:code: the page players follow. Pairings and standings update on their
 * own; a player who marks themselves (or whose profile's Player ID is on the
 * list) gets their table first. Decklists are submitted from here while the
 * organizer has submission open.
 */

import { useSearchParams } from '@solidjs/router';
import { createEffect, createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { parseTomDate } from '../../../shared/tournament/divisions';
import { swissStandings } from '../../../shared/tournament/standings';
import { type Pod, POD_LABELS, type PodCategory, type Round } from '../../../shared/tournament/types';
import { decksEnabled, isSanctioned, type TournamentView } from '../../../shared/tournament/view';
import { Segmented } from '../../components/Segmented';
import { Skeleton } from '../../components/Skeleton';
import { Tabs } from '../../components/Tabs';
import { fetchPublished, fetchView } from '../../lib/tournament/api';
import { latestValue } from '../../lib/resource';
import {
  currentMatchOf,
  currentRound,
  filterMatches,
  namesById,
  recordsBefore,
  roundLabel,
  STATUS_LABELS
} from '../../lib/tournament/present';
import { BigScreen } from './BigScreen';
import { Clock } from './Clock';
import { DecklistForm } from './DecklistForm';
import { DeckStats } from './DeckStats';
import { ErrorLine } from './Field';
import { MatchTable } from './MatchTable';
import { PlayerSheet } from './PlayerSheet';
import { StandingsTable } from './StandingsTable';

type Tab = 'pairings' | 'standings' | 'decks' | 'decklist';

const POLL_MS = 10_000;

/** The event, polled while the tab is visible; a poll that finds nothing new costs one tiny request. */
function createView(code: () => string) {
  const [view, { mutate }] = createResource(code, c => fetchView(c).then(v => v as TournamentView));
  onMount(() => {
    // Players read the published file, which costs the functions nothing;
    // staff, who see decks before the public does, ask the API, as does
    // anyone the file cannot reach (not published yet, or a local server).
    async function poll() {
      const current = latestValue(view);
      if (document.hidden || !current) {
        return;
      }
      const published = current.viewer.role ? null : await fetchPublished(code()).catch(() => null);
      if (published) {
        if (published.version > current.version) {
          mutate({ ...published, viewer: current.viewer });
        }
        return;
      }
      const next = await fetchView(code(), current.version).catch(() => null);
      if (next) {
        mutate(next);
      }
    }
    const timer = setInterval(() => void poll(), POLL_MS);
    onCleanup(() => clearInterval(timer));
  });
  return view;
}

const meKey = (code: string) => `cm-tournament-me:${code}`;

function YourMatch(props: { view: TournamentView; me: string }) {
  const found = () => currentMatchOf(props.view.tournament, props.me);
  const names = () => namesById(props.view.tournament);
  return (
    <Show when={found()}>
      {f => {
        const opponent = () => (f().match.p1 === props.me ? f().match.p2 : f().match.p1);
        const records = () => recordsBefore(f().pod, f().round);
        return (
          <section class='tm-you' aria-label='Your match'>
            <span class='tm-you-round'>
              {names().get(props.me)} · {roundLabel(f().round)}
            </span>
            <Show
              when={f().match.table}
              fallback={<strong>{f().match.outcome === 'bye' ? 'Bye' : 'Not paired'}</strong>}
            >
              <strong>Table {f().match.table}</strong>
            </Show>
            <Show when={opponent()}>
              {o => (
                <span>
                  vs {names().get(o())} <span class='muted num'>{records().get(o())}</span>
                </span>
              )}
            </Show>
            <Clock round={f().round} />
          </section>
        );
      }}
    </Show>
  );
}

function hasPodData(view: TournamentView) {
  return view.tournament.pods.some(pod => pod.rounds.length > 0);
}

/**
 * Which player the viewer is: the one their profile's Player ID matches, or
 * the one they marked on this device.
 */
function createMe(view: () => TournamentView) {
  const [chosen, setChosen] = createSignal(localStorage.getItem(meKey(view().code)));
  const setMe = (id: string | null) => {
    if (id) {
      localStorage.setItem(meKey(view().code), id);
    } else {
      localStorage.removeItem(meKey(view().code));
    }
    setChosen(id);
  };
  return { me: () => view().viewer.me ?? chosen(), setMe };
}

function tabsFor(view: TournamentView): { value: Tab; label: string }[] {
  return [
    { value: 'pairings', label: 'Pairings' },
    { value: 'standings', label: 'Standings' },
    ...(Object.keys(view.decks).length ? [{ value: 'decks' as const, label: 'Decks' }] : []),
    ...(view.settings.decklistsOpen ? [{ value: 'decklist' as const, label: 'Submit decklist' }] : [])
  ];
}

/** The tab the URL asks for if the event has it; before round 1, the decklist form when it is open. */
/** Before round 1, the decklist form if it is open; once the event is closed, where everyone finished. */
function defaultTab(view: TournamentView): Tab {
  if (!hasPodData(view)) {
    return 'decklist';
  }
  return view.settings.finished ? 'standings' : 'pairings';
}

function pickTab(tabs: readonly { value: Tab }[], wanted: string | undefined, view: TournamentView): Tab {
  const choice = (wanted as Tab | undefined) ?? defaultTab(view);
  return tabs.some(t => t.value === choice) ? choice : 'pairings';
}

function RoundSelect(props: { pod: Pod | undefined; round: Round | undefined; onSelect: (n: number) => void }) {
  return (
    <Show when={props.pod?.rounds.length}>
      <select class='tm-select' aria-label='Round' onChange={e => props.onSelect(Number(e.currentTarget.value))}>
        <For each={props.pod?.rounds ?? []}>
          {r => (
            <option value={r.number} selected={r.number === props.round?.number}>
              {roundLabel(r)} · {STATUS_LABELS[r.status]}
            </option>
          )}
        </For>
      </select>
    </Show>
  );
}

/** The sheet for the player last opened, in the pod they play in. */
function OpenPlayer(props: {
  view: TournamentView;
  fallback: Pod | undefined;
  id: string;
  me: string | null;
  names: Map<string, string>;
  onMe: (id: string | null) => void;
  onOpen: (id: string | null) => void;
}) {
  const pod = () => props.view.tournament.pods.find(p => p.playerIds.includes(props.id)) ?? props.fallback;
  return (
    <Show when={pod()}>
      {p => (
        <PlayerSheet
          playerId={props.id}
          pod={p()}
          standing={swissStandings(p(), props.view.tournament.players).find(row => row.playerId === props.id)}
          names={props.names}
          decks={props.view.decks}
          isMe={props.me === props.id}
          onMe={props.onMe}
          onClose={() => props.onOpen(null)}
          onPlayer={props.onOpen}
        />
      )}
    </Show>
  );
}

function EventBody(props: { view: TournamentView }) {
  const [params, setParams] = useSearchParams<{ tab?: string }>();
  const [podChoice, setPodChoice] = createSignal<PodCategory | null>(null);
  const [roundChoice, setRoundChoice] = createSignal<number | null>(null);
  const [query, setQuery] = createSignal('');
  const [open, setOpen] = createSignal<string | null>(null);
  const { me, setMe } = createMe(() => props.view);
  const pods = () => props.view.tournament.pods;
  const pod = createMemo(() => pods().find(p => p.category === podChoice()) ?? pods()[0]);
  const round = createMemo(() => pod()?.rounds.find(r => r.number === roundChoice()) ?? currentRound(pod()));
  const names = createMemo(() => namesById(props.view.tournament));
  const divisionOf = (id: string) => props.view.divisions[id] ?? 'masters';
  const tabs = createMemo(() => tabsFor(props.view));
  const tab = () => pickTab(tabs(), params.tab, props.view);

  return (
    <>
      <Show when={me()}>{id => <YourMatch view={props.view} me={id()} />}</Show>
      <Tabs options={tabs()} selected={tab()} onSelect={value => setParams({ tab: value }, { replace: true })} />
      <Show when={pods().length > 1 && (tab() === 'pairings' || tab() === 'standings')}>
        <Segmented
          options={pods().map(p => ({ value: p.category, label: POD_LABELS[p.category] }))}
          selected={pod()?.category ?? 'masters'}
          onSelect={value => {
            setPodChoice(value);
            setRoundChoice(null);
          }}
          ariaLabel='Division'
        />
      </Show>
      <Show when={tab() === 'pairings' || tab() === 'standings'}>
        <div class='tm-toolbar'>
          <input
            class='search'
            type='search'
            placeholder='Find a player'
            aria-label='Find a player'
            value={query()}
            onInput={e => setQuery(e.currentTarget.value)}
          />
          <Show when={tab() === 'pairings'}>
            <RoundSelect pod={pod()} round={round()} onSelect={setRoundChoice} />
          </Show>
        </div>
      </Show>
      <Show when={tab() === 'pairings'}>
        <Show when={pod() && round()} fallback={<p class='muted'>Pairings will show here once round 1 is paired.</p>}>
          <MatchTable
            pod={pod()!}
            round={round()!}
            matches={filterMatches(round()!.matches, names(), query())}
            names={names()}
            decks={props.view.decks}
            pending={props.view.pending}
            me={me()}
            onPlayer={setOpen}
          />
        </Show>
      </Show>
      <Show when={tab() === 'standings' && pod()}>
        <StandingsTable
          tournament={props.view.tournament}
          pod={pod()!}
          names={names()}
          decks={props.view.decks}
          divisionOf={divisionOf}
          me={me()}
          query={query()}
          onPlayer={setOpen}
        />
      </Show>
      <Show when={tab() === 'decks'}>
        <DeckStats tournament={props.view.tournament} decks={props.view.decks} />
      </Show>
      <Show when={tab() === 'decklist'}>
        <DecklistForm
          code={props.view.code}
          archetypes={decksEnabled(props.view.settings)}
          sanctioned={isSanctioned(props.view)}
        />
      </Show>
      <Show when={open()}>
        {id => (
          <OpenPlayer
            view={props.view}
            fallback={pod()}
            id={id()}
            me={me()}
            onMe={setMe}
            onOpen={setOpen}
            names={names()}
          />
        )}
      </Show>
    </>
  );
}

/** One date format across the page: the organizer's start time, else TOM's start date. */
function eventDate(startsAt: string, startDate: string): string {
  if (startsAt) {
    return new Date(startsAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }
  const tom = parseTomDate(startDate);
  return tom ? tom.toLocaleDateString(undefined, { dateStyle: 'medium', timeZone: 'UTC' }) : '';
}

/** When the page last changed: a time today, a date before that. */
function updatedLabel(at: number): string {
  const date = new Date(at);
  const today = new Date().toDateString() === date.toDateString();
  return today
    ? date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

function Hero(props: { view: TournamentView }) {
  const info = () => props.view.tournament.info;
  const settings = () => props.view.settings;
  const when = () => eventDate(settings().startsAt, info().startDate);
  const place = () => [info().city, info().state].filter(Boolean).join(', ');
  const parts = () =>
    [
      when(),
      settings().format,
      place(),
      `${props.view.tournament.players.length} players`,
      settings().finished ? 'Finished' : '',
      `Updated ${updatedLabel(props.view.updatedAt)}`
    ].filter(Boolean);
  return (
    <section class='hero'>
      <h1>{info().name}</h1>
      <p class='hero-meta'>
        <For each={parts()}>
          {(part, i) => (
            <>
              {/* The dot trails the part before it, so a wrapped line never starts on one. */}
              <span class='tm-meta-part'>
                {part}
                <Show when={i() < parts().length - 1}>
                  <span class='dot'>·</span>
                </Show>
              </span>{' '}
            </>
          )}
        </For>
      </p>
      <Show when={settings().details}>
        <p class='tm-details'>{settings().details}</p>
      </Show>
    </section>
  );
}

export function PublicEvent(props: { code: string }) {
  const [params] = useSearchParams<{ screen?: string }>();
  const view = createView(() => props.code);
  const current = () => latestValue(view);
  createEffect(() => {
    document.title = `${current()?.tournament.info.name ?? props.code} — Ciphermaniac`;
  });
  return (
    <Show
      when={current()}
      fallback={
        <Show when={view.error} fallback={<Skeleton width='280px' height='28px' />}>
          <ErrorLine message={view.error instanceof Error ? view.error.message : 'This event could not be loaded.'} />
        </Show>
      }
    >
      {v => (
        <Show when={params.screen !== '1'} fallback={<BigScreen view={v()} />}>
          <div class='tm-page'>
            <Hero view={v()} />
            <EventBody view={v()} />
          </div>
        </Show>
      )}
    </Show>
  );
}
