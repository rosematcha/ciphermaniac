/**
 * The console's event tab: details players see, round times, deck
 * visibility, whether the event is sanctioned and whether players report
 * their own results, staff invites, the .tdf export, and closing or deleting
 * the event.
 */

import { useNavigate } from '@solidjs/router';
import { createSignal, For, Show } from 'solid-js';
import {
  type DeckVisibility,
  isSanctioned,
  SETTINGS_LIMITS,
  type TournamentSettings
} from '../../../shared/tournament/view';
import { deleteTournament, type Manage, rotateStaffToken, saveSettings } from '../../lib/tournament/api';
import { tdfFilename, tdfText } from '../../lib/tournament/exportTdf';
import { downloadBlob } from '../../lib/download';
import { ConfirmAction } from './ConfirmAction';
import { ErrorLine, Field } from './Field';
import { FormatSelect } from './FormatSelect';
import type { ManageState } from './manageState';

const VISIBILITY_LABELS: Record<DeckVisibility, string> = {
  always: 'Shown to everyone',
  after: 'Shown once the event ends',
  off: 'Off'
};

function SettingsForm(props: { state: ManageState; manage: Manage }) {
  // eslint-disable-next-line solid/reactivity -- the form edits a copy taken when it opens; saving replaces the event
  const [draft, setDraft] = createSignal<TournamentSettings>({ ...props.manage.settings });
  const set = <K extends keyof TournamentSettings>(key: K, value: TournamentSettings[K]) =>
    setDraft({ ...draft(), [key]: value });
  function save(event: Event) {
    event.preventDefault();
    const { code } = props.manage;
    const { details, format, startsAt, deckVisibility, sanctioned, playerReporting } = draft();
    void props.state.run(() =>
      saveSettings(code, { details, format, startsAt, deckVisibility, sanctioned, playerReporting })
    );
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
          <FormatSelect id='set-format' value={draft().format} onChange={value => set('format', value)} />
        </Field>
        <Field id='set-decks' label='Archetypes'>
          <select
            id='set-decks'
            class='tm-select tm-select-full'
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
      <Show when={props.manage.mode === 'swiss'}>
        <label class='tm-check'>
          <input
            type='checkbox'
            checked={draft().sanctioned}
            onChange={e => set('sanctioned', e.currentTarget.checked)}
          />
          <span>Sanctioned: players give their Player ID and birth year, and the event exports a .tdf</span>
        </label>
      </Show>
      <label class='tm-check'>
        <input
          type='checkbox'
          checked={draft().playerReporting}
          onChange={e => set('playerReporting', e.currentTarget.checked)}
        />
        <span>Players report their own results</span>
      </label>
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
        <button type='submit' class='btn btn-primary' disabled={props.state.busy()}>
          Save
        </button>
      </div>
    </form>
  );
}

function StaffInvite(props: { state: ManageState; manage: Manage }) {
  const [copied, setCopied] = createSignal(false);
  // Blurred until pressed, so the link stays off a screen being shared or projected.
  const [revealed, setRevealed] = createSignal(false);
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
    <section class='tm-section-block'>
      <h2 class='tm-subhead'>Staff</h2>
      <div class='tm-actions'>
        <input
          class='tm-input tm-link tm-secret'
          classList={{ 'is-hidden': !revealed() }}
          readOnly
          value={link()}
          aria-label='Staff invite link'
          title={revealed() ? undefined : 'Press to show'}
          onFocus={() => setRevealed(true)}
        />
        <button type='button' class='btn btn-secondary' onClick={() => void copy()}>
          {copied() ? 'Copied' : 'Copy invite link'}
        </button>
        <ConfirmAction
          class='btn btn-ghost'
          label='New link'
          question='Make a new link and remove current staff?'
          confirmLabel='Remove staff'
          onConfirm={rotate}
        />
      </div>
    </section>
  );
}

function DeleteEvent(props: { manage: Manage }) {
  const navigate = useNavigate();
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
    <section class='tm-section-block tm-danger-zone'>
      <ConfirmAction
        class='btn btn-ghost tm-danger-text'
        label='Delete event'
        question={`Delete ${props.manage.tournament.info.name} for good?`}
        confirmLabel='Delete'
        onConfirm={() => void remove()}
      />
      <ErrorLine message={error()} />
    </section>
  );
}

/** Close or reopen, and the .tdf: what an organizer does at the end of the day. */
function Finish(props: { state: ManageState; manage: Manage }) {
  const download = () =>
    downloadBlob(
      new Blob([tdfText({ ...props.manage, finished: props.manage.settings.finished })], { type: 'application/xml' }),
      tdfFilename(props.manage.tournament)
    );
  function setFinished(finished: boolean) {
    const { code } = props.manage;
    void props.state.run(() => saveSettings(code, { finished }));
  }
  return (
    <section class='tm-section-block'>
      <h2 class='tm-subhead'>Finish</h2>
      <div class='tm-actions'>
        <Show
          when={props.manage.settings.finished}
          fallback={
            <ConfirmAction
              class='btn btn-secondary'
              label='Close event'
              question='Close the event?'
              confirmLabel='Close'
              onConfirm={() => setFinished(true)}
            />
          }
        >
          <button
            type='button'
            class='btn btn-secondary'
            disabled={props.state.busy()}
            onClick={() => setFinished(false)}
          >
            Reopen event
          </button>
        </Show>
        <Show when={isSanctioned(props.manage)}>
          <button type='button' class='btn btn-ghost' onClick={download}>
            Download .tdf
          </button>
        </Show>
      </div>
    </section>
  );
}

export function EventPanel(props: { state: ManageState; manage: Manage }) {
  return (
    <div class='tm-panel tm-event-panel'>
      <Show when={props.manage.mode === 'swiss'}>
        <section class='tm-section-block'>
          <h2 class='tm-subhead'>Event</h2>
          <RoundTimes state={props.state} manage={props.manage} />
        </section>
      </Show>
      <section class='tm-section-block'>
        <h2 class='tm-subhead'>For players</h2>
        <SettingsForm state={props.state} manage={props.manage} />
      </section>
      <Finish state={props.state} manage={props.manage} />
      <Show when={props.manage.role === 'owner'}>
        <StaffInvite state={props.state} manage={props.manage} />
        <DeleteEvent manage={props.manage} />
      </Show>
    </div>
  );
}
