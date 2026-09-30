/**
 * The console's player list: add players (at any point, late arrivals
 * included), drop and reinstate them, give a player a fixed table, and set
 * the archetype each is on. A TOM event's roster belongs to TOM, so there it
 * is read-only apart from decks.
 *
 * The add form is one row in its own box; the roster is a box with its
 * search in the bar, then a row per player: the name over their Player ID
 * and division, their rounds as squares, the deck picker, the fixed table
 * and the actions. With archetypes off for the event the deck column stays
 * in place, greyed, with the way to turn it on.
 */

import { useSearchParams } from '@solidjs/router';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { divisionFor, eventSeason } from '../../../shared/tournament/divisions';
import { canUndrop } from '../../../shared/tournament/commands';
import { hasPlayed, hasStarted, podOf } from '../../../shared/tournament/rounds';
import { DIVISION_LABELS, type Player, playerName, type Tournament } from '../../../shared/tournament/types';
import { decksEnabled, isSanctioned } from '../../../shared/tournament/view';
import { type Manage, releaseReporter } from '../../lib/tournament/api';
import { matchHistory } from '../../lib/tournament/present';
import type { ReportedDeck } from '../live/LiveDeck';
import { ConfirmAction } from './ConfirmAction';
import { createDeckOptions } from './deckOptions';
import { DeckPicker } from './DeckPicker';
import { Field } from './Field';
import type { ManageState } from './manageState';
import { birthDateFor } from './ProfileFields';
import { Squares } from './Squares';

/**
 * A new player: a name, and at a sanctioned event their Player ID and birth
 * year. Once added, the first name takes focus again for the next in line.
 */
function AddPlayer(props: { state: ManageState; sanctioned: boolean; late: boolean }) {
  let firstInput: HTMLInputElement | undefined;
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
        ...(props.sanctioned && popId() ? { id: popId() } : {}),
        ...(props.sanctioned && year() ? { birthDate: birthDateFor(year()) } : {})
      }
    });
    if (ok) {
      setFirst('');
      setLast('');
      setPopId('');
      setYear('');
      firstInput?.focus();
    }
  }
  return (
    <form class='tm-box tm-add-player' aria-label='Add a player' onSubmit={event => void submit(event)}>
      <div class='tm-box-bar tm-add-row'>
        <Field id='add-first' label='First name'>
          <input
            id='add-first'
            ref={el => (firstInput = el)}
            class='tm-input'
            value={first()}
            onInput={e => setFirst(e.currentTarget.value)}
          />
        </Field>
        <Field id='add-last' label='Last name'>
          <input id='add-last' class='tm-input' value={last()} onInput={e => setLast(e.currentTarget.value)} />
        </Field>
        <Show when={props.sanctioned}>
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
        </Show>
        <button
          type='submit'
          class='btn btn-primary'
          disabled={props.state.busy() || !first().trim() || !last().trim()}
        >
          {props.late ? 'Add late player' : 'Add player'}
        </button>
      </div>
    </form>
  );
}

function DeckCell(props: RowProps) {
  return (
    <td class='tm-deck-cell'>
      <DeckPicker state={props.state} manage={props.manage} playerId={props.player.id} decks={props.decks} />
    </td>
  );
}

/** Archetypes off for the event: the column keeps its place, greyed, with nothing to pick. */
function DeckOffCell() {
  return (
    <td class='tm-deck-cell is-off'>
      <span class='tm-deck-off' aria-hidden='true'>
        Deck
      </span>
    </td>
  );
}

/**
 * Static seating: a player who cannot move between tables keeps one. Saved
 * when the field loses focus or Enter is pressed; emptied, it frees the table.
 */
function FixedTableCell(props: { state: ManageState; player: Player }) {
  function save(value: string) {
    const table = value.trim() ? Number(value) : null;
    if (table === (props.player.fixedTable ?? null)) {
      return;
    }
    const { id } = props.player;
    void props.state.send({ type: 'setFixedTable', id, table });
  }
  return (
    <td class='num tm-fixed-cell'>
      <input
        class='tm-input tm-table-input'
        inputmode='numeric'
        aria-label={`Fixed table for ${playerName(props.player)}`}
        placeholder='—'
        value={props.player.fixedTable ?? ''}
        onChange={e => save(e.currentTarget.value.replace(/\D/g, ''))}
      />
    </td>
  );
}

/**
 * Drop, reinstate, remove (only before the player's first match: after it
 * they are dropped). A drop can be taken back only until the next round
 * is paired (see undropPlayer in shared/tournament/commands.ts). Where players
 * report, staff can also let another device report for a player, as when
 * they change phones or someone else claimed them first.
 */
function PlayerActions(props: { state: ManageState; manage: Manage; player: Player }) {
  const send = (type: 'dropPlayer' | 'undropPlayer' | 'removePlayer') =>
    void props.state.send({ type, id: props.player.id });
  const pod = () => podOf(props.manage.tournament, props.player.id);
  const dropped = () => props.player.droppedAfter;
  return (
    <td class='tm-extra-col'>
      <span class='tm-row-actions'>
        <Show when={dropped() === null}>
          <ConfirmAction
            label='Drop'
            question={`Drop ${playerName(props.player)}?`}
            danger
            onConfirm={() => send('dropPlayer')}
          />
        </Show>
        <Show when={dropped() !== null && canUndrop(props.manage.tournament, props.player)}>
          <button type='button' class='btn btn-ghost tm-small' onClick={() => send('undropPlayer')}>
            Reinstate
          </button>
        </Show>
        <Show when={props.manage.settings.playerReporting && dropped() === null}>
          <ConfirmAction
            label='Reset reporting'
            question={`Let another device report for ${playerName(props.player)}?`}
            confirmLabel='Reset'
            onConfirm={() => void releaseReporter(props.manage.code, props.player.id).catch(() => undefined)}
          />
        </Show>
        {/* Once paired, a player is dropped rather than removed, so their opponents keep the match. */}
        <Show when={!hasPlayed(pod(), props.player.id)}>
          <ConfirmAction
            label='Remove'
            question={`Remove ${playerName(props.player)}?`}
            danger
            onConfirm={() => send('removePlayer')}
          />
        </Show>
      </span>
    </td>
  );
}

/** A player's results so far, one mark per round of their pod. */
function marksOf(tournament: Tournament, player: Player): { marks: string[]; rounds: number } {
  const pod = podOf(tournament, player.id);
  if (!pod) {
    return { marks: [], rounds: 0 };
  }
  const history = matchHistory(pod, player.id);
  const byRound = new Map(history.map(row => [row.round, row.mark]));
  return { marks: pod.rounds.map(round => byRound.get(round.number) ?? ''), rounds: pod.rounds.length };
}

interface RowProps {
  state: ManageState;
  manage: Manage;
  player: Player;
  season: number;
  showRounds: boolean;
  decks: readonly ReportedDeck[];
}

function PlayerRow(props: RowProps) {
  const swiss = () => props.manage.mode === 'swiss';
  const sanctioned = () => isSanctioned(props.manage);
  const sub = () =>
    [
      sanctioned() ? props.player.id : '',
      sanctioned() ? DIVISION_LABELS[divisionFor(props.player.birthDate, props.season)] : '',
      props.player.droppedAfter !== null ? `dropped after round ${props.player.droppedAfter}` : ''
    ]
      .filter(Boolean)
      .join(' · ');
  const history = () => marksOf(props.manage.tournament, props.player);
  return (
    <tr classList={{ 'is-dropped': props.player.droppedAfter !== null }}>
      <td class='tm-who'>
        <span class='tm-who-name'>
          <span class='tm-name'>{playerName(props.player)}</span>
          <Show when={props.player.late}>
            <span class='tm-flag'>Late</span>
          </Show>
          <Show when={props.player.droppedAfter !== null}>
            <span class='tm-flag'>Dropped</span>
          </Show>
        </span>
        <Show when={sub()}>
          <span class='tm-who-sub tm-num'>{sub()}</span>
        </Show>
      </td>
      <Show when={props.showRounds}>
        <td class='tm-rounds-cell'>
          <Squares marks={history().marks} rounds={history().rounds} />
        </td>
      </Show>
      <Show when={decksEnabled(props.manage.settings)} fallback={<DeckOffCell />}>
        <DeckCell {...props} />
      </Show>
      <Show when={swiss()} fallback={<td class='tm-extra-col' />}>
        <FixedTableCell state={props.state} player={props.player} />
        <PlayerActions state={props.state} manage={props.manage} player={props.player} />
      </Show>
    </tr>
  );
}

export function PlayersPanel(props: { state: ManageState; manage: Manage }) {
  const [, setParams] = useSearchParams<{ tab?: string }>();
  const [query, setQuery] = createSignal('');
  const season = () => eventSeason(props.manage.tournament);
  const swiss = () => props.manage.mode === 'swiss';
  const sanctioned = () => isSanctioned(props.manage);
  const started = () => hasStarted(props.manage.tournament);
  const archetypes = () => decksEnabled(props.manage.settings);
  const decks = createDeckOptions(
    () => props.manage.settings.format,
    () => Object.values(props.manage.decks)
  );
  const players = createMemo(() => {
    const q = query().trim().toLowerCase();
    return [...props.manage.tournament.players]
      .filter(p => !q || playerName(p).toLowerCase().includes(q) || p.id.includes(q))
      .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));
  });
  const count = () => {
    const all = props.manage.tournament.players.length;
    return players().length === all ? `${all} players` : `${players().length} of ${all} players`;
  };
  return (
    <div class='tm-panel'>
      <Show when={swiss()}>
        <AddPlayer state={props.state} sanctioned={sanctioned()} late={started()} />
      </Show>
      <section class='tm-box'>
        <div class='tm-box-bar'>
          <input
            class='search'
            type='search'
            placeholder='Search players'
            aria-label='Search players'
            value={query()}
            onInput={e => setQuery(e.currentTarget.value)}
          />
          <span class='muted tm-num'>{count()}</span>
        </div>
        <div class='table-wrap'>
          <table class='data tm-roster'>
            <thead>
              <tr>
                <th>Player</th>
                <Show when={started()}>
                  <th>Rounds</th>
                </Show>
                <th>
                  Deck
                  <Show when={!archetypes()}>
                    <span class='tm-th-note'>
                      {' '}
                      · off{' '}
                      <button type='button' class='tm-th-link' onClick={() => setParams({ tab: 'event' })}>
                        Turn on in Event settings
                      </button>
                    </span>
                  </Show>
                </th>
                <Show when={swiss()}>
                  <th class='num' title='Static seating: this player sits at the same table every round'>
                    Fixed table
                  </th>
                </Show>
                <th>
                  <span class='sr-only'>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <For each={players()}>
                {player => (
                  <PlayerRow
                    state={props.state}
                    manage={props.manage}
                    player={player}
                    season={season()}
                    showRounds={started()}
                    decks={decks()}
                  />
                )}
              </For>
            </tbody>
          </table>
        </div>
        <Show when={players().length === 0}>
          <p class='muted tm-empty'>
            {props.manage.tournament.players.length ? 'No players match.' : 'No players yet.'}
          </p>
        </Show>
      </section>
    </div>
  );
}
