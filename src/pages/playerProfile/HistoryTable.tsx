import { A } from '@solidjs/router';
import { createSignal, For, Show } from 'solid-js';
import { ArchetypeIcons } from '../../components/ArchetypeIcon';
import type { SkeletonColumn } from '@ciphermaniac/design/components/TableSkeleton';
import { Badge } from '../../components/Badge';
import { getArchetypeIconMap, resolveArchetypeIcons } from '../../lib/data';
import { nameFromTournamentKey, ordinalSuffix } from '../../lib/format';
import type { PlayerTournamentEntry } from '../../types';
import { EventDetail, type EventDetailSource } from './EventDetail';
import { finishLabel, shortTournamentName, tournamentDateLabel } from './model';

interface HistoryTableProps {
  entries: PlayerTournamentEntry[];
  archetypeName: (base: string | null) => string;
  playerId: string;
  source: EventDetailSource;
  /** The Decks tab groups rows under their deck, so it drops the column. */
  showDeck?: boolean;
  /** The id of the heading the table sits under. */
  labelledBy?: string;
}

/** The table's columns, shared with its loading skeleton; the Decks tab drops Deck. */
export function historyColumns(showDeck: boolean): SkeletonColumn[] {
  const deck = showDeck ? [{ label: 'Deck', class: 'history-deck col-secondary', width: '96px' }] : [];
  return [
    { label: '', class: 'num expand-col' },
    { label: 'Event', class: 'col-name', width: '55%' },
    ...deck,
    { label: 'Finish', class: 'num history-finish', width: '32px' },
    { label: 'Record', class: 'num history-record', width: '32px' },
    { label: 'Day 2', class: 'history-day2 col-secondary', width: '56px' }
  ];
}

/**
 * A player's events, newest first. Every row opens to its decklist and rounds.
 * On a phone the same table keeps three columns: event, finish, record.
 */
export function HistoryTable(props: HistoryTableProps) {
  const showDeck = () => props.showDeck !== false;
  const columnCount = () => (showDeck() ? 6 : 5);
  return (
    <div class='table-wrap history-table'>
      <table class='data' aria-labelledby={props.labelledBy}>
        <thead>
          <tr>
            <For each={historyColumns(showDeck())}>
              {column => (
                <th class={column.class} aria-label={column.label ? undefined : 'Expand'}>
                  {column.label}
                </th>
              )}
            </For>
          </tr>
        </thead>
        <tbody>
          <For each={props.entries}>
            {entry => (
              <HistoryRow
                entry={entry}
                archetypeName={props.archetypeName(entry.archetype)}
                playerId={props.playerId}
                source={props.source}
                showDeck={showDeck()}
                columnCount={columnCount()}
              />
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}

interface HistoryRowProps {
  entry: PlayerTournamentEntry;
  archetypeName: string;
  playerId: string;
  source: EventDetailSource;
  showDeck: boolean;
  columnCount: number;
}

function HistoryRow(props: HistoryRowProps) {
  const [expanded, setExpanded] = createSignal(false);
  const iconMap = getArchetypeIconMap();
  const slugs = () => resolveArchetypeIcons({ name: props.archetypeName }, iconMap);
  const toggle = () => {
    const next = !expanded();
    setExpanded(next);
    if (next) {
      props.source.ensure();
    }
  };

  return (
    <>
      <tr class='is-link' classList={{ 'is-open': expanded() }} onClick={toggle}>
        <td class='num expand-col'>
          {/* No handler: the click bubbles to the row's toggle. */}
          <button
            type='button'
            class='row-caret'
            classList={{ open: expanded() }}
            aria-expanded={expanded()}
            aria-label={expanded() ? 'Hide details' : 'Show details'}
          >
            ▸
          </button>
        </td>
        <th scope='row' class='history-name col-name'>
          <span class='history-event'>
            <Show when={props.entry.archetype}>
              <ArchetypeIcons slugs={slugs()} size={16} />
            </Show>
            <span class='cardname history-full'>{nameFromTournamentKey(props.entry.tournamentId)}</span>
            <span class='cardname history-short'>{shortTournamentName(props.entry.tournamentId)}</span>
          </span>
          <span class='muted-cell history-date'> · {tournamentDateLabel(props.entry.tournamentId)}</span>
        </th>
        <Show when={props.showDeck}>
          <td class='muted-cell history-deck col-secondary'>
            <Show when={props.entry.archetype} fallback='—'>
              <span class='arche-name-cell'>
                <ArchetypeIcons slugs={slugs()} size={16} reserveSlot />
                <A
                  href={`/archetypes/${encodeURIComponent(props.entry.archetype ?? '')}`}
                  onClick={e => e.stopPropagation()}
                >
                  {props.archetypeName}
                </A>
              </span>
            </Show>
          </td>
        </Show>
        <td class='num history-finish'>
          <span class='finish-place'>
            <Show when={props.entry.placement} fallback='—'>
              {props.entry.placement!.toLocaleString()}
              {ordinalSuffix(props.entry.placement!)}
            </Show>
            <Show when={props.entry.totalPlayers}>
              <span class='muted-cell'> / {props.entry.totalPlayers!.toLocaleString()}</span>
            </Show>
          </span>
          <span class='finish-share' classList={{ 'is-cut': props.entry.madeTopCut }}>
            {finishLabel(props.entry)}
          </span>
        </td>
        <td class='num history-record'>
          {props.entry.wins}-{props.entry.losses}-{props.entry.ties}
        </td>
        {/* A badge on every Day 2 was a pill in most rows of a long career —
            loud, and it left nothing for the rare result to stand out with.
            Only the top cut is badged; Day 2 is plain text, and an event that
            reached neither is left blank rather than dashed, so the column
            reads as marks against a quiet field instead of forty repetitions. */}
        <td class='history-day2 col-secondary'>
          <Show when={props.entry.madeTopCut} fallback={<Show when={props.entry.madePhase2}>Day 2</Show>}>
            <Badge variant='regulation'>Top cut</Badge>
          </Show>
        </td>
      </tr>
      <Show when={expanded()}>
        <tr class='row-expansion'>
          <td colspan={props.columnCount}>
            <EventDetail entry={props.entry} playerId={props.playerId} source={props.source} />
          </td>
        </tr>
      </Show>
    </>
  );
}
