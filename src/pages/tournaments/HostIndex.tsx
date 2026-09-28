/**
 * /host: the events an organizer runs or staffs, and the two ways to start
 * one. A Swiss event is run entirely on the site. A TOM event starts from the
 * .tdf TOM saves to, on desktop where TOM runs; on a browser that can hold a
 * file, the file stays linked so later saves reach the site without another
 * upload. Either way the setup (EventSetup) asks the rest.
 */

import { A, useNavigate } from '@solidjs/router';
import { createResource, createSignal, For, Match, onMount, Show, Switch } from 'solid-js';
import { parseTomDate } from '../../../shared/tournament/divisions';
import { parseTdf } from '../../../shared/tournament/tdf';
import type { Tournament } from '../../../shared/tournament/types';
import { createFromTdf, createSwiss, listTournaments, type TournamentSummary } from '../../lib/tournament/api';
import { session } from './session';
import { canLinkFiles, pickTdf, rememberHandle, type TdfHandle } from '../../lib/tournament/tomLink';
import { latestValue } from '../../lib/resource';
import { EventSetup, type Setup } from './EventSetup';
import { ErrorLine } from './Field';
import { SignIn } from './SignIn';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

const shortDate = (startDate: string) =>
  parseTomDate(startDate)?.toLocaleDateString(undefined, { dateStyle: 'medium', timeZone: 'UTC' }) ?? '';

function EventList(props: { events: readonly TournamentSummary[] }) {
  return (
    <div class='table-wrap'>
      <table class='data'>
        <thead>
          <tr>
            <th>Event</th>
            <th>Date</th>
            <th>Run in</th>
            <th class='num'>Players</th>
            <th>Status</th>
            <th>
              <span class='sr-only'>Public page</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <For each={props.events}>
            {event => (
              <tr>
                <td>
                  <A href={`/host/${event.code}`}>{event.name || event.code}</A>
                  <Show when={event.role === 'staff'}>
                    <span class='muted-cell tm-flag'>Staff</span>
                  </Show>
                </td>
                <td class='muted-cell tm-nowrap'>{shortDate(event.startDate)}</td>
                <td class='muted-cell'>{event.mode === 'tom' ? 'TOM' : 'Swiss'}</td>
                <td class='num'>{event.players}</td>
                <td class='muted-cell'>{event.finished ? 'Finished' : 'Open'}</td>
                <td class='tm-extra-col'>
                  <A href={`/t/${event.code}`}>Public page</A>
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}

type Stage = { kind: 'choose' } | { kind: 'swiss' } | { kind: 'tom'; tournament: Tournament; handle: TdfHandle | null };

/**
 * Picking up a .tdf: the file is read and parsed first, so the setup only
 * opens once it is known to be a tournament. Desktop only, where TOM runs.
 */
function LinkTdf(props: {
  busy: boolean;
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
        <label class='btn btn-secondary tm-desktop-only'>
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
      <button type='button' class='btn btn-secondary tm-desktop-only' disabled={props.busy} onClick={() => void link()}>
        Link .tdf file
      </button>
    </Show>
  );
}

/** Start an event, or on desktop follow one run in TOM; either way the setup asks the rest. */
function StartEvent(props: { onCreated: (code: string) => void }) {
  const [stage, setStage] = createSignal<Stage>({ kind: 'choose' });
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const back = () => {
    setStage({ kind: 'choose' });
    setError(null);
  };

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
        props.onCreated(code);
      } else {
        props.onCreated((await createSwiss(setup)).code);
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Switch>
      <Match when={stage().kind === 'choose'}>
        <div class='tm-actions'>
          <button type='button' class='btn btn-primary' onClick={() => setStage({ kind: 'swiss' })}>
            Start an event
          </button>
          <LinkTdf
            busy={busy()}
            onRead={(tournament, handle) => {
              setError(null);
              setStage({ kind: 'tom', tournament, handle });
            }}
            onError={setError}
          />
        </div>
        <ErrorLine message={error()} />
      </Match>
      <Match when={stage().kind !== 'choose'}>
        <EventSetup
          mode={stage().kind === 'tom' ? 'tom' : 'swiss'}
          tdfName={(stage() as Extract<Stage, { kind: 'tom' }>).tournament?.info.name}
          busy={busy()}
          error={error()}
          onCreate={setup => void create(setup)}
          onCancel={back}
        />
      </Match>
    </Switch>
  );
}

export function HostIndex() {
  const navigate = useNavigate();
  const user = () => latestValue(session)?.user;
  const [events] = createResource(user, () => listTournaments().then(result => result.tournaments));
  const opened = (code: string) => navigate(`/host/${code}`);
  onMount(() => {
    document.title = 'Run an event — Ciphermaniac';
  });
  return (
    <div class='tm-page'>
      <section class='hero'>
        <h1>Run an event</h1>
      </section>
      <Show
        when={user()}
        fallback={<Show when={latestValue(session)}>{s => <SignIn providers={s().providers} next='/host' />}</Show>}
      >
        <Show when={latestValue(events)?.length}>
          <section class='tm-section-block'>
            <h2 class='tm-subhead'>Your events</h2>
            <EventList events={latestValue(events) ?? []} />
          </section>
        </Show>
        <section class='tm-section-block'>
          <h2 class='tm-subhead'>Start an event</h2>
          <StartEvent onCreated={opened} />
        </section>
      </Show>
    </div>
  );
}
