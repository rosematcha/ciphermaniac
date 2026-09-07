import { A } from '@solidjs/router';
import { createSignal, For, Show } from 'solid-js';
import { ArchetypeIcons } from '../../components/ArchetypeIcon';
import { Badge } from '../../components/Badge';
import { getArchetypeIconMap, resolveArchetypeIcons } from '../../lib/data';
import { nameFromTournamentKey, ordinalSuffix } from '../../lib/format';
import type { PlayerTournamentEntry } from '../../types';
import { EventDetail, type EventDetailSource } from './EventDetail';
import { finishLabel, shortTournamentName, tournamentDateLabel } from './model';

interface HistoryTableProps {
  entries: PlayerTournamentEntry[];
  archetypeName: (base: string | null) => string;
  source: EventDetailSource;
  /** The Decks tab groups rows under their deck, so it drops the column. */
  showDeck?: boolean;
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
      <table class='data'>
        <thead>
          <tr>
            <th class='num expand-col' aria-label='Expand' />
            <th>Event</th>
            <Show when={showDeck()}>
              <th class='history-deck'>Deck</th>
            </Show>
            <th class='num history-finish'>Finish</th>
            <th class='num history-record'>Record</th>
            <th class='history-day2'>Day 2</th>
          </tr>
        </thead>
        <tbody>
          <For each={props.entries}>
            {entry => (
              <HistoryRow
                entry={entry}
                archetypeName={props.archetypeName(entry.archetype)}
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
      <tr class='is-link' classList={{ open: expanded() }} onClick={toggle}>
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
        <td class='history-name'>
          <span class='history-event'>
            <Show when={props.entry.archetype}>
              <ArchetypeIcons slugs={slugs()} size={16} />
            </Show>
            <span class='cardname history-full'>{nameFromTournamentKey(props.entry.tournamentId)}</span>
            <span class='cardname history-short'>{shortTournamentName(props.entry.tournamentId)}</span>
          </span>
          <span class='muted-cell history-date'> · {tournamentDateLabel(props.entry.tournamentId)}</span>
        </td>
        <Show when={props.showDeck}>
          <td class='muted-cell history-deck'>
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
        <td class='history-day2'>
          <Show when={props.entry.madeTopCut} fallback={<Show when={props.entry.madePhase2}>Day 2</Show>}>
            <Badge variant='regulation'>Top cut</Badge>
          </Show>
        </td>
      </tr>
      <Show when={expanded()}>
        <tr class='row-expansion'>
          <td colspan={props.columnCount}>
            <EventDetail entry={props.entry} archetypeName={props.archetypeName} source={props.source} />
          </td>
        </tr>
      </Show>
    </>
  );
}
