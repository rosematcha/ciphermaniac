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
import { SANCTIONED } from '../../../shared/tournament/structure';
import type { EventType } from '../../../shared/tournament/types';
import type { DecklistMode, DeckVisibility, TournamentSettings } from '../../../shared/tournament/view';
import { ErrorLine } from './Field';
import { FormatSelect } from './FormatSelect';
import { DecklistsSwitch, EventTypeSwitch, RoundsSelect } from './SettingChoices';
import { ArchetypesSelect, SettingRow, Toggle } from './SettingControls';

export interface Setup {
  name: string;
  roundTime: number;
  eventType: EventType;
  settings: Partial<TournamentSettings>;
}

export function EventSetup(props: {
  /** 'tom' when the event comes from a .tdf, whose own answers are not asked again. */
  mode: 'swiss' | 'tom';
  /** The name the .tdf gave, shown instead of asked. */
  tdfName?: string;
  /** Whether the imported event has a Play! Pokémon sanction ID. */
  tdfSanctioned?: boolean;
  busy: boolean;
  error: string | null;
  onCreate: (setup: Setup) => void;
  onCancel: () => void;
}) {
  const [name, setName] = createSignal('');
  const [sanctioned, setSanctioned] = createSignal(false);
  const [playToolsConfirmed, setPlayToolsConfirmed] = createSignal(false);
  const [format, setFormat] = createSignal('Standard');
  const [startsAt, setStartsAt] = createSignal('');
  const [roundTime, setRoundTime] = createSignal(DEFAULT_ROUND_MINUTES);
  const [reporting, setReporting] = createSignal(false);
  const [archetypes, setArchetypes] = createSignal<DeckVisibility>('off');
  const [decklists, setDecklists] = createSignal<DecklistMode>('off');
  const [roundCap, setRoundCap] = createSignal(0);
  const [eventType, setEventType] = createSignal<EventType>('cup');
  const swiss = () => props.mode === 'swiss';
  const needsName = () => swiss() && !name().trim();
  const needsPlayTools = () => (swiss() ? sanctioned() : props.tdfSanctioned);
  const shortRounds = () => swiss() && sanctioned() && roundTime() < SANCTIONED.minutes;
  const cannotCreate = () => props.busy || needsName() || shortRounds() || (needsPlayTools() && !playToolsConfirmed());
  /** A sanctioned event plays at least three rounds, so a lower cap goes back to the recommendation. */
  function setSanctionedTo(value: boolean) {
    setSanctioned(value);
    if (value && roundCap() > 0 && roundCap() < SANCTIONED.swissRounds) {
      setRoundCap(0);
    }
  }

  function submit(event: Event) {
    event.preventDefault();
    if (cannotCreate()) {
      return;
    }
    props.onCreate({
      name: name().trim(),
      roundTime: roundTime(),
      eventType: eventType(),
      settings: {
        format: format(),
        startsAt: startsAt(),
        deckVisibility: archetypes(),
        decklists: decklists(),
        playerReporting: reporting(),
        ...(swiss() ? { sanctioned: sanctioned(), roundCap: roundCap() } : {})
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
            <Toggle label='Sanctioned' value={sanctioned()} on='Yes' off='No' onChange={setSanctionedTo} />
          </SettingRow>
        </Show>
        <Show when={needsPlayTools()}>
          <SettingRow label='Play! Tools'>
            <div class='tm-field'>
              <div class='tm-set-inline'>
                <a href='https://play-tools.pokemon.com/' target='_blank' rel='noopener noreferrer'>
                  Play! Tools
                </a>
                <a href='https://play-tools.pokemon.com/guide' target='_blank' rel='noopener noreferrer'>
                  Sanctioning guide
                </a>
              </div>
              <label class='tm-check'>
                <input
                  type='checkbox'
                  required
                  checked={playToolsConfirmed()}
                  onChange={e => setPlayToolsConfirmed(e.currentTarget.checked)}
                />
                I’ve created this event in Play! Tools
              </label>
            </div>
          </SettingRow>
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
          <SettingRow label='Event type'>
            <EventTypeSwitch value={eventType()} onChange={setEventType} />
          </SettingRow>
          <SettingRow label='Round minutes' for='setup-minutes'>
            <input
              id='setup-minutes'
              class='tm-input tm-set-minutes'
              type='number'
              min={sanctioned() ? SANCTIONED.minutes : 1}
              max='180'
              value={roundTime()}
              onInput={e => setRoundTime(Number(e.currentTarget.value))}
            />
          </SettingRow>
          <SettingRow label='Swiss rounds' for='setup-rounds'>
            <RoundsSelect
              id='setup-rounds'
              value={roundCap()}
              min={sanctioned() ? SANCTIONED.swissRounds : 1}
              onChange={setRoundCap}
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
          <DecklistsSwitch value={decklists()} onChange={setDecklists} />
        </SettingRow>
      </div>
      <div class='tm-setup-foot'>
        <Show when={needsName()}>
          <span class='muted'>Name the event to create it</span>
        </Show>
        <Show when={!needsName() && shortRounds()}>
          <span class='muted'>Sanctioned rounds are at least {SANCTIONED.minutes} minutes</span>
        </Show>
        <button type='submit' class='btn btn-primary' disabled={cannotCreate()}>
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
