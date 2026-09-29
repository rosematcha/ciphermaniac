/**
 * Setting up a new event on one screen: a name, then every other answer
 * shown at its default and changed in place. A Swiss event asks everything;
 * an event followed from TOM asks only what its .tdf does not say (the
 * name, sanctioning, divisions and round length all come from the file).
 */

import { createSignal, type JSX, Show } from 'solid-js';
import { DEFAULT_ROUND_MINUTES } from '../../../shared/tournament/create';
import type { DeckVisibility, TournamentSettings } from '../../../shared/tournament/view';
import { Segmented } from '../../components/Segmented';
import { ErrorLine, Field } from './Field';
import { FormatSelect } from './FormatSelect';

export interface Setup {
  name: string;
  combined: boolean;
  roundTime: number;
  settings: Partial<TournamentSettings>;
}

type OnOff = 'on' | 'off';

const ON_OFF = [
  { value: 'on' as const, label: 'On' },
  { value: 'off' as const, label: 'Off' }
];

function Row(props: { label: string; children: JSX.Element }) {
  return (
    <div class='tm-setup-row'>
      <span class='tm-setup-label'>{props.label}</span>
      {props.children}
    </div>
  );
}

const onOff = (value: boolean): OnOff => (value ? 'on' : 'off');

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
  const [archetypes, setArchetypes] = createSignal(false);
  const [decklists, setDecklists] = createSignal(false);
  const swiss = () => props.mode === 'swiss';

  function submit(event: Event) {
    event.preventDefault();
    const deckVisibility: DeckVisibility = archetypes() ? 'after' : 'off';
    props.onCreate({
      name: name().trim(),
      combined: combined() || !sanctioned(),
      roundTime: roundTime(),
      settings: {
        format: format(),
        startsAt: startsAt(),
        deckVisibility,
        decklistsOpen: decklists(),
        playerReporting: reporting(),
        ...(swiss() ? { sanctioned: sanctioned() } : {})
      }
    });
  }

  return (
    <form class='tm-form tm-setup' onSubmit={submit}>
      <Show
        when={swiss()}
        fallback={
          <h3>
            <span class='tm-name'>{props.tdfName}</span>
          </h3>
        }
      >
        <Field id='setup-name' label='Event name'>
          <input
            id='setup-name'
            class='tm-input'
            maxLength={120}
            value={name()}
            ref={el => queueMicrotask(() => el.focus())}
            onInput={e => setName(e.currentTarget.value)}
          />
        </Field>
      </Show>
      <div class='tm-setup-rows'>
        <Show when={swiss()}>
          <Row label='Sanctioned'>
            <Segmented
              options={[
                { value: 'yes', label: 'Yes' },
                { value: 'no', label: 'No' }
              ]}
              selected={sanctioned() ? 'yes' : 'no'}
              onSelect={value => setSanctioned(value === 'yes')}
              ariaLabel='Sanctioned'
            />
          </Row>
          <Show when={sanctioned()}>
            <Row label='Divisions'>
              <Segmented
                options={[
                  { value: 'together', label: 'Together' },
                  { value: 'apart', label: 'Apart' }
                ]}
                selected={combined() ? 'together' : 'apart'}
                onSelect={value => setCombined(value === 'together')}
                ariaLabel='Divisions'
              />
            </Row>
          </Show>
        </Show>
        <Row label='Format'>
          <span class='tm-setup-control'>
            <FormatSelect id='setup-format' value={format()} onChange={setFormat} />
          </span>
        </Row>
        <Row label='Starts'>
          <input
            class='tm-input tm-setup-control'
            type='datetime-local'
            aria-label='Starts'
            value={startsAt()}
            onInput={e => setStartsAt(e.currentTarget.value)}
          />
        </Row>
        <Show when={swiss()}>
          <Row label='Round minutes'>
            <input
              class='tm-input tm-setup-minutes'
              type='number'
              min='1'
              max='180'
              aria-label='Round minutes'
              value={roundTime()}
              onInput={e => setRoundTime(Number(e.currentTarget.value))}
            />
          </Row>
        </Show>
        <Row label='Player reporting'>
          <Segmented
            options={ON_OFF}
            selected={onOff(reporting())}
            onSelect={value => setReporting(value === 'on')}
            ariaLabel='Player reporting'
          />
        </Row>
        <Row label='Archetypes'>
          <Segmented
            options={ON_OFF}
            selected={onOff(archetypes())}
            onSelect={value => setArchetypes(value === 'on')}
            ariaLabel='Archetypes'
          />
        </Row>
        <Row label='Decklists'>
          <Segmented
            options={[
              { value: 'open', label: 'Open' },
              { value: 'closed', label: 'Closed' }
            ]}
            selected={decklists() ? 'open' : 'closed'}
            onSelect={value => setDecklists(value === 'open')}
            ariaLabel='Decklists'
          />
        </Row>
      </div>
      <div class='tm-actions'>
        <button type='submit' class='btn btn-primary' disabled={props.busy || (swiss() && !name().trim())}>
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
