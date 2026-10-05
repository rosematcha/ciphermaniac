/**
 * Editing a store's league nights, on the store application and in store
 * settings: each weekly night as one row of its day, start, name and fee,
 * and (settings only) the dates a night does not run as usual, each off or
 * moved to another time. Rows change in place; the page saves the list.
 */

import { For, Index, Show } from 'solid-js';
import { type LeagueNight, type NightException, STORE_LIMITS } from '../../../shared/accounts/stores';
import { blankNight, clock, WEEKDAYS } from '../../lib/tournament/stores';
import '../../styles/pages/tournament-store-forms.css';

const replaceAt = <T,>(list: readonly T[], index: number, item: T) => list.map((old, i) => (i === index ? item : old));
const removeAt = <T,>(list: readonly T[], index: number) => list.filter((_, i) => i !== index);

function NightRow(props: {
  night: LeagueNight;
  n: number;
  onChange: (night: LeagueNight) => void;
  onRemove: () => void;
}) {
  const label = (what: string) => `League night ${props.n} ${what}`;
  const set = (change: Partial<LeagueNight>) => props.onChange({ ...props.night, ...change });
  return (
    <li class='tm-night'>
      <select
        class='tm-select'
        aria-label={label('day')}
        value={props.night.weekday}
        onChange={e => set({ weekday: Number(e.currentTarget.value) })}
      >
        <For each={WEEKDAYS}>{(day, i) => <option value={i()}>{day}</option>}</For>
      </select>
      <input
        class='tm-input tm-night-time'
        type='time'
        required
        aria-label={label('start')}
        value={props.night.time}
        onInput={e => set({ time: e.currentTarget.value })}
      />
      <input
        class='tm-input'
        aria-label={label('name')}
        placeholder='Name'
        maxLength={STORE_LIMITS.nightName}
        value={props.night.name}
        onInput={e => set({ name: e.currentTarget.value })}
      />
      <input
        class='tm-input tm-night-fee'
        aria-label={label('fee')}
        placeholder='Fee'
        maxLength={STORE_LIMITS.fee}
        value={props.night.fee}
        onInput={e => set({ fee: e.currentTarget.value })}
      />
      <button
        type='button'
        class='btn btn-ghost tm-small'
        aria-label={label('remove')}
        onClick={() => props.onRemove()}
      >
        Remove
      </button>
    </li>
  );
}

/** The weekly nights, in the order they were added, with a way to add one. */
export function WeeklyNights(props: { nights: readonly LeagueNight[]; onChange: (nights: LeagueNight[]) => void }) {
  return (
    <div class='tm-nights'>
      <Show when={props.nights.length > 0}>
        <ul class='tm-night-list'>
          {/* By position, not by object: each edit makes a new night, and its row must keep the focus. */}
          <Index each={props.nights}>
            {(night, i) => (
              <NightRow
                night={night()}
                n={i + 1}
                onChange={next => props.onChange(replaceAt(props.nights, i, next))}
                onRemove={() => props.onChange(removeAt(props.nights, i))}
              />
            )}
          </Index>
        </ul>
      </Show>
      <Show when={props.nights.length < STORE_LIMITS.nights}>
        <button
          type='button'
          class='btn btn-secondary tm-small tm-night-add'
          onClick={() => props.onChange([...props.nights, blankNight(props.nights)])}
        >
          Add a league night
        </button>
      </Show>
    </div>
  );
}

const nightLabel = (night: LeagueNight) =>
  `${WEEKDAYS[night.weekday]} ${clock(night.time)}${night.name ? ` · ${night.name}` : ''}`;

function ExceptionRow(props: {
  exception: NightException;
  nights: readonly LeagueNight[];
  n: number;
  onChange: (exception: NightException) => void;
  onRemove: () => void;
}) {
  const label = (what: string) => `Date ${props.n} ${what}`;
  const set = (change: Partial<NightException>) => props.onChange({ ...props.exception, ...change });
  const night = () => props.nights.find(item => item.id === props.exception.nightId);
  return (
    <li class='tm-night tm-night-exception'>
      <input
        class='tm-input tm-night-date'
        type='date'
        required
        aria-label={label('day')}
        value={props.exception.date}
        onInput={e => set({ date: e.currentTarget.value })}
      />
      <select
        class='tm-select'
        aria-label={label('night')}
        value={props.exception.nightId ?? ''}
        onChange={e => set({ nightId: e.currentTarget.value || null })}
      >
        <option value=''>Every night that day</option>
        <For each={props.nights}>{item => <option value={item.id}>{nightLabel(item)}</option>}</For>
      </select>
      <span class='tm-night-change'>
        <select
          class='tm-select'
          aria-label={label('change')}
          value={props.exception.time === null ? 'off' : 'moved'}
          onChange={e => set({ time: e.currentTarget.value === 'off' ? null : (night()?.time ?? '18:00') })}
        >
          <option value='off'>Off</option>
          <option value='moved'>Moved to</option>
        </select>
        <Show when={props.exception.time !== null}>
          <input
            class='tm-input tm-night-time'
            type='time'
            required
            aria-label={label('new start')}
            value={props.exception.time ?? ''}
            onInput={e => set({ time: e.currentTarget.value })}
          />
        </Show>
      </span>
      <input
        class='tm-input'
        aria-label={label('note')}
        placeholder='Why'
        maxLength={STORE_LIMITS.note}
        value={props.exception.note}
        onInput={e => set({ note: e.currentTarget.value })}
      />
      <button
        type='button'
        class='btn btn-ghost tm-small'
        aria-label={label('remove')}
        onClick={() => props.onRemove()}
      >
        Remove
      </button>
    </li>
  );
}

/** The dates a night is off or moved; a new one starts on `today`, off. */
export function NightExceptions(props: {
  exceptions: readonly NightException[];
  nights: readonly LeagueNight[];
  today: string;
  onChange: (exceptions: NightException[]) => void;
}) {
  return (
    <div class='tm-nights'>
      <Show when={props.exceptions.length > 0}>
        <ul class='tm-night-list'>
          <Index each={props.exceptions}>
            {(exception, i) => (
              <ExceptionRow
                exception={exception()}
                nights={props.nights}
                n={i + 1}
                onChange={next => props.onChange(replaceAt(props.exceptions, i, next))}
                onRemove={() => props.onChange(removeAt(props.exceptions, i))}
              />
            )}
          </Index>
        </ul>
      </Show>
      <Show when={props.exceptions.length < STORE_LIMITS.exceptions}>
        <button
          type='button'
          class='btn btn-secondary tm-small tm-night-add'
          onClick={() =>
            props.onChange([...props.exceptions, { date: props.today, nightId: null, time: null, note: '' }])
          }
        >
          Add a date
        </button>
      </Show>
    </div>
  );
}
