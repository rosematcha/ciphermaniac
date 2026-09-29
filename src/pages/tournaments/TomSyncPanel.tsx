/**
 * The link between a TOM-run event and the file TOM saves to.
 *
 * Once linked, the page reads the file whenever TOM saves it and sends the
 * parsed event up if anything changed; nobody uploads anything. Refresh reads
 * it again on demand. Results entered on the site wait here until they are
 * written into the file, which TOM then has to reopen (see
 * lib/tournament/tomLink.ts for why), so writing asks first with TOM's own
 * instruction. After a reload the browser may need permission again; until
 * it has it, the console holds off result entry, since the site can no
 * longer see what TOM has.
 *
 * The link's state lives in createTomLink, shared by the file strip under the
 * console's tabs (TomStrip), the console's next step and the round panel.
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

/** 'none' before a file is linked (or on a browser that cannot hold one), 'reconnect' when permission lapsed. */
export type LinkState = 'none' | 'reconnect' | 'watching';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export const readTime = (at: Date) =>
  at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });

export function createTomLink(props: { manage: () => Manage; onSynced: () => Promise<void> }) {
  const [handle, setHandle] = createSignal<TdfHandle | null>(null);
  const [state, setState] = createSignal<LinkState>('none');
  const [readAt, setReadAt] = createSignal<Date | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [askingWrite, setAskingWrite] = createSignal(false);
  let lastModified = 0;
  let lastSent = '';
  let reading = false;
  /** What asked to write, for focus to return to if the organizer keeps the file as it is. */
  let opener: HTMLElement | null = null;
  const code = () => props.manage().code;

  /** Sends the parsed file if it differs from what was last sent. */
  async function push(text: string) {
    const parsed = parseTdf(text);
    const json = JSON.stringify(parsed);
    if (json !== lastSent) {
      await syncTournament(code(), parsed);
      lastSent = json;
      await props.onSynced();
    }
    setReadAt(new Date());
  }

  async function tick(force = false) {
    const current = handle();
    if (!current || state() !== 'watching' || reading) {
      return;
    }
    reading = true;
    try {
      const read = await readIfChanged(current, force ? 0 : lastModified);
      if (read) {
        await push(read.text);
        ({ lastModified } = read);
        setError(null);
      } else {
        setReadAt(new Date());
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
    setState(granted ? 'watching' : 'reconnect');
    if (granted) {
      await tick();
    }
  }

  onMount(() => {
    const timer = setInterval(() => void tick(), POLL_MS);
    onCleanup(() => clearInterval(timer));
    void (async () => {
      const remembered = canLinkFiles() ? await recallHandle(code()) : null;
      if (remembered) {
        await watch(remembered, false);
      }
    })();
  });

  async function link() {
    try {
      const picked = await pickTdf();
      await rememberHandle(code(), picked);
      lastModified = 0;
      await watch(picked, true);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setError(errorText(err));
      }
    }
  }

  async function unlink() {
    await forgetHandle(code());
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

  const exported = (tournament: Tournament) =>
    tdfText({ tournament, pending: props.manage().pending, finished: false });

  /**
   * Writes the results into TOM's file as it is now, not as the site last saw
   * it: TOM may have saved since, and its newer rounds must survive the write.
   * Without a linked file, the results go out as a download to open in TOM.
   */
  async function writeBack() {
    setAskingWrite(false);
    const current = handle();
    try {
      if (current && state() === 'watching' && (await ensurePermission(current, 'readwrite', true))) {
        const text = await (await current.getFile()).text();
        await push(text);
        await writeFile(current, exported(parseTdf(text)));
        await tick();
        return;
      }
      const text = exported(props.manage().tournament);
      downloadBlob(new Blob([text], { type: 'application/xml' }), tdfFilename(props.manage().tournament));
    } catch (err) {
      setError(errorText(err));
    }
  }

  return {
    state,
    fileName: () => handle()?.name ?? '',
    readAt,
    error,
    askingWrite,
    pending: () => props.manage().pending.length,
    /** Results can't be entered while the site can't see the file TOM keeps. */
    locked: () => state() === 'reconnect',
    refresh: () => tick(true),
    reconnect: () => {
      const current = handle();
      return current ? watch(current, true) : Promise.resolve();
    },
    link,
    unlink,
    upload,
    askWrite: () => {
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setAskingWrite(true);
    },
    /** Backs out of writing, and puts focus back on what asked. */
    keepWrite: () => {
      setAskingWrite(false);
      opener?.focus();
    },
    writeBack
  };
}

export type TomLink = ReturnType<typeof createTomLink>;

const results = (n: number) => `${n} result${n === 1 ? '' : 's'}`;

/** The file's name and where it stands, as one data-built line. */
function FileLine(props: { link: TomLink }) {
  const read = () => {
    const at = props.link.readAt();
    return at ? ` · read ${readTime(at)}` : '';
  };
  return (
    <span class='tm-file-line'>
      <Show when={props.link.fileName()} fallback={<strong>No .tdf linked</strong>}>
        <strong>{props.link.fileName()}</strong>
      </Show>
      <Show
        when={props.link.state() !== 'reconnect'}
        fallback={<span class='muted'> · reconnect to read it and enter results</span>}
      >
        <span class='muted'>{read()} · </span>
        {props.link.pending() ? `${results(props.link.pending())} not in TOM yet` : 'TOM has every result'}
      </Show>
    </span>
  );
}

function UploadButton(props: { link: TomLink; label: string; class: string }) {
  return (
    <label class={props.class}>
      {props.label}
      <input
        type='file'
        accept='.tdf'
        class='sr-only'
        onChange={e => {
          const input = e.currentTarget;
          const file = input.files?.[0];
          if (file) {
            void props.link.upload(file);
          }
          input.value = '';
        }}
      />
    </label>
  );
}

/** Upload another file or unlink this one: rarer than a refresh, so they wait under More. */
function More(props: { link: TomLink }) {
  const [open, setOpen] = createSignal(false);
  return (
    <span class='tm-more'>
      <button type='button' class='btn btn-ghost tm-small' aria-expanded={open()} onClick={() => setOpen(!open())}>
        More
      </button>
      <Show when={open()}>
        <span class='tm-menu' role='menu'>
          <UploadButton link={props.link} label='Upload a .tdf instead' class='tm-menu-item' />
          <button
            type='button'
            class='tm-menu-item'
            role='menuitem'
            onClick={() => {
              setOpen(false);
              void props.link.unlink();
            }}
          >
            Unlink file
          </button>
        </span>
      </Show>
    </span>
  );
}

/**
 * The strip under the console's tabs for a TOM event: the file and where it
 * stands, then Refresh .tdf (or the way to link or upload one), and the
 * question a write asks, with TOM's instruction, when the console's next step
 * is writing results back.
 */
export function TomStrip(props: { link: TomLink }) {
  const link = () => props.link;
  return (
    <section class='tm-strip tm-tom-strip' aria-label='TOM file'>
      <FileLine link={link()} />
      <span class='tm-grow' />
      <Show when={link().state() === 'watching'}>
        <button type='button' class='btn btn-secondary tm-small' onClick={() => void link().refresh()}>
          Refresh .tdf
        </button>
        <More link={link()} />
      </Show>
      <Show when={link().state() === 'none'}>
        <Show when={canLinkFiles()}>
          <button type='button' class='btn btn-secondary tm-small' onClick={() => void link().link()}>
            Link .tdf file
          </button>
        </Show>
        <UploadButton link={link()} label='Upload .tdf' class='btn btn-secondary tm-small' />
      </Show>
      <Show when={link().askingWrite()}>
        <span
          class='tm-ask tm-ask-line'
          role='group'
          aria-label='Write results to the .tdf'
          onKeyDown={event => {
            if (event.key === 'Escape') {
              link().keepWrite();
            }
          }}
        >
          <span class='tm-confirm-label'>Close the event in TOM before writing, then reopen the file in TOM.</span>
          <button
            type='button'
            class='btn btn-primary tm-small'
            ref={el => queueMicrotask(() => el.focus())}
            onClick={() => void link().writeBack()}
          >
            Write {results(link().pending())}
          </button>
          <button type='button' class='btn btn-ghost tm-small' onClick={() => link().keepWrite()}>
            Keep
          </button>
        </span>
      </Show>
      <ErrorLine message={link().error()} />
    </section>
  );
}

/**
 * The console's next step for a TOM event: reconnect the file, write the
 * results TOM does not have yet (asked first, in the strip, when the file is
 * linked; a download otherwise), or read the file again.
 */
export function TomNextStep(props: { link: TomLink }) {
  const link = () => props.link;
  return (
    <Show
      when={link().state() !== 'reconnect'}
      fallback={
        <button type='button' class='btn btn-primary' onClick={() => void link().reconnect()}>
          Reconnect {link().fileName()}
        </button>
      }
    >
      <Show
        when={link().pending() > 0}
        fallback={
          <Show when={link().state() === 'watching'}>
            <button type='button' class='btn btn-secondary' onClick={() => void link().refresh()}>
              Refresh .tdf
            </button>
          </Show>
        }
      >
        <button
          type='button'
          class='btn btn-primary'
          onClick={() => (link().state() === 'watching' ? link().askWrite() : void link().writeBack())}
        >
          {link().state() === 'watching' ? 'Write' : 'Download'} {results(link().pending())} to .tdf
        </button>
      </Show>
    </Show>
  );
}
