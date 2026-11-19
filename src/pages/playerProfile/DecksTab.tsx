import { createSignal, createUniqueId, For, Show } from 'solid-js';
import { Skeleton } from '@ciphermaniac/design/components/Skeleton';
import { TableSkeleton } from '@ciphermaniac/design/components/TableSkeleton';
import { ArchetypeIcons } from '../../components/ArchetypeIcon';
import { getArchetypeIconMap, resolveArchetypeIcons } from '../../lib/data';
import { formatPercent, ordinalSuffix } from '../../lib/format';
import type { PlayerArchetypeBreakdown, PlayerProfile } from '../../types';
import type { EventDetailSource } from './EventDetail';
import { historyColumns, HistoryTable } from './HistoryTable';

/** The first few groups open on arrival; the long tail stays folded. */
const OPEN_BY_DEFAULT = 3;

interface DecksTabProps {
  profile: PlayerProfile;
  archetypeName: (base: string | null) => string;
  playerId: string;
  source: EventDetailSource;
}

/**
 * The career by deck: one group per archetype, most played first, each with
 * its record and its events inside. Every event opens the same way as in
 * History.
 */
export function DecksTab(props: DecksTabProps) {
  return (
    <div class='deck-groups'>
      <For each={props.profile.archetypes}>
        {(archetype, index) => (
          <DeckGroup
            archetype={archetype}
            name={props.archetypeName(archetype.base)}
            entries={props.profile.tournaments.filter(t => t.archetype === archetype.base)}
            archetypeName={props.archetypeName}
            playerId={props.playerId}
            source={props.source}
            openByDefault={index() < OPEN_BY_DEFAULT}
          />
        )}
      </For>
    </div>
  );
}

/** The five figures' widths as they print, so the placeholders wrap where the figures will. */
const STAT_WIDTHS = ['55px', '110px', '108px', '54px', '56px'];
/** A 13px bar centred in the figures' 19.5px line. */
const STAT_LINE = { margin: '3.25px 0' };

/** The tab loading: groups open and folded as they will arrive, each head with its figures' line. */
export function DecksSkeleton() {
  return (
    <div class='deck-groups' aria-busy='true'>
      <For each={Array.from({ length: 5 })}>
        {(_, index) => (
          <section class='deck-group'>
            <div class='deck-group-head'>
              <Skeleton inline width='11px' height='11px' />
              <Skeleton inline width='38px' height='22px' />
              <span class='deck-group-name'>
                <Skeleton inline width='160px' height='1em' />
              </span>
              <span class='deck-group-stats'>
                <For each={STAT_WIDTHS}>
                  {(width, slot) => (
                    <span class='deck-group-stat' classList={{ 'is-record': slot() === 1 }}>
                      <Skeleton inline width={width} height='1em' style={STAT_LINE} />
                    </span>
                  )}
                </For>
              </span>
            </div>
            <Show when={index() < OPEN_BY_DEFAULT}>
              <div class='deck-group-body'>
                <TableSkeleton class='history-table' columns={historyColumns(false)} rows={5} />
              </div>
            </Show>
          </section>
        )}
      </For>
    </div>
  );
}

interface DeckGroupProps {
  archetype: PlayerArchetypeBreakdown;
  name: string;
  entries: PlayerProfile['tournaments'];
  archetypeName: (base: string | null) => string;
  playerId: string;
  source: EventDetailSource;
  openByDefault: boolean;
}

function DeckGroup(props: DeckGroupProps) {
  // eslint-disable-next-line solid/reactivity -- initial state only; the group owns its open flag after mount
  const [open, setOpen] = createSignal(props.openByDefault);
  const iconMap = getArchetypeIconMap();
  const nameId = createUniqueId();
  const games = () => props.archetype.wins + props.archetype.losses;
  const best = () => {
    const b = props.archetype.bestPlacement;
    return b == null ? '—' : b === 1 ? 'Won' : `${b.toLocaleString()}${ordinalSuffix(b)}`;
  };
  return (
    <section class='deck-group' classList={{ open: open() }}>
      <button type='button' class='deck-group-head' aria-expanded={open()} onClick={() => setOpen(v => !v)}>
        <span class='row-caret' classList={{ open: open() }} aria-hidden='true'>
          ▸
        </span>
        <ArchetypeIcons slugs={resolveArchetypeIcons({ name: props.name }, iconMap)} size={22} reserveSlot />
        <span class='deck-group-name' id={nameId}>
          {props.name}
        </span>
        {/* Five figures set inline ran together into one sentence of numbers,
            and started at a different x in every group. One slot each, at
            least a fixed width, so they read as a column down the page. */}
        <span class='deck-group-stats'>
          <span class='deck-group-stat'>
            <b>{props.archetype.eventCount}</b>
            <small>{props.archetype.eventCount === 1 ? 'event' : 'events'}</small>
          </span>
          <span class='deck-group-stat is-record'>
            <b>
              {props.archetype.wins}-{props.archetype.losses}-{props.archetype.ties}
            </b>
            <small>record</small>
          </span>
          <span class='deck-group-stat'>
            <b>{games() ? `${formatPercent((props.archetype.wins / games()) * 100)} · n=${games()}` : '—'}</b>
            <small>win</small>
          </span>
          <span class='deck-group-stat'>
            <b>{props.archetype.day2s}</b>
            <small>Day 2s</small>
          </span>
          <span class='deck-group-stat'>
            <b>{best()}</b>
            <small>best</small>
          </span>
        </span>
      </button>
      <Show when={open()}>
        <div class='deck-group-body'>
          <HistoryTable
            entries={props.entries}
            archetypeName={props.archetypeName}
            playerId={props.playerId}
            source={props.source}
            showDeck={false}
            labelledBy={nameId}
          />
        </div>
      </Show>
    </section>
  );
}
