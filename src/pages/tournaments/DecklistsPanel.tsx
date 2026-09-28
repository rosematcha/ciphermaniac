/**
 * Decklists players submitted ahead of the event. Staff open and close
 * submission, read each list with what the parser found wrong with it, and on
 * a Swiss event add a submitter to the player list in one press.
 */

import { createResource, createSignal, For, Show } from 'solid-js';
import { birthYear } from '../../../shared/tournament/divisions';
import { decksEnabled } from '../../../shared/tournament/view';
import { type Decklist, fetchDecklists, type Manage, saveSettings, setDeck } from '../../lib/tournament/api';
import { latestValue } from '../../lib/resource';
import { DeckIcons } from './DeckIcons';
import type { ManageState } from './manageState';

function DecklistRow(props: { state: ManageState; manage: Manage; list: Decklist; onChanged: () => void }) {
  const [open, setOpen] = createSignal(false);
  const inEvent = () => props.manage.tournament.players.some(p => p.id === props.list.popId);
  const archetypes = () => decksEnabled(props.manage.settings);
  /** The player's word for their deck becomes the one the event shows; staff decide it is theirs. */
  function useDeck() {
    const { code } = props.manage;
    const { popId, archetype } = props.list;
    void props.state.run(() => setDeck(code, popId, archetype));
  }

  async function add() {
    const ok = await props.state.send({
      type: 'addPlayer',
      player: {
        firstName: props.list.firstName,
        lastName: props.list.lastName,
        id: props.list.popId,
        birthDate: props.list.birthDate
      }
    });
    if (ok) {
      props.onChanged();
    }
  }
  return (
    <>
      <tr>
        <td class='tm-nowrap'>
          {props.list.firstName} {props.list.lastName}
        </td>
        <td class='num muted-cell'>{props.list.popId}</td>
        <td class='num muted-cell'>{birthYear(props.list.birthDate) ?? ''}</td>
        <Show when={archetypes()}>
          <td>
            <span class='tm-seat-inner'>
              <DeckIcons label={props.list.archetype ?? undefined} />
              <span>{props.list.archetype ?? ''}</span>
            </span>
          </td>
        </Show>
        <td>
          <Show when={props.list.problems.length} fallback={<span class='muted-cell'>OK</span>}>
            <span class='tm-problem'>{props.list.problems.join('; ')}</span>
          </Show>
        </td>
        <td class='tm-extra-col'>
          <span class='tm-row-actions'>
            <button
              type='button'
              class='btn btn-ghost tm-small'
              aria-expanded={open()}
              onClick={() => setOpen(!open())}
            >
              {open() ? 'Hide' : 'View'}
            </button>
            <Show when={props.manage.mode === 'swiss' && !inEvent()}>
              <button type='button' class='btn btn-secondary tm-small' onClick={() => void add()}>
                Add to event
              </button>
            </Show>
            <Show
              when={inEvent() && props.list.archetype && props.manage.decks[props.list.popId] !== props.list.archetype}
            >
              <button type='button' class='btn btn-ghost tm-small' onClick={useDeck}>
                Use their deck
              </button>
            </Show>
          </span>
        </td>
      </tr>
      <Show when={open()}>
        <tr class='tm-expansion'>
          <td colSpan={decksEnabled(props.manage.settings) ? 6 : 5}>
            <pre class='tm-decklist'>{props.list.deck}</pre>
          </td>
        </tr>
      </Show>
    </>
  );
}

export function DecklistsPanel(props: { state: ManageState; manage: Manage }) {
  const [lists, { refetch }] = createResource(
    () => props.manage.code,
    code => fetchDecklists(code).then(result => result.decklists)
  );
  function toggle() {
    const { code } = props.manage;
    const decklistsOpen = !props.manage.settings.decklistsOpen;
    void props.state.run(() => saveSettings(code, { decklistsOpen }));
  }
  return (
    <div class='tm-panel'>
      <div class='tm-toolbar'>
        <button type='button' class='btn btn-secondary' disabled={props.state.busy()} onClick={toggle}>
          {props.manage.settings.decklistsOpen ? 'Close submission' : 'Open submission'}
        </button>
        <span class='muted'>
          {props.manage.settings.decklistsOpen ? 'Players can submit decklists' : 'Submission is closed'}
        </span>
      </div>
      <Show when={latestValue(lists)?.length} fallback={<p class='muted'>No decklists yet.</p>}>
        <div class='table-wrap'>
          <table class='data'>
            <thead>
              <tr>
                <th>Player</th>
                <th class='num'>Player ID</th>
                <th class='num'>Born</th>
                <Show when={decksEnabled(props.manage.settings)}>
                  <th>Deck</th>
                </Show>
                <th>Check</th>
                <th>
                  <span class='sr-only'>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <For each={latestValue(lists)}>
                {list => (
                  <DecklistRow state={props.state} manage={props.manage} list={list} onChanged={() => void refetch()} />
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>
    </div>
  );
}
