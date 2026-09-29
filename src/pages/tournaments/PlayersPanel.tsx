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
import { divisionFor, parseTomDate, seasonOf } from '../../../shared/tournament/divisions';
import { DIVISION_LABELS, type Player, playerName, type Tournament } from '../../../shared/tournament/types';
import { decksEnabled, isSanctioned } from '../../../shared/tournament/view';
import { type Manage, setDeck } from '../../lib/tournament/api';
import { latestValue } from '../../lib/resource';
import { matchHistory } from '../../lib/tournament/present';
import { DeckCombo } from '../live/LiveDeck';
import { deckOptions } from './deckOptions';
import { ConfirmAction } from './ConfirmAction';
import { ErrorLine, Field } from './Field';
import type { ManageState } from './manageState';
import { birthDateFor } from './ProfileFields';
import { Squares } from './Squares';

/** A new player: a name, and at a sanctioned event their Player ID and birth year. */
function AddPlayer(props: { state: ManageState; sanctioned: boolean; late: boolean }) {
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
    }
  }
  return (
    <form class='tm-box tm-add-player' aria-label='Add a player' onSubmit={event => void submit(event)}>
      <div class='tm-box-bar tm-add-row'>
        <Field id='add-first' label='First name'>
          <input id='add-first' class='tm-input' value={first()} onInput={e => setFirst(e.currentTarget.value)} />
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

function DeckCell(props: { state: ManageState; manage: Manage; player: Player }) {
  const [deckError, setDeckError] = createSignal<string | null>(null);
  const label = () => props.manage.decks[props.player.id];
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
    <td class='tm-deck-cell'>
      <span class='tm-deck-pick'>
        <DeckCombo
          decks={latestValue(deckOptions) ?? []}
          selected={label() ? { label: label() as string } : undefined}
          placeholder='Deck'
          onPick={deck => void pickDeck(deck.label)}
        />
        <Show when={label()} fallback={<span />}>
          <button type='button' class='btn btn-ghost tm-small' onClick={() => void pickDeck(null)}>
            Clear
          </button>
        </Show>
      </span>
      <ErrorLine message={deckError()} />
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
 * Drop, reinstate, remove. A drop can be taken back only until the next round
 * is paired (see undropPlayer in shared/tournament/commands.ts).
 */
function PlayerActions(props: { state: ManageState; manage: Manage; player: Player }) {
  const send = (type: 'dropPlayer' | 'undropPlayer' | 'removePlayer') =>
    void props.state.send({ type, id: props.player.id });
  const latest = () => {
    const pod = props.manage.tournament.pods.find(p => p.playerIds.includes(props.player.id));
    return pod?.rounds.at(-1)?.number ?? 0;
  };
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
        <Show when={dropped() !== null && dropped() === latest()}>
          <button type='button' class='btn btn-ghost tm-small' onClick={() => send('undropPlayer')}>
            Reinstate
          </button>
        </Show>
        <Show when={dropped() !== null && dropped() !== latest()}>
          <span class='muted-cell'>Dropped after round {dropped()}</span>
        </Show>
        <ConfirmAction
          label='Remove'
          question={`Remove ${playerName(props.player)}?`}
          danger
          onConfirm={() => send('removePlayer')}
        />
      </span>
    </td>
  );
}

/** A player's results so far, one mark per round of their pod. */
function marksOf(tournament: Tournament, player: Player): { marks: string[]; rounds: number } {
  const pod = tournament.pods.find(p => p.playerIds.includes(player.id));
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
}

function PlayerRow(props: RowProps) {
  const swiss = () => props.manage.mode === 'swiss';
  const sanctioned = () => isSanctioned(props.manage);
  const sub = () =>
    [
      sanctioned() ? props.player.id : '',
      sanctioned() ? DIVISION_LABELS[divisionFor(props.player.birthDate, props.season)] : ''
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
        <DeckCell state={props.state} manage={props.manage} player={props.player} />
      </Show>
      <Show
        when={swiss()}
        fallback={
          <td class='tm-extra-col muted-cell'>
            <Show when={props.player.droppedAfter !== null}>Dropped after round {props.player.droppedAfter}</Show>
          </td>
        }
      >
        <FixedTableCell state={props.state} player={props.player} />
        <PlayerActions state={props.state} manage={props.manage} player={props.player} />
      </Show>
    </tr>
  );
}

export function PlayersPanel(props: { state: ManageState; manage: Manage }) {
  const [, setParams] = useSearchParams<{ tab?: string }>();
  const [query, setQuery] = createSignal('');
  const season = () => seasonOf(parseTomDate(props.manage.tournament.info.startDate) ?? new Date());
  const swiss = () => props.manage.mode === 'swiss';
  const sanctioned = () => isSanctioned(props.manage);
  const started = () => props.manage.tournament.pods.some(pod => pod.rounds.length > 0);
  const archetypes = () => decksEnabled(props.manage.settings);
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
                    Table
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
