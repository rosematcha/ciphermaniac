import { createMemo, createSignal, For, Show } from 'solid-js';
import { ArchetypeIcons } from '../../components/ArchetypeIcon';
import { getArchetypeIconMap, resolveArchetypeIcons } from '../../lib/data';
import { ordinalSuffix } from '../../lib/format';
import type { PlayerArchetypeBreakdown, PlayerProfile } from '../../types';
import type { EventDetailSource } from './EventDetail';
import { HistoryTable } from './HistoryTable';
import { winRateWhole } from './model';

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
  const winRate = createMemo(() => winRateWhole(props.archetype.wins, props.archetype.losses));
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
        <span class='deck-group-name'>{props.name}</span>
        {/* Five figures set inline ran together into one sentence of numbers,
            and started at a different x in every group. One slot each, fixed
            width, so they read as a column down the page. */}
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
            <b>{winRate() == null ? '—' : `${winRate()}%`}</b>
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
          />
        </div>
      </Show>
    </section>
  );
}
