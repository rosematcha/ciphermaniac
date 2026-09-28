/**
 * The console's player list: add players (at any point, late arrivals
 * included), drop and reinstate them, and set the archetype each is on. A TOM
 * event's roster belongs to TOM, so there it is read-only apart from decks.
 */

import { createMemo, createSignal, For, Show } from 'solid-js';
import { divisionFor, parseTomDate, seasonOf } from '../../../shared/tournament/divisions';
import { DIVISION_LABELS, type Player, playerName } from '../../../shared/tournament/types';
import { type Manage, setDeck } from '../../lib/tournament/api';
import { latestValue } from '../../lib/resource';
import { DeckCombo } from '../live/LiveDeck';
import { deckOptions } from './deckOptions';
import { ErrorLine, Field } from './Field';
import type { ManageState } from './manageState';
import { birthDateFor } from './ProfileFields';

function AddPlayer(props: { state: ManageState }) {
  const [first, setFirst] = createSignal('');
  const [last, setLast] = createSignal('');
  const [popId, setPopId] = createSignal('');
  const [year, setYear] = createSignal('');
  async function submit(event: Event) {
    event.preventDefault();
    const ok = await props.state.send({
      type: 'addPlayer',
      player: {
        firstName: first(),
        lastName: last(),
        ...(popId() ? { id: popId() } : {}),
        ...(year() ? { birthDate: birthDateFor(year()) } : {})
      }
    });
    if (ok) {
      setFirst('');
      setLast('');
      setPopId('');
      setYear('');
    }
  }
  return (
    <form class='tm-form tm-add-player' onSubmit={event => void submit(event)}>
      <div class='tm-grid-fields'>
        <Field id='add-first' label='First name'>
          <input id='add-first' class='tm-input' value={first()} onInput={e => setFirst(e.currentTarget.value)} />
        </Field>
        <Field id='add-last' label='Last name'>
          <input id='add-last' class='tm-input' value={last()} onInput={e => setLast(e.currentTarget.value)} />
        </Field>
        <Field id='add-pop' label='Player ID'>
          <input
            id='add-pop'
            class='tm-input'
            inputmode='numeric'
            value={popId()}
            onInput={e => setPopId(e.currentTarget.value.replace(/\D/g, ''))}
          />
        </Field>
        <Field id='add-year' label='Birth year'>
          <input
            id='add-year'
            class='tm-input'
            inputmode='numeric'
            maxLength={4}
            value={year()}
            onInput={e => setYear(e.currentTarget.value.replace(/\D/g, ''))}
          />
        </Field>
      </div>
      <div class='tm-actions'>
        <button
          type='submit'
          class='btn btn-primary'
          disabled={props.state.busy() || !first().trim() || !last().trim()}
        >
          Add player
        </button>
      </div>
    </form>
  );
}

function PlayerRow(props: { state: ManageState; manage: Manage; player: Player; season: number }) {
  const [deckError, setDeckError] = createSignal<string | null>(null);
  const swiss = () => props.manage.mode === 'swiss';
  const label = () => props.manage.decks[props.player.id];
  const send = (type: 'dropPlayer' | 'undropPlayer' | 'removePlayer') =>
    void props.state.send({ type, id: props.player.id });
  async function pickDeck(archetype: string | null) {
    setDeckError(null);
    const { code } = props.manage;
    const { id } = props.player;
    const ok = await props.state.run(() => setDeck(code, id, archetype));
    if (!ok) {
      setDeckError('Could not save the deck');
    }
  }
  return (
    <tr classList={{ 'is-dropped': props.player.droppedAfter !== null }}>
      <td>
        <span class='tm-name'>{playerName(props.player)}</span>
        <Show when={props.player.late}>
          <span class='muted-cell tm-flag'>Late</span>
        </Show>
      </td>
      <td class='num muted-cell'>{props.player.id}</td>
      <td class='muted-cell'>{DIVISION_LABELS[divisionFor(props.player.birthDate, props.season)]}</td>
      <td class='tm-deck-cell'>
        <DeckCombo
          decks={latestValue(deckOptions) ?? []}
          selected={label() ? { label: label() as string } : undefined}
          placeholder='Deck'
          onPick={deck => void pickDeck(deck.label)}
        />
        <Show when={label()}>
          <button type='button' class='btn btn-ghost tm-small' onClick={() => void pickDeck(null)}>
            Clear
          </button>
        </Show>
        <ErrorLine message={deckError()} />
      </td>
      <td class='tm-extra-col'>
        <span class='tm-row-actions'>
          <Show when={swiss()}>
            <Show
              when={props.player.droppedAfter === null}
              fallback={
                <button type='button' class='btn btn-ghost tm-small' onClick={() => void send('undropPlayer')}>
                  Reinstate
                </button>
              }
            >
              <button type='button' class='btn btn-ghost tm-small' onClick={() => void send('dropPlayer')}>
                Drop
              </button>
            </Show>
            <button type='button' class='btn btn-ghost tm-small' onClick={() => void send('removePlayer')}>
              Remove
            </button>
          </Show>
          <Show when={!swiss() && props.player.droppedAfter !== null}>
            <span class='muted-cell'>Dropped after round {props.player.droppedAfter}</span>
          </Show>
        </span>
      </td>
    </tr>
  );
}

export function PlayersPanel(props: { state: ManageState; manage: Manage }) {
  const [query, setQuery] = createSignal('');
  const season = () => seasonOf(parseTomDate(props.manage.tournament.info.startDate) ?? new Date());
  const players = createMemo(() => {
    const q = query().trim().toLowerCase();
    return [...props.manage.tournament.players]
      .filter(p => !q || playerName(p).toLowerCase().includes(q) || p.id.includes(q))
      .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));
  });
  return (
    <div class='tm-panel'>
      <Show when={props.manage.mode === 'swiss'}>
        <AddPlayer state={props.state} />
      </Show>
      <div class='tm-toolbar'>
        <input
          class='search'
          type='search'
          placeholder='Search players'
          aria-label='Search players'
          value={query()}
          onInput={e => setQuery(e.currentTarget.value)}
        />
        <span class='muted'>{props.manage.tournament.players.length} players</span>
      </div>
      <div class='table-wrap'>
        <table class='data'>
          <thead>
            <tr>
              <th>Player</th>
              <th class='num'>Player ID</th>
              <th>Division</th>
              <th>Deck</th>
              <th>
                <span class='sr-only'>Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <For each={players()}>
              {player => <PlayerRow state={props.state} manage={props.manage} player={player} season={season()} />}
            </For>
          </tbody>
        </table>
      </div>
    </div>
  );
}
