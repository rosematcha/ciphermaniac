/**
 * /host: for someone signed out, the home page (HostHome: what running an
 * event here is, and sign-in for organizers). Signed in, the events they run
 * or staff: a hero with the count of each and the ways to start one, the
 * events running now each in its own box with the console a press away, then the
 * rest in a table. Only an Organizer or an Admin starts events; any other
 * account sees where it stands on applying instead (see ApplicantLine), and
 * still runs the events it owns or staffs.
 *
 * An event starts two ways. A Swiss event is run entirely on the site. A TOM
 * event starts from the .tdf TOM saves to, on desktop where TOM runs; on a
 * browser that can hold a file, the file stays linked so later saves reach
 * the site without another upload. Either way the setup (EventSetup) asks
 * the rest, in place of the lists. `?new=<store>` opens the Swiss setup as
 * that store, as store settings' Start an event does.
 */

import { A, useNavigate, useSearchParams } from '@solidjs/router';
import { createResource, createSignal, For, lazy, Match, onMount, Show, Switch, untrack } from 'solid-js';
import { canRunCommunityEvents } from '../../../shared/accounts/roles';
import { canCreateEvents, managesStore } from '../../../shared/accounts/stores';
import { parseTomDate } from '../../../shared/tournament/divisions';
import { parseTdf } from '../../../shared/tournament/tdf';
import type { Tournament } from '../../../shared/tournament/types';
import {
  ApiError,
  createFromTdf,
  createSwiss,
  errorText,
  fetchView,
  listTournaments,
  type Me,
  type TournamentSummary
} from '../../lib/tournament/api';
import { canLinkFiles, pickTdf, rememberHandle, type TdfHandle } from '../../lib/tournament/tomLink';
import { latestValue } from '../../lib/resource';
import { eventStatus, roundCapOf } from '../../lib/tournament/present';
import type { MyStore } from '../../../shared/accounts/types';
import { ApplicantLine } from './ApplicantStatus';
import { EventSetup, type RunAs, type Setup } from './EventSetup';
import { ErrorLine } from './Field';
import { TournamentHero } from './Hero';
import { refreshSession, session } from './session';

const HostHome = lazy(() => import('./HostHome').then(m => ({ default: m.HostHome })));

const shortDate = (startDate: string) =>
  parseTomDate(startDate)?.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }) ?? '';

type Phase = 'live' | 'upcoming' | 'finished';

/** Running (a round paired, not closed), still to start, or closed. */
const phaseOf = (event: TournamentSummary): Phase => {
  if (event.finished) {
    return 'finished';
  }
  return event.rounds > 0 ? 'live' : 'upcoming';
};

const PHASE_WORDS: Record<Phase, string> = { live: 'Running', upcoming: 'Registration', finished: 'Finished' };

function EventRow(props: { event: TournamentSummary }) {
  const finished = () => props.event.finished;
  return (
    <tr>
      <td class='tm-host-name'>
        <A class='tm-event-name' href={`/host/${props.event.code}`}>
          {props.event.name || props.event.code}
        </A>
        <Show when={props.event.role === 'staff'}>
          <span class='tm-flag'>Staff</span>
        </Show>
      </td>
      <td class='muted-cell tm-host-status'>{PHASE_WORDS[phaseOf(props.event)]}</td>
      <td class='muted-cell tm-nowrap tm-wide-col'>{shortDate(props.event.startDate)}</td>
      <td class='muted-cell tm-wide-col'>{props.event.mode === 'tom' ? 'TOM' : 'Swiss'}</td>
      {/* The unit shows on a phone, where the column heads do not. */}
      <td class='num tm-host-players' data-unit={props.event.players === 1 ? 'player' : 'players'}>
        {props.event.players}
      </td>
      <td class='tm-extra-col'>
        <span class='tm-row-actions'>
          <A class='btn btn-ghost tm-small' href={`/host/${props.event.code}${finished() ? '?tab=standings' : ''}`}>
            {finished() ? 'Results' : 'Console'}
          </A>
          <A class='btn btn-ghost tm-small' href={`/t/${props.event.code}`}>
            Public page
          </A>
        </span>
      </td>
    </tr>
  );
}

function EventTable(props: { title: string; events: readonly TournamentSummary[] }) {
  return (
    <section class='tm-host-section'>
      <h2 class='tm-subhead tm-box-head'>{props.title}</h2>
      <div class='tm-box'>
        <div class='table-wrap'>
          <table class='data tm-host-table'>
            <thead>
              <tr>
                <th>Event</th>
                <th>Status</th>
                <th class='tm-wide-col'>Date</th>
                <th class='tm-wide-col'>Run in</th>
                <th class='num'>Players</th>
                <th>
                  <span class='sr-only'>Links</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <For each={props.events}>{event => <EventRow event={event} />}</For>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/** The event running now: where its round stands, and its console, big screen and public page. */
/** `first`: the live event at the top, whose console is the page's one primary step. */
function LiveEvent(props: { event: TournamentSummary; first: boolean }) {
  const [view] = createResource(
    () => props.event.code,
    code => fetchView(code)
  );
  const status = () => {
    const current = latestValue(view);
    return current
      ? eventStatus(
          current.tournament,
          { pending: current.pending, finished: false, firstRound: null, roundCap: roundCapOf(current) },
          Date.now()
        ).join(' · ')
      : 'Running';
  };
  return (
    <section class='tm-box tm-live-event'>
      <div class='tm-live-event-text'>
        <h2>{props.event.name || props.event.code}</h2>
        <p class='tm-status'>{status()}</p>
      </div>
      <div class='tm-live-event-acts'>
        <A class={props.first ? 'btn btn-primary' : 'btn btn-secondary'} href={`/host/${props.event.code}`}>
          Open console
        </A>
        <a class='btn btn-secondary' href={`/t/${props.event.code}?screen=1`} target='_blank' rel='noopener'>
          Big screen
        </a>
        <A class='btn btn-ghost' href={`/t/${props.event.code}`}>
          Public page
        </A>
      </div>
    </section>
  );
}

type Stage = { kind: 'lists' } | { kind: 'swiss' } | { kind: 'tom'; tournament: Tournament; handle: TdfHandle | null };

/**
 * Picking up a .tdf: the file is read and parsed first, so the setup only
 * opens once it is known to be a tournament. Desktop only, where TOM runs.
 */
function LinkTdf(props: {
  busy: boolean;
  class: string;
  onRead: (tournament: Tournament, handle: TdfHandle | null) => void;
  onError: (message: string) => void;
}) {
  function read(text: string, handle: TdfHandle | null) {
    try {
      props.onRead(parseTdf(text), handle);
    } catch (err) {
      props.onError(errorText(err));
    }
  }
  async function readFile(file: File) {
    read(await file.text(), null);
  }
  async function link() {
    try {
      const handle = await pickTdf();
      read(await (await handle.getFile()).text(), handle);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        props.onError(errorText(err));
      }
    }
  }
  return (
    <Show
      when={canLinkFiles()}
      fallback={
        <label class={`${props.class} tm-desktop-only`}>
          Choose .tdf file
          <input
            type='file'
            accept='.tdf'
            class='sr-only'
            disabled={props.busy}
            onChange={e => {
              const file = e.currentTarget.files?.[0];
              if (file) {
                void readFile(file);
              }
            }}
          />
        </label>
      }
    >
      <button type='button' class={`${props.class} tm-desktop-only`} disabled={props.busy} onClick={() => void link()}>
        Link .tdf file
      </button>
    </Show>
  );
}

/**
 * The stores the account belongs to, each to its settings for its Owner and
 * Managers and its page for Staff, then the way to apply for another (or a
 * first, for a Community organizer: the way from running events under its
 * own name to running a store's).
 */
function StoreLinks(props: { stores: readonly MyStore[]; apply: boolean }) {
  return (
    <>
      <For each={props.stores}>
        {(store, i) => (
          <>
            <Show when={i() > 0}>
              <span class='tm-hero-dot' aria-hidden='true'>
                ·
              </span>
            </Show>
            <A href={managesStore(store.role) ? `/stores/${store.id}/settings` : `/stores/${store.id}`}>
              {managesStore(store.role) ? `${store.name} settings` : store.name}
            </A>
          </>
        )}
      </For>
      <Show when={props.apply}>
        <Show when={props.stores.length > 0}>
          <span class='tm-hero-dot' aria-hidden='true'>
            ·
          </span>
        </Show>
        <A href='/apply'>Apply for a store</A>
      </Show>
    </>
  );
}

/**
 * /host's meta line: the account's stores, and the way to apply for one when
 * it may start events; one that may not is offered a way by ApplicantLine.
 */
function HeroMeta(props: { user: Me | null | undefined }) {
  const stores = () => props.user?.stores ?? [];
  const mayCreate = () => canCreateEvents(props.user?.role ?? null, stores());
  return (
    <Show when={stores().length > 0 || mayCreate()}>
      <StoreLinks stores={stores()} apply={mayCreate()} />
    </Show>
  );
}

function Organizer(props: { onOpened: (code: string) => void }) {
  const [params, setParams] = useSearchParams<{ new?: string }>();
  const user = () => latestValue(session)?.user;
  const role = () => user()?.role ?? null;
  const [events] = createResource(user, () => listTournaments().then(result => result.tournaments));
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const all = () => latestValue(events) ?? [];
  const byPhase = (phase: Phase) => all().filter(event => phaseOf(event) === phase);
  const live = () => byPhase('live');
  const rest = () => all().filter(event => phaseOf(event) !== 'live');
  const counts = () =>
    all().length === 0
      ? 'No events yet'
      : (['live', 'upcoming', 'finished'] as Phase[]).map(phase => `${byPhase(phase).length} ${phase}`).join(' · ');

  async function create(setup: Setup) {
    const current = stage();
    setBusy(true);
    setError(null);
    try {
      if (current.kind === 'tom') {
        const { code } = await createFromTdf(current.tournament, setup.store, setup.settings);
        if (current.handle) {
          await rememberHandle(code, current.handle);
        }
        props.onOpened(code);
      } else {
        props.onOpened((await createSwiss(setup)).code);
      }
    } catch (err) {
      setError(errorText(err));
      // The account may no longer start events (its access was removed since the page read it): back to
      // the lists, which reread who it is and offer the way to apply instead.
      if (err instanceof ApiError && err.body?.apply === true) {
        setStage({ kind: 'lists' });
        void refreshSession();
      }
    } finally {
      setBusy(false);
    }
  }

  const tdfRead = (tournament: Tournament, handle: TdfHandle | null) => {
    setError(null);
    setStage({ kind: 'tom', tournament, handle });
  };
  /** Who may run a new event: the account's active stores, then the account itself when it may. A TOM event is a store's. */
  const runAs = (tom: boolean): RunAs[] => [
    ...(user()?.stores ?? [])
      .filter(store => store.status === 'active')
      .map(store => ({ id: store.id, label: store.name })),
    ...(!tom && canRunCommunityEvents(role()) ? [{ id: null, label: user()?.name ?? '' }] : [])
  ];
  /** The store `?new=` asks to start an event as, when the account may. */
  const asked = untrack(() => runAs(false).find(option => option.id !== null && option.id === params.new)?.id ?? null);
  const [stage, setStage] = createSignal<Stage>(asked ? { kind: 'swiss' } : { kind: 'lists' });
  /** One primary on the page: starting an event, unless an event is running, whose console is. */
  const startClass = () => (live().length > 0 ? 'btn btn-secondary' : 'btn btn-primary');

  return (
    <Switch>
      <Match when={stage().kind === 'lists'}>
        <TournamentHero
          title='Run an event'
          status={<span class='muted'>{counts()}</span>}
          meta={<HeroMeta user={user()} />}
          action={
            <Show
              when={canCreateEvents(role(), user()?.stores ?? [])}
              fallback={<ApplicantLine role={role()} primary={live().length === 0} />}
            >
              <span class='tm-hero-acts'>
                <button type='button' class={startClass()} onClick={() => setStage({ kind: 'swiss' })}>
                  Start an event
                </button>
                <Show when={runAs(true).length > 0}>
                  <LinkTdf busy={busy()} class='btn btn-secondary' onRead={tdfRead} onError={setError} />
                </Show>
              </span>
            </Show>
          }
        />
        <ErrorLine message={error()} />
        <For each={live()}>{(event, i) => <LiveEvent event={event} first={i() === 0} />}</For>
        <Show when={rest().length > 0}>
          <EventTable title='Your events' events={rest()} />
        </Show>
      </Match>
      <Match when={stage().kind !== 'lists'}>
        <EventSetup
          mode={stage().kind === 'tom' ? 'tom' : 'swiss'}
          tdfName={(stage() as Extract<Stage, { kind: 'tom' }>).tournament?.info.name}
          tdfSanctioned={Boolean((stage() as Extract<Stage, { kind: 'tom' }>).tournament?.info.sanctionId)}
          runAs={runAs(stage().kind === 'tom')}
          initialRunAs={asked}
          busy={busy()}
          error={error()}
          onCreate={setup => void create(setup)}
          onCancel={() => {
            setStage({ kind: 'lists' });
            setError(null);
            setParams({ new: undefined }, { replace: true });
          }}
        />
      </Match>
    </Switch>
  );
}

export function HostIndex() {
  const navigate = useNavigate();
  const current = () => latestValue(session);
  onMount(() => {
    document.title = 'Run an event — Ciphermaniac';
  });
  return (
    <div class='tm-page'>
      <Show when={current()}>
        {s => (
          <Show when={s().user} fallback={<HostHome offer={s()} />}>
            <Organizer onOpened={code => navigate(`/host/${code}`)} />
          </Show>
        )}
      </Show>
    </div>
  );
}
