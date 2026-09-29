/**
 * /host: for someone signed out, the home page (HostHome: what running an
 * event here is, and sign-in for organizers). Signed in, the events they run
 * or staff: a hero with the count of each and the ways to start one, the
 * events running now each in its own box with the console a press away, then the
 * rest in a table.
 *
 * An event starts two ways. A Swiss event is run entirely on the site. A TOM
 * event starts from the .tdf TOM saves to, on desktop where TOM runs; on a
 * browser that can hold a file, the file stays linked so later saves reach
 * the site without another upload. Either way the setup (EventSetup) asks
 * the rest, in place of the lists.
 */

import { A, useNavigate } from '@solidjs/router';
import { createResource, createSignal, For, lazy, Match, onMount, Show, Switch } from 'solid-js';
import { parseTomDate } from '../../../shared/tournament/divisions';
import { parseTdf } from '../../../shared/tournament/tdf';
import type { Tournament } from '../../../shared/tournament/types';
import {
  createFromTdf,
  createSwiss,
  fetchView,
  listTournaments,
  type TournamentSummary
} from '../../lib/tournament/api';
import { canLinkFiles, pickTdf, rememberHandle, type TdfHandle } from '../../lib/tournament/tomLink';
import { latestValue } from '../../lib/resource';
import { eventStatus, roundCapOf } from '../../lib/tournament/present';
import { EventSetup, type Setup } from './EventSetup';
import { ErrorLine } from './Field';
import { TournamentHero } from './Hero';
import { session } from './session';

const HostHome = lazy(() => import('./HostHome').then(m => ({ default: m.HostHome })));

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

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
      <td>
        <A class='tm-event-name' href={`/host/${props.event.code}`}>
          {props.event.name || props.event.code}
        </A>
        <Show when={props.event.role === 'staff'}>
          <span class='tm-flag'>Staff</span>
        </Show>
      </td>
      <td class='muted-cell'>{PHASE_WORDS[phaseOf(props.event)]}</td>
      <td class='muted-cell tm-nowrap'>{shortDate(props.event.startDate)}</td>
      <td class='muted-cell tm-wide-col'>{props.event.mode === 'tom' ? 'TOM' : 'Swiss'}</td>
      <td class='num'>{props.event.players}</td>
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
      <h2 class='tm-th tm-box-head'>{props.title}</h2>
      <div class='tm-box'>
        <div class='table-wrap'>
          <table class='data tm-host-table'>
            <thead>
              <tr>
                <th>Event</th>
                <th>Status</th>
                <th>Date</th>
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
function LiveEvent(props: { event: TournamentSummary }) {
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
        <A class='btn btn-primary' href={`/host/${props.event.code}`}>
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

function Organizer(props: { onOpened: (code: string) => void }) {
  const user = () => latestValue(session)?.user;
  const [events] = createResource(user, () => listTournaments().then(result => result.tournaments));
  const [stage, setStage] = createSignal<Stage>({ kind: 'lists' });
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
        const { code } = await createFromTdf(current.tournament, setup.settings);
        if (current.handle) {
          await rememberHandle(code, current.handle);
        }
        props.onOpened(code);
      } else {
        props.onOpened((await createSwiss(setup)).code);
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const tdfRead = (tournament: Tournament, handle: TdfHandle | null) => {
    setError(null);
    setStage({ kind: 'tom', tournament, handle });
  };
  /** One primary on the page: starting an event, unless an event is running, whose console is. */
  const startClass = () => (live().length > 0 ? 'btn btn-secondary' : 'btn btn-primary');

  return (
    <Switch>
      <Match when={stage().kind === 'lists'}>
        <TournamentHero
          title='Run an event'
          status={<span class='muted'>{counts()}</span>}
          action={
            <span class='tm-hero-acts'>
              <button type='button' class={startClass()} onClick={() => setStage({ kind: 'swiss' })}>
                Start an event
              </button>
              <LinkTdf busy={busy()} class='btn btn-secondary' onRead={tdfRead} onError={setError} />
            </span>
          }
        />
        <ErrorLine message={error()} />
        <For each={live()}>{event => <LiveEvent event={event} />}</For>
        <Show when={rest().length > 0}>
          <EventTable title='Your events' events={rest()} />
        </Show>
      </Match>
      <Match when={stage().kind !== 'lists'}>
        <EventSetup
          mode={stage().kind === 'tom' ? 'tom' : 'swiss'}
          tdfName={(stage() as Extract<Stage, { kind: 'tom' }>).tournament?.info.name}
          tdfSanctioned={Boolean((stage() as Extract<Stage, { kind: 'tom' }>).tournament?.info.sanctionId)}
          busy={busy()}
          error={error()}
          onCreate={setup => void create(setup)}
          onCancel={() => {
            setStage({ kind: 'lists' });
            setError(null);
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
          <Show when={s().user} fallback={<HostHome providers={s().providers} />}>
            <Organizer onOpened={code => navigate(`/host/${code}`)} />
          </Show>
        )}
      </Show>
    </div>
  );
}
