/**
 * /host: the events an organizer runs or staffs, and the two ways to start
 * one. A Swiss event is run entirely on the site. A TOM event starts from the
 * .tdf TOM saves to; on a browser that can hold a file, the file stays linked
 * so later saves reach the site without another upload.
 */

import { A, useNavigate } from '@solidjs/router';
import { createResource, createSignal, For, onMount, Show } from 'solid-js';
import { parseTdf } from '../../../shared/tournament/tdf';
import { createFromTdf, createSwiss, listTournaments, type TournamentSummary } from '../../lib/tournament/api';
import { session } from './session';
import { canLinkFiles, pickTdf, rememberHandle, type TdfHandle } from '../../lib/tournament/tomLink';
import { latestValue } from '../../lib/resource';
import { ErrorLine, Field } from './Field';
import { SignIn } from './SignIn';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

function EventList(props: { events: readonly TournamentSummary[] }) {
  return (
    <div class='table-wrap'>
      <table class='data'>
        <thead>
          <tr>
            <th>Event</th>
            <th>Run in</th>
            <th class='num'>Players</th>
            <th>Role</th>
          </tr>
        </thead>
        <tbody>
          <For each={props.events}>
            {event => (
              <tr>
                <td>
                  <A href={`/host/${event.code}`}>{event.name || event.code}</A>
                </td>
                <td>{event.mode === 'tom' ? 'TOM' : 'Swiss on this site'}</td>
                <td class='num'>{event.players}</td>
                <td class='muted-cell'>{event.role === 'owner' ? 'Organizer' : 'Staff'}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}

function NewSwiss(props: { onCreated: (code: string) => void }) {
  const [name, setName] = createSignal('');
  const [combined, setCombined] = createSignal(true);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  async function submit(event: Event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      props.onCreated((await createSwiss(name(), combined())).code);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form class='tm-form' onSubmit={event => void submit(event)}>
      <h2>Run Swiss on this site</h2>
      <Field id='new-name' label='Event name'>
        <input
          id='new-name'
          class='tm-input'
          maxLength={120}
          value={name()}
          onInput={e => setName(e.currentTarget.value)}
        />
      </Field>
      <label class='tm-check'>
        <input type='checkbox' checked={combined()} onChange={e => setCombined(e.currentTarget.checked)} />
        <span>Pair all age divisions together</span>
      </label>
      <div class='tm-actions'>
        <button type='submit' class='btn btn-primary' disabled={busy() || !name().trim()}>
          Create event
        </button>
      </div>
      <ErrorLine message={error()} />
    </form>
  );
}

function ImportTom(props: { onCreated: (code: string) => void }) {
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  async function start(text: string, handle: TdfHandle | null) {
    setBusy(true);
    setError(null);
    try {
      const { code } = await createFromTdf(parseTdf(text));
      if (handle) {
        await rememberHandle(code, handle);
      }
      props.onCreated(code);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function startFromFile(file: File) {
    await start(await file.text(), null);
  }

  async function link() {
    try {
      const handle = await pickTdf();
      await start(await (await handle.getFile()).text(), handle);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setError(errorText(err));
      }
    }
  }

  return (
    <div class='tm-form'>
      <h2>Follow an event run in TOM</h2>
      <div class='tm-actions'>
        <Show
          when={canLinkFiles()}
          fallback={
            <label class='btn btn-secondary'>
              Choose .tdf file
              <input
                type='file'
                accept='.tdf'
                class='sr-only'
                disabled={busy()}
                onChange={e => {
                  const file = e.currentTarget.files?.[0];
                  if (file) {
                    void startFromFile(file);
                  }
                }}
              />
            </label>
          }
        >
          <button type='button' class='btn btn-secondary' disabled={busy()} onClick={() => void link()}>
            Link .tdf file
          </button>
        </Show>
      </div>
      <ErrorLine message={error()} />
    </div>
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
    <>
      <section class='hero'>
        <h1>Run an event</h1>
      </section>
      <Show
        when={user()}
        fallback={<Show when={latestValue(session)}>{s => <SignIn providers={s().providers} next='/host' />}</Show>}
      >
        <div class='tm-columns'>
          <NewSwiss onCreated={opened} />
          <ImportTom onCreated={opened} />
        </div>
        <Show when={latestValue(events)?.length}>
          <section class='tm-section'>
            <h2>Your events</h2>
            <EventList events={latestValue(events) ?? []} />
          </section>
        </Show>
      </Show>
    </>
  );
}
