/**
 * The console's event tab, as bordered boxes of settings rows (label at left,
 * control at right): the event itself (name, round lengths), what players see
 * and do (start, format, archetypes, sanctioned, reporting, decklists,
 * details), finishing (close or reopen, the .tdf), the staff invite, and
 * deleting the event. Each box of settings saves on its own and says when it
 * has unsaved changes; anything that cannot be taken back asks first.
 */

import { useNavigate } from '@solidjs/router';
import { createResource, createSignal, For, type JSX, Show } from 'solid-js';
import { isSanctioned, SETTINGS_LIMITS, type TournamentSettings } from '../../../shared/tournament/view';
import {
  deleteTournament,
  fetchStaff,
  type Manage,
  removeStaff,
  rotateStaffToken,
  saveSettings
} from '../../lib/tournament/api';
import { latestValue } from '../../lib/resource';
import { tdfFilename, tdfText } from '../../lib/tournament/exportTdf';
import { downloadBlob } from '../../lib/download';
import { ConfirmAction } from './ConfirmAction';
import { ErrorLine } from './Field';
import { FormatSelect } from './FormatSelect';
import type { ManageState } from './manageState';
import { ArchetypesSelect, SettingRow, Toggle } from './SettingControls';

/** A box of settings with its heading, and a foot with Save and whether anything is unsaved. */
function SettingsBox(props: {
  title: string;
  dirty: boolean;
  busy: boolean;
  onSave: () => void;
  children: JSX.Element;
}) {
  return (
    <section>
      <h2 class='tm-th tm-box-head'>{props.title}</h2>
      <form
        class='tm-box tm-set-box'
        onSubmit={event => {
          event.preventDefault();
          props.onSave();
        }}
      >
        {props.children}
        <div class='tm-box-bar tm-set-foot'>
          <Show when={props.dirty}>
            <span class='muted'>Unsaved changes</span>
          </Show>
          <button type='submit' class='btn btn-primary' disabled={props.busy || !props.dirty}>
            Save
          </button>
        </div>
      </form>
    </section>
  );
}

function EventDetails(props: { state: ManageState; manage: Manage }) {
  const info = () => props.manage.tournament.info;
  const [name, setName] = createSignal(info().name);
  const [roundTime, setRoundTime] = createSignal(info().roundTime);
  const [finals, setFinals] = createSignal(info().finalsRoundTime);
  const dirty = () => name() !== info().name || roundTime() !== info().roundTime || finals() !== info().finalsRoundTime;
  const save = () =>
    void props.state.send({
      type: 'updateInfo',
      info: { name: name(), roundTime: roundTime(), finalsRoundTime: finals() }
    });
  return (
    <SettingsBox title='Event' dirty={dirty()} busy={props.state.busy()} onSave={save}>
      <SettingRow label='Event name' for='info-name'>
        <input id='info-name' class='tm-input' value={name()} onInput={e => setName(e.currentTarget.value)} />
      </SettingRow>
      <SettingRow label='Round minutes' for='info-round'>
        <input
          id='info-round'
          class='tm-input tm-set-minutes'
          type='number'
          min='1'
          max='180'
          value={roundTime()}
          onInput={e => setRoundTime(Number(e.currentTarget.value))}
        />
      </SettingRow>
      <SettingRow label='Top cut round minutes' for='info-finals'>
        <input
          id='info-finals'
          class='tm-input tm-set-minutes'
          type='number'
          min='1'
          max='180'
          value={finals()}
          onInput={e => setFinals(Number(e.currentTarget.value))}
        />
      </SettingRow>
    </SettingsBox>
  );
}

type PlayerSettings = Pick<
  TournamentSettings,
  'details' | 'format' | 'startsAt' | 'deckVisibility' | 'sanctioned' | 'playerReporting' | 'decklistsOpen'
>;

const pickPlayerSettings = (settings: TournamentSettings): PlayerSettings => {
  const { details, format, startsAt, deckVisibility, sanctioned, playerReporting, decklistsOpen } = settings;
  return { details, format, startsAt, deckVisibility, sanctioned, playerReporting, decklistsOpen };
};

function ForPlayers(props: { state: ManageState; manage: Manage }) {
  // eslint-disable-next-line solid/reactivity -- the form edits a copy taken when it opens; saving replaces the event
  const [draft, setDraft] = createSignal<PlayerSettings>(pickPlayerSettings(props.manage.settings));
  const set = <K extends keyof PlayerSettings>(key: K, value: PlayerSettings[K]) =>
    setDraft({ ...draft(), [key]: value });
  const dirty = () => {
    const saved = pickPlayerSettings(props.manage.settings);
    return (Object.keys(saved) as (keyof PlayerSettings)[]).some(key => saved[key] !== draft()[key]);
  };
  function save() {
    const { code } = props.manage;
    const next = draft();
    void props.state.run(() => saveSettings(code, next));
  }
  return (
    <SettingsBox title='For players' dirty={dirty()} busy={props.state.busy()} onSave={save}>
      <SettingRow label='Starts' for='set-start'>
        <input
          id='set-start'
          class='tm-input'
          type='datetime-local'
          value={draft().startsAt}
          onInput={e => set('startsAt', e.currentTarget.value)}
        />
      </SettingRow>
      <SettingRow label='Format' for='set-format'>
        <FormatSelect id='set-format' value={draft().format} onChange={value => set('format', value)} />
      </SettingRow>
      <SettingRow label='Archetypes' for='set-decks'>
        <ArchetypesSelect id='set-decks' value={draft().deckVisibility} onChange={v => set('deckVisibility', v)} />
      </SettingRow>
      <Show when={props.manage.mode === 'swiss'}>
        <SettingRow label='Sanctioned'>
          <Toggle
            label='Sanctioned'
            value={draft().sanctioned}
            on='Yes'
            off='No'
            onChange={v => set('sanctioned', v)}
          />
        </SettingRow>
      </Show>
      <SettingRow label='Player reporting'>
        <Toggle label='Player reporting' value={draft().playerReporting} onChange={v => set('playerReporting', v)} />
      </SettingRow>
      <SettingRow label='Decklists'>
        <Toggle
          label='Decklists'
          value={draft().decklistsOpen}
          on='Open'
          off='Closed'
          onChange={v => set('decklistsOpen', v)}
        />
      </SettingRow>
      <SettingRow label='Details for players' for='set-details'>
        <textarea
          id='set-details'
          class='tm-input tm-textarea'
          maxLength={SETTINGS_LIMITS.details}
          value={draft().details}
          onInput={e => set('details', e.currentTarget.value)}
        />
      </SettingRow>
    </SettingsBox>
  );
}

/** Close or reopen, and the .tdf: what an organizer does at the end of the day. */
function Finish(props: { state: ManageState; manage: Manage }) {
  const download = () => {
    const { manage } = props;
    void props.state.run(() => {
      downloadBlob(
        new Blob([tdfText({ ...manage, finished: manage.settings.finished })], { type: 'application/xml' }),
        tdfFilename(manage.tournament)
      );
      return Promise.resolve(manage);
    });
  };
  function setFinished(finished: boolean) {
    const { code } = props.manage;
    void props.state.run(() => saveSettings(code, { finished }));
  }
  return (
    <section>
      <h2 class='tm-th tm-box-head'>Finish</h2>
      <div class='tm-box'>
        <SettingRow label='Status'>
          <span class='tm-set-inline'>
            <span>{props.manage.settings.finished ? 'Closed' : 'Open'}</span>
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
          </span>
        </SettingRow>
        <Show when={isSanctioned(props.manage)}>
          <SettingRow label='Play! Pokémon file'>
            <button type='button' class='btn btn-secondary' onClick={download}>
              Download .tdf
            </button>
          </SettingRow>
        </Show>
      </div>
    </section>
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
    <section>
      <h2 class='tm-th tm-box-head'>Staff</h2>
      <div class='tm-box'>
        <SettingRow label='Invite link'>
          <span class='tm-set-inline tm-invite'>
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
              danger
              onConfirm={rotate}
            />
          </span>
        </SettingRow>
        <StaffList manage={props.manage} />
      </div>
    </section>
  );
}

const joinedOn = (at: number) => new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** Everyone the invite link let in, and when, so a link that went further than meant shows; each can be removed. */
function StaffList(props: { manage: Manage }) {
  // A new link removes everyone, so the list is asked for again with each one.
  const [staff, { mutate }] = createResource(
    () => ({ code: props.manage.code, token: props.manage.staffToken }),
    ({ code }) => fetchStaff(code).then(result => result.staff)
  );
  async function remove(id: string) {
    const result = await removeStaff(props.manage.code, id).catch(() => null);
    if (result) {
      mutate(result.staff);
    }
  }
  return (
    <SettingRow label='On staff'>
      <Show when={latestValue(staff)?.length} fallback={<span class='muted'>Nobody has joined yet</span>}>
        <ul class='tm-staff-list'>
          <For each={latestValue(staff)}>
            {member => (
              <li>
                <span>
                  {member.name}
                  <Show when={member.joinedAt}>{at => <span class='muted'> · joined {joinedOn(at())}</span>}</Show>
                </span>
                <ConfirmAction
                  label='Remove'
                  question={`Remove ${member.name} from staff?`}
                  confirmLabel='Remove'
                  danger
                  onConfirm={() => void remove(member.id)}
                />
              </li>
            )}
          </For>
        </ul>
      </Show>
    </SettingRow>
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
    <section class='tm-box tm-danger-box'>
      <SettingRow label='Delete this event'>
        <ConfirmAction
          class='btn btn-secondary tm-danger'
          label='Delete event'
          question={`Delete ${props.manage.tournament.info.name} for good?`}
          confirmLabel='Delete'
          danger
          onConfirm={() => void remove()}
        />
      </SettingRow>
      <ErrorLine message={error()} />
    </section>
  );
}

export function EventPanel(props: { state: ManageState; manage: Manage }) {
  return (
    <div class='tm-panel tm-event-panel'>
      <Show when={props.manage.mode === 'swiss'}>
        <EventDetails state={props.state} manage={props.manage} />
      </Show>
      <ForPlayers state={props.state} manage={props.manage} />
      <Finish state={props.state} manage={props.manage} />
      <Show when={props.manage.role === 'owner'}>
        <StaffInvite state={props.state} manage={props.manage} />
        <DeleteEvent manage={props.manage} />
      </Show>
    </div>
  );
}
