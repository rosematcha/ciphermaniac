/**
 * /t/:code: the page players follow. The head says where the event stands;
 * a player the page knows (by their profile's Player ID, a device that
 * remembers them, or "This is me" in a player sheet) gets their own match
 * first. Pairings and standings update on their own, each in one box with the
 * division switch and search in its bar. Decks show only as the event allows
 * (the server leaves hidden ones out), and decklists are submitted from here
 * while the organizer has submission open.
 */

import { useSearchParams } from '@solidjs/router';
import { createEffect, createMemo, createResource, createSignal, For, lazy, onCleanup, onMount, Show } from 'solid-js';
import { parseTomDate } from '../../../shared/tournament/divisions';
import { hasStarted, latestRound, podOf } from '../../../shared/tournament/rounds';
import { recordLabel, swissStandings } from '../../../shared/tournament/standings';
import { type Pod, POD_LABELS, type PodCategory, type Round } from '../../../shared/tournament/types';
import type { PlayerClaim } from '../../../shared/tournament/identify';
import {
  decklistsOpen,
  decksEnabled,
  isSanctioned,
  type PublishedView,
  type TournamentView
} from '../../../shared/tournament/view';
import { Segmented } from '../../components/Segmented';
import { Skeleton } from '../../components/Skeleton';
import { Tabs } from '../../components/Tabs';
import { ApiError, fetchPublished, fetchView, identifyPlayer } from '../../lib/tournament/api';
import { ordinal } from '../../lib/format';
import { latestValue } from '../../lib/resource';
import { onChange } from '../../lib/tournament/changes';
import { shared } from '../../lib/tournament/share';
import {
  createViewPoll,
  firstView,
  lookOnReturn,
  POLL_MS,
  schedulePolls,
  SCREEN_POLL_MS,
  seesMoreThanPublished
} from '../../lib/tournament/viewPoll';
import {
  divisionHeading,
  eventStatus,
  filterMatches,
  firstRoundTime,
  namesById,
  podStandings,
  roundCapOf,
  roundLabel,
  STATUS_LABELS
} from '../../lib/tournament/present';
import { ErrorLine } from './Field';
import { TournamentHero } from './Hero';
import { MatchTable } from './MatchTable';
import { createNow } from './now';
import { PlayerSheet } from './PlayerSheet';
import type { Identified } from './Identify';
import { StandingsTable } from './StandingsTable';
import { YourMatch } from './YourMatch';
import '../../styles/pages/tournament-public.css';

const BigScreen = lazy(() => import('./BigScreen').then(m => ({ default: m.BigScreen })));
const DeckStats = lazy(() => import('./DeckStats').then(m => ({ default: m.DeckStats })));
const DecklistForm = lazy(() => import('./DecklistForm').then(m => ({ default: m.DecklistForm })));

type Tab = 'pairings' | 'standings' | 'decks' | 'decklist';

/** No event has this code: asking again will not find one. */
const missing = (error: unknown) => error instanceof ApiError && error.status === 404;

/**
 * The event, polled while the tab is visible (see lib/tournament/viewPoll.ts),
 * every `every` ms; a poll that finds nothing new costs one tiny request. It
 * also looks the moment the tab is shown again, and when the console in
 * another tab of this browser changes the event. `decks` is whether the page
 * shows decks, the only thing staff see that the published file does not.
 */
function createView(code: () => string, signedIn: () => boolean, options: { every: number; decks: boolean }) {
  const fromApi = (c: string) => fetchView(c).then(v => v as TournamentView);
  const [view, { mutate, refetch }] = createResource(code, c =>
    firstView({ published: () => fetchPublished(c), api: () => fromApi(c) })
  );
  /** Takes a copy no older than the one shown, of the same event: answers can land out of order. */
  function accept(next: TournamentView) {
    const current = latestValue(view);
    if (!current || (current.code === next.code && next.version >= current.version)) {
      mutate(shared(current, next));
    }
  }
  // The published file knows nobody. A signed-in viewer's copy comes from the API: staff see
  // decks before the public does, and an account's Player ID marks its player.
  let asked = '';
  createEffect(() => {
    const shown = latestValue(view);
    // Asked once an event: an answer that still knows nobody is not asked for again.
    if (signedIn() && shown && !shown.viewer.signedIn && asked !== shown.code) {
      asked = shown.code;
      void fromApi(shown.code)
        .then(accept)
        .catch(() => undefined);
    }
  });
  /** Loads the event again after its first load failed; whether it is there now. */
  async function reload(): Promise<boolean> {
    if (!view.error) {
      return true;
    }
    if (missing(view.error)) {
      return false;
    }
    try {
      return (await refetch()) != null;
    } catch {
      return false;
    }
  }
  onMount(() => {
    let announced = 0;
    const poll = createViewPoll({
      current: () => latestValue(view),
      ownCopy: shown => options.decks && seesMoreThanPublished(shown),
      announced: () => announced,
      reload,
      published: () => fetchPublished(code()),
      api: since => fetchView(code(), since),
      apply: accept,
      now: Date.now
    });
    const polls = schedulePolls(poll, () => document.hidden, options.every);
    const forget = lookOnReturn(polls);
    const unsubscribe = onChange(code(), version => {
      if (version > (latestValue(view)?.version ?? 0)) {
        announced = Math.max(announced, version);
        polls.soon();
      }
    });
    onCleanup(() => {
      polls.stop();
      unsubscribe();
      forget();
    });
  });
  /** Takes a fresher copy handed over by an action, such as a player's report. */
  function take(published: PublishedView) {
    const current = latestValue(view);
    if (current) {
      accept({ ...published, viewer: current.viewer });
    }
  }
  return { view, take, retry: () => void reload() };
}

const meKey = (code: string) => `cm-tournament-me:${code}`;
const claimKey = (code: string) => `cm-tournament-player:${code}`;
const tokenKey = (code: string) => `cm-tournament-report:${code}`;

function storedClaim(code: string): PlayerClaim | null {
  try {
    return JSON.parse(localStorage.getItem(claimKey(code)) ?? 'null') as PlayerClaim | null;
  } catch {
    return null;
  }
}

/** Sets or clears a remembered value. */
function keep(key: string, value: string | null) {
  if (value) {
    localStorage.setItem(key, value);
  } else {
    localStorage.removeItem(key);
  }
}

/**
 * Which player the viewer is: the one their profile's Player ID matches, or
 * the one they proved on this device with a Player ID or last name (see
 * Identify). A player marked on this device before proof was asked for is
 * not taken on its word.
 */
function createMe(view: () => TournamentView, onView: (view: PublishedView) => void) {
  const code = () => view().code;
  const stored = storedClaim(code());
  const [claim, setClaim] = createSignal(stored);
  const [chosen, setChosen] = createSignal(stored ? localStorage.getItem(meKey(code())) : null);
  const [reportToken, setReportToken] = createSignal(stored ? localStorage.getItem(tokenKey(code())) : null);
  function identified(found: Identified) {
    keep(meKey(code()), found.key);
    keep(claimKey(code()), JSON.stringify(found.claim));
    setChosen(found.key);
    setClaim(found.claim);
    // A new token when this device just became the one that reports; none kept when another device is.
    const token = found.reportToken ?? (found.reporter === false ? null : reportToken());
    keep(tokenKey(code()), token);
    setReportToken(token);
    onView(found.view);
  }
  function forget() {
    [meKey, claimKey, tokenKey].forEach(key => localStorage.removeItem(key(code())));
    setChosen(null);
    setClaim(null);
    setReportToken(null);
  }
  // A device that said who the player is before reporting took a token asks for one now, if nobody has it.
  async function claimNow(said: PlayerClaim) {
    const answer = await identifyPlayer(code(), said).catch(() => null);
    if (answer?.key) {
      identified({ ...answer, claim: said, key: answer.key });
    }
  }
  onMount(() => {
    const said = claim();
    if (said && !reportToken()) {
      void claimNow(said);
    }
  });
  return { me: () => view().viewer.me ?? chosen(), claim, reportToken, identified, forget };
}

function tabsFor(view: TournamentView): { value: Tab; label: string }[] {
  return [
    { value: 'pairings', label: 'Pairings' },
    { value: 'standings', label: 'Standings' },
    ...(Object.keys(view.decks).length ? [{ value: 'decks' as const, label: 'Decks' }] : []),
    ...(decklistsOpen(view.settings) ? [{ value: 'decklist' as const, label: 'Submit decklist' }] : [])
  ];
}

/** Before round 1, the decklist form if it is open; once the event is closed, where everyone finished. */
function defaultTab(view: TournamentView): Tab {
  if (!hasStarted(view.tournament)) {
    return 'decklist';
  }
  return view.settings.finished ? 'standings' : 'pairings';
}

function pickTab(tabs: readonly { value: Tab }[], wanted: string | undefined, view: TournamentView): Tab {
  const choice = (wanted as Tab | undefined) ?? defaultTab(view);
  return tabs.some(t => t.value === choice) ? choice : 'pairings';
}

/** One line under every panel while decks wait for the event to end. */
const deckNote = (view: TournamentView) =>
  view.settings.deckVisibility === 'after' && !view.settings.finished ? 'Decks shown once the event ends' : undefined;

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
  onIdentified: (found: Identified) => void;
  onForget: () => void;
  onOpen: (id: string | null) => void;
}) {
  const pod = createMemo(() => podOf(props.view.tournament, props.id) ?? props.fallback);
  const division = () => divisionHeading(props.view.divisions[props.id] ?? null);
  // Memos: the sheet reads these once per row of the player's history, and ranking a pod is a pass over its every match.
  const standings = createMemo(() => {
    const p = pod();
    return p ? swissStandings(p, props.view.tournament.players) : [];
  });
  const records = createMemo(() => new Map(standings().map(row => [row.playerId, recordLabel(row.record)])));
  const place = createMemo(() => {
    const p = pod();
    const divisionOf = (id: string) => props.view.divisions[id] ?? 'masters';
    const row = p
      ? podStandings(props.view.tournament, p, divisionOf)
          .flatMap(group => group.rows)
          .find(r => r.playerId === props.id)
      : undefined;
    return row && p?.rounds.length ? `${ordinal(row.place)} in ${division()}` : `${division()} · Registered`;
  });
  return (
    <Show when={pod()}>
      {p => (
        <PlayerSheet
          view={props.view}
          playerId={props.id}
          pod={p()}
          standing={standings().find(row => row.playerId === props.id)}
          place={place()}
          names={props.names}
          records={records()}
          decks={props.view.decks}
          isMe={props.me === props.id}
          onIdentified={props.onIdentified}
          onForget={props.onForget}
          onClose={() => props.onOpen(null)}
          onPlayer={props.onOpen}
        />
      )}
    </Show>
  );
}

/** Before round 1: who is in, by last name, so a player can check they are. */
function RegisteredList(props: {
  view: TournamentView;
  me: string | null;
  query: string;
  onPlayer: (id: string) => void;
}) {
  const players = () =>
    props.view.tournament.players
      .filter(player => player.droppedAfter === null)
      .filter(player =>
        `${player.firstName} ${player.lastName}`.toLowerCase().includes(props.query.trim().toLowerCase())
      )
      .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));
  return (
    <>
      <p class='tm-box-bar muted'>Pairings will show here once round 1 is paired.</p>
      <ul class='tm-registered'>
        <For each={players()}>
          {player => (
            <li>
              <button type='button' class='tm-seat-link' onClick={() => props.onPlayer(player.id)}>
                <span class='tm-name'>
                  {player.firstName} <strong>{player.lastName}</strong>
                </span>
                <Show when={player.id === props.me}>
                  <span class='tm-flag is-you'>You</span>
                </Show>
              </button>
            </li>
          )}
        </For>
      </ul>
    </>
  );
}

function EventBody(props: { view: TournamentView; onView: (view: PublishedView) => void }) {
  const [params, setParams] = useSearchParams<{ tab?: string }>();
  const [podChoice, setPodChoice] = createSignal<PodCategory | null>(null);
  const [roundChoice, setRoundChoice] = createSignal<number | null>(null);
  const [query, setQuery] = createSignal('');
  const [open, setOpen] = createSignal<string | null>(null);
  const { me, claim, reportToken, identified, forget } = createMe(
    () => props.view,
    view => props.onView(view)
  );
  const pods = () => props.view.tournament.pods;
  const myPod = () => podOf(props.view.tournament, me() ?? '')?.category ?? null;
  const pod = createMemo(() => pods().find(p => p.category === (podChoice() ?? myPod())) ?? pods()[0]);
  const round = createMemo(() => pod()?.rounds.find(r => r.number === roundChoice()) ?? latestRound(pod()));
  const names = createMemo(() => namesById(props.view.tournament));
  const divisionOf = (id: string) => props.view.divisions[id] ?? 'masters';
  const tabs = createMemo(() => tabsFor(props.view));
  const tab = () => pickTab(tabs(), params.tab, props.view);
  // A memo: the bar is drawn from it, and a bar drawn again on every new copy drops the search mid-word.
  const started = createMemo(() => hasStarted(props.view.tournament));

  const bar = (withRounds: boolean) => (
    <>
      <Show when={pods().length > 1}>
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
      <input
        class='search tm-grow'
        type='search'
        placeholder='Find a player'
        aria-label='Find a player'
        value={query()}
        onInput={e => setQuery(e.currentTarget.value)}
      />
      <Show when={withRounds}>
        <RoundSelect pod={pod()} round={round()} onSelect={setRoundChoice} />
      </Show>
    </>
  );

  return (
    <>
      <YourMatch
        view={props.view}
        me={me()}
        claim={claim()}
        reportToken={reportToken()}
        onIdentified={identified}
        onForget={forget}
        onView={props.onView}
        onPlayer={setOpen}
        firstRound={firstRoundTime(props.view.settings.startsAt)}
      />
      <Tabs options={tabs()} selected={tab()} onSelect={value => setParams({ tab: value }, { replace: true })} />
      <Show when={tab() === 'pairings'}>
        <section class='tm-box tm-public-pairings'>
          <div class='tm-box-bar'>{bar(started())}</div>
          <Show
            when={pod() && round()}
            fallback={<RegisteredList view={props.view} me={me()} query={query()} onPlayer={setOpen} />}
          >
            <MatchTable
              pod={pod()!}
              round={round()!}
              matches={filterMatches(round()!.matches, names(), query())}
              names={names()}
              decks={props.view.decks}
              pending={props.view.pending}
              me={me()}
              onPlayer={setOpen}
              status
            />
          </Show>
          <Show when={started() && deckNote(props.view)}>
            {note => <p class='tm-box-bar tm-box-note muted'>{note()}</p>}
          </Show>
        </section>
      </Show>
      <Show when={tab() === 'standings' && pod()}>
        <Show
          when={started()}
          fallback={<p class='muted tm-empty'>Standings will show here once round 1 is played.</p>}
        >
          <StandingsTable
            tournament={props.view.tournament}
            pod={pod()!}
            names={names()}
            decks={props.view.decks}
            divisionOf={divisionOf}
            me={me()}
            query={query()}
            onPlayer={setOpen}
            bar={bar(false)}
            note={deckNote(props.view)}
          />
        </Show>
      </Show>
      <Show when={tab() === 'decks'}>
        <DeckStats tournament={props.view.tournament} decks={props.view.decks} />
      </Show>
      <Show when={tab() === 'decklist'}>
        <DecklistForm
          code={props.view.code}
          archetypes={decksEnabled(props.view.settings)}
          format={props.view.settings.format}
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
            onIdentified={identified}
            onForget={forget}
            onOpen={setOpen}
            names={names()}
          />
        )}
      </Show>
    </>
  );
}

const sameYear = (date: Date) => date.getFullYear() === new Date().getFullYear();

/** "Sat, Oct 3", with the year only outside this one. */
const dayLabel = (date: Date, timeZone?: string) =>
  date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(sameYear(date) ? {} : { year: 'numeric' }),
    ...(timeZone ? { timeZone } : {})
  });

/** One date format across the page: the organizer's start time, else TOM's start date. */
function eventDate(startsAt: string, startDate: string): string {
  if (startsAt) {
    const date = new Date(startsAt);
    return `${dayLabel(date)} · ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  }
  const tom = parseTomDate(startDate);
  return tom ? dayLabel(tom, 'UTC') : '';
}

/** When the page last changed: a time today, a date before that. */
function updatedLabel(at: number): string {
  const date = new Date(at);
  const today = new Date().toDateString() === date.toDateString();
  return today ? date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : dayLabel(date);
}

function Hero(props: { view: TournamentView }) {
  const now = createNow();
  const info = () => props.view.tournament.info;
  const settings = () => props.view.settings;
  const status = () =>
    eventStatus(
      props.view.tournament,
      {
        pending: props.view.pending,
        finished: settings().finished,
        firstRound: firstRoundTime(settings().startsAt),
        roundCap: roundCapOf(props.view)
      },
      now()
    ).join(' · ');
  const place = () => [info().city, info().state].filter(Boolean).join(', ');
  const parts = () =>
    [
      eventDate(settings().startsAt, info().startDate),
      settings().format,
      place(),
      `${props.view.tournament.players.length} players`,
      `Updated ${updatedLabel(props.view.updatedAt)}`
    ].filter(Boolean);
  return (
    <>
      <TournamentHero
        title={info().name}
        status={status()}
        meta={
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
        }
      />
      <Show when={settings().details}>
        <p class='tm-details'>{settings().details}</p>
      </Show>
    </>
  );
}

/** `signedIn`: whether an account is signed in, which the page's own copy of the event cannot say (see createView). */
export function PublicEvent(props: { code: string; signedIn: boolean }) {
  const [params] = useSearchParams<{ screen?: string }>();
  // The page is the big screen or not for as long as it is open.
  const screen = params.screen === '1';
  // The big screen draws no decks, so it reads the published file even in a staff browser.
  const { view, take, retry } = createView(
    () => props.code,
    () => props.signedIn,
    {
      every: screen ? SCREEN_POLL_MS : POLL_MS,
      decks: !screen
    }
  );
  const current = () => latestValue(view);
  // A past format's sprites come with its archetype list, loaded only when there are decks to draw.
  const pastFormat = createMemo(() => {
    const shown = current();
    return shown && shown.settings.format !== 'Standard' && Object.keys(shown.decks).length > 0
      ? shown.settings.format
      : null;
  });
  createEffect(() => {
    const format = pastFormat();
    if (format) {
      void import('./deckOptions').then(m => m.learnFormatIcons(format));
    }
  });
  createEffect(() => {
    document.title = `${current()?.tournament.info.name ?? props.code} — Ciphermaniac`;
  });
  return (
    <Show
      when={current()}
      fallback={
        <Show when={view.error} fallback={<Skeleton width='280px' height='28px' />}>
          <ErrorLine message={view.error instanceof Error ? view.error.message : 'This event could not be loaded.'} />
          <Show when={!missing(view.error)}>
            <button type='button' class='btn btn-secondary tm-small' onClick={() => retry()}>
              Retry
            </button>
          </Show>
        </Show>
      }
    >
      {v => (
        <Show when={!screen} fallback={<BigScreen view={v()} />}>
          <div class='tm-page tm-public'>
            <Hero view={v()} />
            <EventBody view={v()} onView={take} />
          </div>
        </Show>
      )}
    </Show>
  );
}
