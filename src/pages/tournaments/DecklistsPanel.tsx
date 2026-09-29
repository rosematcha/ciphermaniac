/**
 * Decklists players submitted ahead of the event, in one box: a bar saying
 * whether submission is open (with the counts, and the control to open or
 * close it), a search, then a row per list. Lists with problems lead, then
 * lists whose submitter is not on the player list, then the rest in the order
 * they came in. Staff read each list laid out by section with what the parser
 * found wrong, add a submitter the site could not add, and take a player's
 * word for their deck.
 *
 * Players need no account, and submitting a list adds a submitter who is not
 * yet on a Swiss event's list; those players carry an "Added from list" flag.
 */

import { A } from '@solidjs/router';
import { createMemo, createResource, createSignal, For, Show } from 'solid-js';
import { birthYear } from '../../../shared/tournament/divisions';
import { type DeckSection, parseDecklist } from '../../../shared/tournament/decklist';
import { decklistPlayer } from '../../../shared/tournament/identify';
import { decksEnabled, isSanctioned } from '../../../shared/tournament/view';
import { type Decklist, fetchDecklists, type Manage, saveSettings, setDeck } from '../../lib/tournament/api';
import { latestValue } from '../../lib/resource';
import { DeckIcons } from './DeckIcons';
import type { ManageState } from './manageState';

const SECTIONS: { section: DeckSection; label: string }[] = [
  { section: 'pokemon', label: 'Pokémon' },
  { section: 'trainer', label: 'Trainer' },
  { section: 'energy', label: 'Energy' }
];

const submittedAt = (at: number) =>
  new Date(at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });

/** Why a submitter is not on the player list: the site only adds them to a Swiss event still open. */
function notEnteredReason(manage: Manage): string {
  if (manage.mode === 'tom') {
    return 'Roster is TOM’s';
  }
  return manage.settings.finished ? 'Event closed' : 'Not on the player list';
}

/** The list as it was pasted, laid out by section with each section's count. */
function ListColumns(props: { deck: string }) {
  const parsed = () => parseDecklist(props.deck);
  return (
    <div class='tm-list-columns'>
      <For each={SECTIONS}>
        {s => {
          const cards = () => parsed().cards.filter(card => card.section === s.section);
          return (
            <div>
              <p class='tm-list-head'>
                {s.label}: {cards().reduce((sum, card) => sum + card.count, 0)}
              </p>
              <ul class='tm-list-cards'>
                <For each={cards()}>
                  {card => (
                    <li>
                      {card.count} {card.name} {card.set} {card.number}
                    </li>
                  )}
                </For>
              </ul>
            </div>
          );
        }}
      </For>
      <Show when={parsed().unread.length > 0}>
        <div>
          <p class='tm-list-head'>Not read</p>
          <ul class='tm-list-cards tm-problem'>
            <For each={parsed().unread}>{line => <li>{line}</li>}</For>
          </ul>
        </div>
      </Show>
    </div>
  );
}

interface RowProps {
  state: ManageState;
  manage: Manage;
  list: Decklist;
  open: boolean;
  onToggle: () => void;
  onChanged: () => void;
}

function DecklistRow(props: RowProps) {
  const sanctioned = () => isSanctioned(props.manage);
  const playerId = () => decklistPlayer(props.manage.tournament, props.list, sanctioned());
  const archetypes = () => decksEnabled(props.manage.settings);
  const sub = () =>
    [
      archetypes() ? (props.list.archetype ?? 'No deck named') : '',
      sanctioned() ? props.list.popId : '',
      sanctioned() ? (birthYear(props.list.birthDate) ?? '') : ''
    ]
      .filter(Boolean)
      .join(' · ');
  /** The player's word for their deck becomes the one the event shows; staff decide it is theirs. */
  function useDeck() {
    const { code } = props.manage;
    const id = playerId();
    const { archetype } = props.list;
    if (id) {
      void props.state.run(() => setDeck(code, id, archetype));
    }
  }
  async function add() {
    const ok = await props.state.send({
      type: 'addPlayer',
      player: {
        firstName: props.list.firstName,
        lastName: props.list.lastName,
        ...(sanctioned() ? { id: props.list.popId, birthDate: props.list.birthDate } : {})
      }
    });
    if (ok) {
      props.onChanged();
    }
  }
  const canUseDeck = () =>
    archetypes() && playerId() && props.list.archetype && props.manage.decks[playerId() ?? ''] !== props.list.archetype;
  return (
    <>
      <tr>
        <td class='tm-list-sprite'>
          <Show when={archetypes()}>
            <DeckIcons label={props.list.archetype ?? undefined} />
          </Show>
        </td>
        <td class='tm-who'>
          <span class='tm-who-name'>
            <span class='tm-name'>
              {props.list.firstName} {props.list.lastName}
            </span>
            <Show when={props.list.fromList}>
              <span class='tm-flag'>Added from list</span>
            </Show>
            <Show when={!playerId()}>
              <span class='tm-flag'>Not entered</span>
            </Show>
          </span>
          <span class='tm-who-sub tm-num'>
            {sub()}
            <Show when={!playerId()}>
              {sub() ? ' · ' : ''}
              {notEnteredReason(props.manage)}
            </Show>
          </span>
        </td>
        <td class='muted-cell tm-num tm-nowrap tm-list-when'>{submittedAt(props.list.submittedAt)}</td>
        <td class='tm-list-check'>
          <Show when={props.list.problems.length} fallback={<span class='muted-cell'>OK</span>}>
            <span class='tm-problem'>{props.list.problems.join('; ')}</span>
          </Show>
        </td>
        <td class='tm-extra-col'>
          <span class='tm-row-actions'>
            <button
              type='button'
              class='btn btn-ghost tm-small'
              aria-expanded={props.open}
              onClick={() => props.onToggle()}
            >
              {props.open ? 'Hide' : 'View'}
            </button>
            <Show when={props.manage.mode === 'swiss' && !playerId()}>
              <button type='button' class='btn btn-ghost tm-small' onClick={() => void add()}>
                Add to event
              </button>
            </Show>
            <Show when={canUseDeck()}>
              <button type='button' class='btn btn-ghost tm-small' onClick={useDeck}>
                Use their deck
              </button>
            </Show>
          </span>
        </td>
      </tr>
      <Show when={props.open}>
        <tr class='tm-expansion'>
          <td colSpan={5}>
            <ListColumns deck={props.list.deck} />
          </td>
        </tr>
      </Show>
    </>
  );
}

/** Whether a list is its submitter's, by name, Player ID or deck, for the search. */
function listMatches(list: Decklist, query: string): boolean {
  const q = query.trim().toLowerCase();
  return (
    !q ||
    `${list.firstName} ${list.lastName}`.toLowerCase().includes(q) ||
    list.popId.includes(q) ||
    (list.archetype ?? '').toLowerCase().includes(q)
  );
}

/** Problems first, then submitters not on the list, then the rest in the order they came in. */
function ordered(lists: readonly Decklist[], manage: Manage): Decklist[] {
  const rank = (list: Decklist) => {
    if (list.problems.length > 0) {
      return 0;
    }
    return decklistPlayer(manage.tournament, list, isSanctioned(manage)) ? 2 : 1;
  };
  return [...lists].sort((a, b) => rank(a) - rank(b) || a.submittedAt - b.submittedAt);
}

export function DecklistsPanel(props: { state: ManageState; manage: Manage }) {
  const [lists, { refetch }] = createResource(
    () => props.manage.code,
    code => fetchDecklists(code).then(result => result.decklists)
  );
  const [query, setQuery] = createSignal('');
  const [open, setOpen] = createSignal<string | null>(null);
  const all = () => latestValue(lists) ?? [];
  const shown = createMemo(() =>
    ordered(
      all().filter(list => listMatches(list, query())),
      props.manage
    )
  );
  const counts = () => {
    const withProblems = all().filter(list => list.problems.length > 0).length;
    const notIn = all().filter(list => !list.registered).length;
    const fromList = all().filter(list => list.fromList).length;
    const last = all().reduce((max, list) => Math.max(max, list.submittedAt), 0);
    return [
      `${all().length} list${all().length === 1 ? '' : 's'}`,
      ...(withProblems ? [`${withProblems} with problems`] : []),
      ...(notIn ? [`${notIn} not entered`] : []),
      ...(fromList ? [`${fromList} added from lists`] : []),
      ...(last ? [`last ${submittedAt(last)}`] : [])
    ].join(' · ');
  };
  const key = (list: Decklist) => `${list.popId}|${list.firstName}|${list.lastName}`;
  function toggle() {
    const { code } = props.manage;
    const decklistsOpen = !props.manage.settings.decklistsOpen;
    void props.state.run(() => saveSettings(code, { decklistsOpen }));
  }
  return (
    <div class='tm-panel'>
      <section class='tm-box'>
        <div class='tm-box-bar'>
          <strong>{props.manage.settings.decklistsOpen ? 'Submission open' : 'Submission closed'}</strong>
          <span class='muted tm-num'>{counts()}</span>
          <A class='tm-bar-link' href={`/t/${props.manage.code}?tab=decklist`}>
            Submit decklist page
          </A>
          <span class='tm-grow' />
          <button type='button' class='btn btn-secondary tm-small' disabled={props.state.busy()} onClick={toggle}>
            {props.manage.settings.decklistsOpen ? 'Close submission' : 'Open submission'}
          </button>
        </div>
        <div class='tm-box-bar'>
          <input
            class='search'
            type='search'
            placeholder='Search lists'
            aria-label='Search lists'
            value={query()}
            onInput={e => setQuery(e.currentTarget.value)}
          />
        </div>
        <Show when={all().length} fallback={<p class='muted tm-empty'>No decklists yet.</p>}>
          <div class='table-wrap'>
            <table class='data tm-lists'>
              <thead>
                <tr>
                  <th class='tm-list-sprite'>
                    <span class='sr-only'>Deck</span>
                  </th>
                  <th>Player</th>
                  <th>Submitted</th>
                  <th>Check</th>
                  <th>
                    <span class='sr-only'>Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <For each={shown()}>
                  {list => (
                    <DecklistRow
                      state={props.state}
                      manage={props.manage}
                      list={list}
                      open={open() === key(list)}
                      onToggle={() => setOpen(open() === key(list) ? null : key(list))}
                      onChanged={() => void refetch()}
                    />
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </Show>
      </section>
    </div>
  );
}
