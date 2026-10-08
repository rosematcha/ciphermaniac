/**
 * My data, at the bottom of Settings: export what the site keeps on the
 * account as a Markdown file, wipe parts of it, or delete the account. Each
 * opens a dialog. Export and wipe both choose from the parts in
 * shared/accounts/myData.ts; a wipe is chosen, then reviewed with what
 * follows from it, before it goes. Deleting asks for the username typed out.
 * A wipe of organizer history or a deletion that must wait says why, with the
 * events still running and the stores still owned.
 */

import { useNavigate } from '@solidjs/router';
import { createSignal, For, Show } from 'solid-js';
import {
  type DataRefusal,
  EXPORT_PARTS,
  type ExportPart,
  WIPE_PARTS,
  type WipePart
} from '../../../shared/accounts/myData';
import { ApiError, deleteAccount, errorText, exportData, type Me, wipeData } from '../../lib/tournament/api';
import { ErrorLine } from './Field';
import { Modal } from './Modal';
import { refreshSession } from './session';
import { SettingRow } from './SettingControls';
import '../../styles/pages/tournament-store-apply.css';
import '../../styles/pages/tournament-my-data.css';

/** Each part's name and what it holds. */
const PARTS: Record<ExportPart, { name: string; what: string }> = {
  profile: { name: 'Profile', what: 'First and last name, POP ID, birth year' },
  username: { name: 'Username', what: 'Your username, and any you changed from today' },
  events: { name: 'Event history', what: 'The ended events you played in, and which players you were there' },
  organizer: { name: 'Organizer history', what: 'The events you ran or staffed' },
  account: { name: 'Account', what: 'Email, sign-ins, sessions, Applications, stores, badges' }
};

/** What follows from wiping each part. Draft wording, awaiting Reese's copy. */
const AFTER: Record<WipePart, string[]> = {
  profile: [
    'Decklists and “find my table” stop filling themselves in',
    'Sanctioned events leave your history until you add your POP ID again',
    'You can’t apply to organize until the profile is filled in'
  ],
  username: [
    'You get a random username',
    'Your old usernames are free for anyone right away',
    'Links to your public profile stop working'
  ],
  events: [
    'Ended events leave your history; events still running and ones you play later stay',
    'Organizers keep their own records of the event'
  ],
  organizer: [
    'Your name comes off those events; players keep them in their histories',
    'You can no longer open or edit them',
    'Waits until every event you run has ended'
  ]
};

/** What deleting costs. Draft wording, awaiting Reese's copy. */
const DELETE_AFTER = [
  'Everything above is wiped, and your sign-ins and sessions go',
  'Events you ran stay for their players, without your name',
  'Waits until your events have ended and any store you own is handed over'
];

/** The refusal a 409 carries, or null for any other failure. */
const refusalOf = (err: unknown): DataRefusal | null =>
  err instanceof ApiError && err.status === 409 ? (err.body as unknown as DataRefusal) : null;

/** Why a wipe or deletion failed, with what holds it up when it must wait. */
function Failure(props: { error: unknown }) {
  const refusal = () => refusalOf(props.error);
  const holding = () => [
    ...(refusal()?.running.map(event => event.name || event.code) ?? []),
    ...(refusal()?.ownedStores ?? [])
  ];
  return (
    <Show when={props.error}>
      <div class='tm-box-bar tm-modal-body'>
        <ErrorLine message={errorText(props.error)} />
        <Show when={holding().length > 0}>
          <ul class='tm-consequences'>
            <For each={holding()}>{name => <li>{name}</li>}</For>
          </ul>
        </Show>
      </div>
    </Show>
  );
}

/** Checkbox rows for the parts given, ticked as `chosen` says. */
function PartChoices<P extends ExportPart>(props: {
  parts: readonly P[];
  chosen: ReadonlySet<P>;
  onToggle: (part: P) => void;
}) {
  return (
    <For each={props.parts}>
      {part => (
        <label class='tm-choice' classList={{ 'is-on': props.chosen.has(part) }}>
          <input type='checkbox' checked={props.chosen.has(part)} onChange={() => props.onToggle(part)} />
          <span class='tm-choice-text'>
            <strong>{PARTS[part].name}</strong>
            <span>{PARTS[part].what}</span>
          </span>
        </label>
      )}
    </For>
  );
}

/** A set with `part` flipped. */
function toggled<P>(set: ReadonlySet<P>, part: P): Set<P> {
  const next = new Set(set);
  if (!next.delete(part)) {
    next.add(part);
  }
  return next;
}

/** Saves a file the browser was handed, as a download. */
function save(file: Blob, name: string) {
  const url = URL.createObjectURL(file);
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ExportDialog(props: { open: boolean; onClose: () => void }) {
  const [chosen, setChosen] = createSignal<ReadonlySet<ExportPart>>(new Set(EXPORT_PARTS));
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  function close() {
    setError(null);
    props.onClose();
  }
  async function download() {
    setBusy(true);
    setError(null);
    try {
      const { file, name } = await exportData(EXPORT_PARTS.filter(part => chosen().has(part)));
      save(file, name);
      close();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={props.open} title='Export data' onClose={close}>
      <PartChoices parts={EXPORT_PARTS} chosen={chosen()} onToggle={part => setChosen(toggled(chosen(), part))} />
      <Show when={error()}>
        <div class='tm-box-bar'>
          <ErrorLine message={error()} />
        </div>
      </Show>
      <div class='tm-box-bar tm-modal-foot'>
        <button type='button' class='btn btn-ghost' onClick={close}>
          Cancel
        </button>
        <button
          type='button'
          class='btn btn-primary'
          disabled={chosen().size === 0 || busy()}
          onClick={() => void download()}
        >
          {chosen().size === EXPORT_PARTS.length ? 'Download all' : 'Download'}
        </button>
      </div>
    </Modal>
  );
}

function WipeDialog(props: { open: boolean; onClose: () => void; onWiped: (user: Me) => void }) {
  const [chosen, setChosen] = createSignal<ReadonlySet<WipePart>>(new Set());
  const [reviewing, setReviewing] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<unknown>(null);
  const parts = () => WIPE_PARTS.filter(part => chosen().has(part));
  function close() {
    setChosen(new Set<WipePart>());
    setReviewing(false);
    setError(null);
    props.onClose();
  }
  async function wipe() {
    setBusy(true);
    setError(null);
    try {
      props.onWiped((await wipeData(parts())).user);
      close();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={props.open} title='Wipe data' onClose={close}>
      <div class='tm-box-bar'>
        <span class='tm-modal-steps'>
          <Show
            when={reviewing()}
            fallback={
              <>
                <b>1 Choose</b> · 2 Review
              </>
            }
          >
            1 Choose · <b>2 Review</b>
          </Show>
        </span>
      </div>
      <Show
        when={reviewing()}
        fallback={
          <>
            <PartChoices parts={WIPE_PARTS} chosen={chosen()} onToggle={part => setChosen(toggled(chosen(), part))} />
            <div class='tm-box-bar tm-modal-foot'>
              <button type='button' class='btn btn-ghost' onClick={close}>
                Cancel
              </button>
              <button
                type='button'
                class='btn btn-primary'
                disabled={chosen().size === 0}
                onClick={() => setReviewing(true)}
              >
                Review
              </button>
            </div>
          </>
        }
      >
        <div class='tm-box-bar tm-modal-body'>
          <ul class='tm-consequences'>
            <For each={parts().flatMap(part => AFTER[part])}>{line => <li>{line}</li>}</For>
          </ul>
        </div>
        <Failure error={error()} />
        <div class='tm-box-bar tm-modal-foot'>
          <button type='button' class='btn btn-ghost' onClick={() => setReviewing(false)}>
            Back
          </button>
          <button type='button' class='btn btn-secondary tm-danger' disabled={busy()} onClick={() => void wipe()}>
            {parts().length === WIPE_PARTS.length ? 'Wipe all' : `Wipe ${parts().length}`}
          </button>
        </div>
      </Show>
    </Modal>
  );
}

function DeleteDialog(props: { open: boolean; handle: string; onClose: () => void }) {
  const navigate = useNavigate();
  const [typed, setTyped] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<unknown>(null);
  function close() {
    setTyped('');
    setError(null);
    props.onClose();
  }
  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await deleteAccount(typed());
      await refreshSession();
      navigate('/');
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }
  return (
    <Modal open={props.open} title='Delete your account?' class='tm-modal-delete' onClose={close}>
      <div class='tm-box-bar tm-modal-body'>
        <ul class='tm-consequences'>
          <For each={DELETE_AFTER}>{line => <li>{line}</li>}</For>
        </ul>
        <label class='tm-field'>
          <span class='tm-label'>
            Type <strong>{props.handle}</strong> to confirm
          </span>
          <input
            class='tm-input'
            autocomplete='off'
            autocapitalize='none'
            spellcheck={false}
            value={typed()}
            onInput={event => setTyped(event.currentTarget.value)}
          />
        </label>
      </div>
      <Failure error={error()} />
      <div class='tm-box-bar tm-modal-foot'>
        <button type='button' class='btn btn-ghost' onClick={close}>
          Cancel
        </button>
        <button
          type='button'
          class='btn btn-secondary tm-danger'
          disabled={typed() !== props.handle || busy()}
          onClick={() => void remove()}
        >
          Delete account
        </button>
      </div>
    </Modal>
  );
}

type Open = 'export' | 'wipe' | 'delete' | null;

export function MyData(props: { user: Me; onWiped: (user: Me) => void }) {
  const [open, setOpen] = createSignal<Open>(null);
  const close = () => setOpen(null);
  return (
    <section>
      <h2 class='tm-subhead tm-box-head'>My data</h2>
      <div class='tm-box'>
        <SettingRow label='Export'>
          <button type='button' class='btn btn-secondary' onClick={() => setOpen('export')}>
            Export data
          </button>
        </SettingRow>
        <SettingRow label='Wipe data'>
          <button type='button' class='btn btn-secondary' onClick={() => setOpen('wipe')}>
            Wipe data
          </button>
        </SettingRow>
        <SettingRow label='Delete account'>
          <button type='button' class='btn btn-secondary tm-danger' onClick={() => setOpen('delete')}>
            Delete account
          </button>
        </SettingRow>
      </div>
      <ExportDialog open={open() === 'export'} onClose={close} />
      <WipeDialog open={open() === 'wipe'} onClose={close} onWiped={user => props.onWiped(user)} />
      <DeleteDialog open={open() === 'delete'} handle={props.user.handle} onClose={close} />
    </section>
  );
}
