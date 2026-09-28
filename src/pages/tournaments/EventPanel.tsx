/**
 * The console's event tab: details players see, round times, deck
 * visibility, staff invites, the .tdf export, and closing or deleting the event.
 */

import { useNavigate } from '@solidjs/router';
import { createSignal, For, Show } from 'solid-js';
import { type DeckVisibility, SETTINGS_LIMITS, type TournamentSettings } from '../../../shared/tournament/view';
import { deleteTournament, type Manage, rotateStaffToken, saveSettings } from '../../lib/tournament/api';
import { tdfFilename, tdfText } from '../../lib/tournament/exportTdf';
import { downloadBlob } from '../../lib/download';
import { ErrorLine, Field } from './Field';
import type { ManageState } from './manageState';

const VISIBILITY_LABELS: Record<DeckVisibility, string> = {
  always: 'Always',
  after: 'After the event ends',
  never: 'Never'
};

function SettingsForm(props: { state: ManageState; manage: Manage }) {
  // eslint-disable-next-line solid/reactivity -- the form edits a copy taken when it opens; saving replaces the event
  const [draft, setDraft] = createSignal<TournamentSettings>({ ...props.manage.settings });
  const set = <K extends keyof TournamentSettings>(key: K, value: TournamentSettings[K]) =>
    setDraft({ ...draft(), [key]: value });
  function save(event: Event) {
    event.preventDefault();
    const { code } = props.manage;
    const { details, format, startsAt, deckVisibility } = draft();
    void props.state.run(() => saveSettings(code, { details, format, startsAt, deckVisibility }));
  }
  return (
    <form class='tm-form' onSubmit={save}>
      <div class='tm-grid-fields'>
        <Field id='set-start' label='Starts'>
          <input
            id='set-start'
            class='tm-input'
            type='datetime-local'
            value={draft().startsAt}
            onInput={e => set('startsAt', e.currentTarget.value)}
          />
        </Field>
        <Field id='set-format' label='Format'>
          <input
            id='set-format'
            class='tm-input'
            maxLength={SETTINGS_LIMITS.format}
            value={draft().format}
            onInput={e => set('format', e.currentTarget.value)}
          />
        </Field>
        <Field id='set-decks' label='Show decks publicly'>
          <select
            id='set-decks'
            class='tm-input'
            onChange={e => set('deckVisibility', e.currentTarget.value as DeckVisibility)}
          >
            <For each={Object.entries(VISIBILITY_LABELS)}>
              {([value, label]) => (
                <option value={value} selected={draft().deckVisibility === value}>
                  {label}
                </option>
              )}
            </For>
          </select>
        </Field>
      </div>
      <Field id='set-details' label='Details for players'>
        <textarea
          id='set-details'
          class='tm-input tm-textarea'
          maxLength={SETTINGS_LIMITS.details}
          value={draft().details}
          onInput={e => set('details', e.currentTarget.value)}
        />
      </Field>
      <div class='tm-actions'>
        <button type='submit' class='btn btn-primary' disabled={props.state.busy()}>
          Save
        </button>
      </div>
    </form>
  );
}

function RoundTimes(props: { state: ManageState; manage: Manage }) {
  const info = () => props.manage.tournament.info;
  const [name, setName] = createSignal(info().name);
  const [roundTime, setRoundTime] = createSignal(info().roundTime);
  const [finals, setFinals] = createSignal(info().finalsRoundTime);
  const save = (event: Event) => {
    event.preventDefault();
    void props.state.send({
      type: 'updateInfo',
      info: { name: name(), roundTime: roundTime(), finalsRoundTime: finals() }
    });
  };
  return (
    <form class='tm-form' onSubmit={save}>
      <div class='tm-grid-fields'>
        <Field id='info-name' label='Event name'>
          <input id='info-name' class='tm-input' value={name()} onInput={e => setName(e.currentTarget.value)} />
        </Field>
        <Field id='info-round' label='Round minutes'>
          <input
            id='info-round'
            class='tm-input'
            type='number'
            min='1'
            max='180'
            value={roundTime()}
            onInput={e => setRoundTime(Number(e.currentTarget.value))}
          />
        </Field>
        <Field id='info-finals' label='Top cut round minutes'>
          <input
            id='info-finals'
            class='tm-input'
            type='number'
            min='1'
            max='180'
            value={finals()}
            onInput={e => setFinals(Number(e.currentTarget.value))}
          />
        </Field>
      </div>
      <div class='tm-actions'>
        <button type='submit' class='btn btn-secondary' disabled={props.state.busy()}>
          Save
        </button>
      </div>
    </form>
  );
}

function StaffInvite(props: { state: ManageState; manage: Manage }) {
  const [copied, setCopied] = createSignal(false);
  function rotate() {
    const { code } = props.manage;
    void props.state.run(() => rotateStaffToken(code));
  }
  const link = () => `${location.origin}/host/${props.manage.code}?invite=${props.manage.staffToken ?? ''}`;
  async function copy() {
    await navigator.clipboard.writeText(link());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div class='tm-form'>
      <h3>Staff</h3>
      <div class='tm-actions'>
        <input class='tm-input tm-link' readOnly value={link()} aria-label='Staff invite link' />
        <button type='button' class='btn btn-secondary' onClick={() => void copy()}>
          {copied() ? 'Copied' : 'Copy link'}
        </button>
        <button type='button' class='btn btn-ghost' onClick={rotate}>
          New link, remove staff
        </button>
      </div>
    </div>
  );
}

function DangerZone(props: { state: ManageState; manage: Manage }) {
  const navigate = useNavigate();
  const [confirming, setConfirming] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  async function remove() {
    try {
      await deleteTournament(props.manage.code);
      navigate('/host');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }
  return (
    <div class='tm-actions'>
      <Show
        when={confirming()}
        fallback={
          <button type='button' class='btn btn-ghost' onClick={() => setConfirming(true)}>
            Delete event
          </button>
        }
      >
        <button type='button' class='btn btn-secondary tm-danger' onClick={() => void remove()}>
          Delete for good
        </button>
        <button type='button' class='btn btn-ghost' onClick={() => setConfirming(false)}>
          Keep it
        </button>
      </Show>
      <ErrorLine message={error()} />
    </div>
  );
}

export function EventPanel(props: { state: ManageState; manage: Manage }) {
  const download = () =>
    downloadBlob(
      new Blob([tdfText({ ...props.manage, finished: props.manage.settings.finished })], { type: 'application/xml' }),
      tdfFilename(props.manage.tournament)
    );
  function toggleFinished() {
    const { code } = props.manage;
    const finished = !props.manage.settings.finished;
    void props.state.run(() => saveSettings(code, { finished }));
  }
  return (
    <div class='tm-panel'>
      <div class='tm-toolbar'>
        <button type='button' class='btn btn-secondary' onClick={download}>
          Download .tdf
        </button>
        <button type='button' class='btn btn-secondary' disabled={props.state.busy()} onClick={toggleFinished}>
          {props.manage.settings.finished ? 'Reopen event' : 'Close event'}
        </button>
      </div>
      <Show when={props.manage.mode === 'swiss'}>
        <RoundTimes state={props.state} manage={props.manage} />
      </Show>
      <SettingsForm state={props.state} manage={props.manage} />
      <Show when={props.manage.role === 'owner'}>
        <StaffInvite state={props.state} manage={props.manage} />
        <DangerZone state={props.state} manage={props.manage} />
      </Show>
    </div>
  );
}
