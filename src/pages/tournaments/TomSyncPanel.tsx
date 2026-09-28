/**
 * The link between a TOM-run event and the file TOM saves to.
 *
 * Once linked, the page reads the file whenever TOM saves it and sends the
 * parsed event up if anything changed; nobody uploads anything. Results
 * entered on the site wait here until they are written into the file, which
 * TOM then has to reopen (see lib/tournament/tomLink.ts for why).
 */

import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { parseTdf } from '../../../shared/tournament/tdf';
import type { Tournament } from '../../../shared/tournament/types';
import { type Manage, syncTournament } from '../../lib/tournament/api';
import { tdfFilename, tdfText } from '../../lib/tournament/exportTdf';
import {
  canLinkFiles,
  ensurePermission,
  forgetHandle,
  pickTdf,
  readIfChanged,
  recallHandle,
  rememberHandle,
  type TdfHandle,
  writeFile
} from '../../lib/tournament/tomLink';
import { downloadBlob } from '../../lib/download';
import { ErrorLine } from './Field';

const POLL_MS = 2000;

type LinkState = 'none' | 'needs-permission' | 'watching';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function TomSyncPanel(props: { manage: Manage; onSynced: () => Promise<void> }) {
  const [handle, setHandle] = createSignal<TdfHandle | null>(null);
  const [state, setState] = createSignal<LinkState>('none');
  const [syncedAt, setSyncedAt] = createSignal<Date | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  let lastModified = 0;
  let lastSent = '';
  let reading = false;

  /** Sends the parsed file if it differs from what was last sent. */
  async function push(text: string) {
    const parsed = parseTdf(text);
    const json = JSON.stringify(parsed);
    if (json !== lastSent) {
      await syncTournament(props.manage.code, parsed);
      lastSent = json;
      await props.onSynced();
    }
    setSyncedAt(new Date());
  }

  async function tick() {
    const current = handle();
    if (!current || state() !== 'watching' || reading) {
      return;
    }
    reading = true;
    try {
      const read = await readIfChanged(current, lastModified);
      if (read) {
        await push(read.text);
        ({ lastModified } = read);
        setError(null);
      }
    } catch (err) {
      // TOM may be halfway through a save; the next look reads the finished file.
      setError(errorText(err));
    } finally {
      reading = false;
    }
  }

  async function watch(next: TdfHandle, ask: boolean) {
    setHandle(next);
    const granted = await ensurePermission(next, 'read', ask);
    setState(granted ? 'watching' : 'needs-permission');
    if (granted) {
      await tick();
    }
  }

  async function restore() {
    const remembered = canLinkFiles() ? await recallHandle(props.manage.code) : null;
    if (remembered) {
      await watch(remembered, false);
    }
  }

  onMount(() => {
    const timer = setInterval(() => void tick(), POLL_MS);
    onCleanup(() => clearInterval(timer));
    void restore();
  });

  async function link() {
    try {
      const picked = await pickTdf();
      await rememberHandle(props.manage.code, picked);
      lastModified = 0;
      await watch(picked, true);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setError(errorText(err));
      }
    }
  }

  async function unlink() {
    await forgetHandle(props.manage.code);
    setHandle(null);
    setState('none');
  }

  async function upload(file: File) {
    try {
      await push(await file.text());
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }

  const exported = (tournament: Tournament) => tdfText({ tournament, pending: props.manage.pending, finished: false });

  /**
   * Writes the results into TOM's file as it is now, not as the site last saw
   * it: TOM may have saved since, and its newer rounds must survive the write.
   */
  async function writeLinked(current: TdfHandle) {
    const text = await (await current.getFile()).text();
    await push(text);
    await writeFile(current, exported(parseTdf(text)));
    await tick();
  }

  async function writeBack() {
    const current = handle();
    try {
      if (current && (await ensurePermission(current, 'readwrite', true))) {
        await writeLinked(current);
        return;
      }
      const text = exported(props.manage.tournament);
      downloadBlob(new Blob([text], { type: 'application/xml' }), tdfFilename(props.manage.tournament));
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <section class='tm-sync' aria-label='TOM file'>
      <div class='tm-toolbar'>
        <Show when={state() === 'watching'}>
          <span class='tm-live-dot' aria-hidden='true' />
          <span>
            Following <strong>{handle()?.name}</strong>
            <Show when={syncedAt()}>{at => <span class='muted'> · checked {at().toLocaleTimeString()}</span>}</Show>
          </span>
          <button type='button' class='btn btn-ghost tm-small' onClick={() => void unlink()}>
            Unlink
          </button>
        </Show>
        <Show when={state() === 'needs-permission'}>
          <button type='button' class='btn btn-primary' onClick={() => void watch(handle() as TdfHandle, true)}>
            Reconnect {handle()?.name}
          </button>
        </Show>
        <Show when={state() === 'none' && canLinkFiles()}>
          <button type='button' class='btn btn-primary' onClick={() => void link()}>
            Link .tdf file
          </button>
        </Show>
        <label class='btn btn-secondary'>
          Upload .tdf
          <input
            type='file'
            accept='.tdf'
            class='sr-only'
            onChange={e => {
              const input = e.currentTarget;
              const file = input.files?.[0];
              if (file) {
                void upload(file);
              }
              input.value = '';
            }}
          />
        </label>
        <Show when={props.manage.pending.length > 0}>
          <button type='button' class='btn btn-secondary' onClick={() => void writeBack()}>
            {state() === 'watching' ? 'Write' : 'Download'} {props.manage.pending.length} result
            {props.manage.pending.length === 1 ? '' : 's'} to .tdf
          </button>
        </Show>
      </div>
      <Show when={props.manage.pending.length > 0 && state() === 'watching'}>
        <p class='tm-note'>Close the event in TOM before writing, then reopen the file in TOM.</p>
      </Show>
      <ErrorLine message={error()} />
    </section>
  );
}
