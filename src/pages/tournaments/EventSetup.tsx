/**
 * Setting up a new event on one screen: a heading and the name, then one box
 * of settings rows with every other answer at its default, changed in place.
 * A Swiss event asks everything; an event followed from TOM asks only what
 * its .tdf does not say (the name, sanctioning, divisions and round length all
 * come from the file). The controls are the ones the console's Event tab
 * uses, so a setting looks the same in both places.
 */

import { createSignal, Show } from 'solid-js';
import { DEFAULT_ROUND_MINUTES } from '../../../shared/tournament/create';
import type { DeckVisibility, TournamentSettings } from '../../../shared/tournament/view';
import { ErrorLine } from './Field';
import { FormatSelect } from './FormatSelect';
import { ArchetypesSelect, SettingRow, Toggle } from './SettingControls';

export interface Setup {
  name: string;
  combined: boolean;
  roundTime: number;
  settings: Partial<TournamentSettings>;
}

export function EventSetup(props: {
  /** 'tom' when the event comes from a .tdf, whose own answers are not asked again. */
  mode: 'swiss' | 'tom';
  /** The name the .tdf gave, shown instead of asked. */
  tdfName?: string;
  busy: boolean;
  error: string | null;
  onCreate: (setup: Setup) => void;
  onCancel: () => void;
}) {
  const [name, setName] = createSignal('');
  const [sanctioned, setSanctioned] = createSignal(false);
  const [combined, setCombined] = createSignal(true);
  const [format, setFormat] = createSignal('Standard');
  const [startsAt, setStartsAt] = createSignal('');
  const [roundTime, setRoundTime] = createSignal(DEFAULT_ROUND_MINUTES);
  const [reporting, setReporting] = createSignal(false);
  const [archetypes, setArchetypes] = createSignal<DeckVisibility>('off');
  const [decklists, setDecklists] = createSignal(false);
  const swiss = () => props.mode === 'swiss';
  const needsName = () => swiss() && !name().trim();

  function submit(event: Event) {
    event.preventDefault();
    props.onCreate({
      name: name().trim(),
      combined: combined() || !sanctioned(),
      roundTime: roundTime(),
      settings: {
        format: format(),
        startsAt: startsAt(),
        deckVisibility: archetypes(),
        decklistsOpen: decklists(),
        playerReporting: reporting(),
        ...(swiss() ? { sanctioned: sanctioned() } : {})
      }
    });
  }

  return (
    <form class='tm-setup' onSubmit={submit}>
      <div class='tm-setup-head'>
        <h2>New event</h2>
        <Show
          when={swiss()}
          fallback={
            <p class='tm-setup-file'>
              <strong>{props.tdfName}</strong>
            </p>
          }
        >
          <input
            class='tm-input tm-setup-name'
            maxLength={120}
            placeholder='Event name'
            aria-label='Event name'
            value={name()}
            ref={el => queueMicrotask(() => el.focus())}
            onInput={e => setName(e.currentTarget.value)}
          />
        </Show>
      </div>
      <div class='tm-box'>
        <Show when={swiss()}>
          <SettingRow label='Sanctioned'>
            <Toggle label='Sanctioned' value={sanctioned()} on='Yes' off='No' onChange={setSanctioned} />
          </SettingRow>
          <Show when={sanctioned()}>
            <SettingRow label='Divisions'>
              <Toggle label='Divisions' value={combined()} on='Together' off='Apart' onChange={setCombined} />
            </SettingRow>
          </Show>
        </Show>
        <SettingRow label='Format' for='setup-format'>
          <FormatSelect id='setup-format' value={format()} onChange={setFormat} />
        </SettingRow>
        <SettingRow label='Starts' for='setup-starts'>
          <input
            id='setup-starts'
            class='tm-input'
            type='datetime-local'
            value={startsAt()}
            onInput={e => setStartsAt(e.currentTarget.value)}
          />
        </SettingRow>
        <Show when={swiss()}>
          <SettingRow label='Round minutes' for='setup-minutes'>
            <input
              id='setup-minutes'
              class='tm-input tm-set-minutes'
              type='number'
              min='1'
              max='180'
              value={roundTime()}
              onInput={e => setRoundTime(Number(e.currentTarget.value))}
            />
          </SettingRow>
        </Show>
        <SettingRow label='Player reporting'>
          <Toggle label='Player reporting' value={reporting()} onChange={setReporting} />
        </SettingRow>
        <SettingRow label='Archetypes' for='setup-archetypes'>
          <ArchetypesSelect id='setup-archetypes' value={archetypes()} onChange={setArchetypes} />
        </SettingRow>
        <SettingRow label='Decklists'>
          <Toggle label='Decklists' value={decklists()} on='Open' off='Closed' onChange={setDecklists} />
        </SettingRow>
      </div>
      <div class='tm-setup-foot'>
        <Show when={needsName()}>
          <span class='muted'>Name the event to create it</span>
        </Show>
        <button type='submit' class='btn btn-primary' disabled={props.busy || needsName()}>
          Create event
        </button>
        <button type='button' class='btn btn-ghost' onClick={() => props.onCancel()}>
          Cancel
        </button>
      </div>
      <ErrorLine message={props.error} />
    </form>
  );
}
