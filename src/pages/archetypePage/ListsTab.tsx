import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';
import { CardImage } from '../../components/CardImage';
import { CopyDeckButton } from '../../components/CopyDeckButton';
import { DeckBody, type DeckBodyCard } from '../../components/DeckBody';
import { Skeleton } from '../../components/Skeleton';
import { ordinal, shortDate } from '../../lib/format';
import type { ListRecord } from '../../lib/data/lists';
import type { ListsState } from './listsControls';
import {
  type ArchetypeList,
  collapseSame60,
  filterLists,
  type OddSlot,
  oddSlots,
  type Same60Group,
  type SlotStats,
  slotStats,
  techCandidates,
  tierLists
} from './listsModel';
import '../../styles/pages/archetype-lists.css';

/** Builds shown before "Show more", and how many each press adds. */
const FIRST_PAGE = 25;
const PAGE_STEP = 50;
/** Techs shown as art in a row before "+N". */
const ROW_TECHS = 3;
/** Same-60 pilots listed under an opened deck before their own "Show more". */
const SAME60_FIRST = 3;

interface ListsTabProps {
  label: string;
  /** Every list of the archetype; undefined while loading. */
  lists: ArchetypeList[] | undefined;
  state: ListsState;
}

/**
 * The Lists tab: every published list of the archetype, identical 60s folded
 * together, best finish first. Each row marks the slots that are unusual for
 * this archetype and opens to the decklist, with the pilots who ran the same
 * 60 listed under it.
 */
// Default export for the page's lazy import.
export default function ListsTab(props: ListsTabProps) {
  const stats = createMemo(() => slotStats(props.lists ?? []));
  const tiered = createMemo(() => tierLists(props.lists ?? [], props.state.filters()));
  const shown = createMemo(() => filterLists(props.lists ?? [], props.state.filters()));
  const groups = createMemo(() => collapseSame60(shown()));
  const oneEvent = createMemo(() => new Set((props.lists ?? []).map(l => l.record.event?.id ?? '')).size <= 1);

  return (
    <Show when={props.lists} fallback={<Skeleton height='320px' />}>
      <Show when={props.state.techsOpen()}>
        <TechStrip lists={tiered()} state={props.state} />
      </Show>
      <div class='lists-head'>
        <h2>
          Lists{' '}
          <span class='count'>
            {shown().length.toLocaleString()}
            <Show when={groups().length < shown().length}> · {groups().length.toLocaleString()} distinct 60s</Show>
          </span>
        </h2>
        <span class='lists-note'>
          Marked: a card at a count in under {stats().bar}% of {props.label} lists.
        </span>
      </div>
      <Show
        when={groups().length > 0}
        fallback={<p class='lists-empty'>{emptyMessage(props.lists!.length, props.state)}</p>}
      >
        <ListsTable groups={groups()} stats={stats()} oneEvent={oneEvent()} techs={props.state.techs()} />
      </Show>
    </Show>
  );
}

function emptyMessage(total: number, state: ListsState): string {
  if (total === 0) {
    return 'No published lists for this archetype in this scope.';
  }
  return state.techs().size > 0 ? 'No lists run every picked tech.' : 'No lists in this finish tier.';
}

/** The tech filter: the cards that vary across the tier's lists, as art. Picks combine. */
function TechStrip(props: { lists: ArchetypeList[]; state: ListsState }) {
  const candidates = createMemo(() => {
    const found = techCandidates(props.lists);
    const listed = new Set(found.map(t => t.name));
    const kept = [...props.state.picked().values()]
      .filter(card => !listed.has(card.name))
      .map(card => ({ name: card.name, card, share: 0 }));
    return [...kept, ...found];
  });
  return (
    <div class='lists-techs' id='lists-techs'>
      <Show when={candidates().length > 0} fallback={<p class='lists-empty'>No techs in this tier.</p>}>
        <div class='lists-frames' role='group' aria-label='Techs'>
          <For each={candidates()}>
            {t => (
              <button
                type='button'
                class='lists-frame'
                classList={{ 'is-picked': props.state.techs().has(t.name) }}
                aria-pressed={props.state.techs().has(t.name)}
                title={`${t.name} · in ${Math.round(t.share)}% of lists`}
                onClick={() => props.state.toggleTech(t.card)}
              >
                <CardImage set={t.card.set} number={t.card.number} size='xs' alt={t.name} />
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

function ListsTable(props: { groups: Same60Group[]; stats: SlotStats; oneEvent: boolean; techs: ReadonlySet<string> }) {
  const [limit, setLimit] = createSignal(FIRST_PAGE);
  const [open, setOpen] = createSignal<ReadonlySet<string>>(new Set());
  const toggle = (key: string) =>
    setOpen(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  const columns = () => (props.oneEvent ? 3 : 4);
  return (
    <div class='table-wrap lists-table' classList={{ 'is-one-event': props.oneEvent }}>
      <table class='data'>
        <thead>
          <tr>
            <th class='lists-col-finish'>Finish</th>
            <th class='lists-col-pilot'>Pilot</th>
            <Show when={!props.oneEvent}>
              <th class='lists-col-event'>Event</th>
            </Show>
            <th class='lists-col-techs'>Techs</th>
          </tr>
        </thead>
        <tbody>
          <For each={props.groups.slice(0, limit())}>
            {group => (
              <GroupRows
                group={group}
                stats={props.stats}
                oneEvent={props.oneEvent}
                techs={props.techs}
                columns={columns()}
                open={open().has(group.face.key)}
                onToggle={() => toggle(group.face.key)}
              />
            )}
          </For>
          <Show when={props.groups.length > limit()}>
            <tr class='lists-foot'>
              <td colSpan={columns()}>
                <button type='button' class='lists-linkbtn' onClick={() => setLimit(n => n + PAGE_STEP)}>
                  Show more
                </button>{' '}
                <span class='lists-showing'>
                  {limit().toLocaleString()} of {props.groups.length.toLocaleString()}
                </span>
              </td>
            </tr>
          </Show>
        </tbody>
      </table>
    </div>
  );
}

interface GroupRowsProps {
  group: Same60Group;
  stats: SlotStats;
  oneEvent: boolean;
  techs: ReadonlySet<string>;
  columns: number;
  open: boolean;
  onToggle: () => void;
}

function GroupRows(props: GroupRowsProps) {
  const record = () => props.group.face.record;
  const odd = createMemo(() => oddSlots(record(), props.stats));
  const detailId = () => `lists-detail-${props.group.face.key.replace(':', '-')}`;
  const onKey: JSX.EventHandler<HTMLTableRowElement, KeyboardEvent> = e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      props.onToggle();
    }
  };
  return (
    <>
      <tr
        class='is-link lists-row'
        classList={{ 'is-open': props.open }}
        tabIndex={0}
        aria-expanded={props.open}
        aria-controls={detailId()}
        onClick={() => props.onToggle()}
        onKeyDown={onKey}
      >
        <td class='lists-finish'>
          <Finish record={record()} />
        </td>
        <td class='lists-pilot'>{record().player}</td>
        <Show when={!props.oneEvent}>
          <td class='lists-event'>
            <EventCell record={record()} />
          </td>
        </Show>
        <td class='lists-techs-cell'>
          <OddArt slots={odd()} />
        </td>
      </tr>
      <Show when={props.open}>
        <tr class='lists-detail' id={detailId()}>
          <td colSpan={props.columns}>
            <ListDetail group={props.group} odd={odd()} techs={props.techs} oneEvent={props.oneEvent} />
          </td>
        </tr>
      </Show>
    </>
  );
}

function Finish(props: { record: ListRecord }) {
  return (
    <Show when={props.record.placement > 0} fallback={<span class='lists-of'>Unplaced</span>}>
      <b>{ordinal(props.record.placement)}</b>
      <Show when={props.record.event?.players}>
        {players => <span class='lists-of'> of {players().toLocaleString()}</span>}
      </Show>
    </Show>
  );
}

function EventCell(props: { record: ListRecord }) {
  return (
    <Show when={props.record.event}>
      {ev => (
        <>
          <span class='lists-event-name'>{ev().name}</span>
          <span class='lists-date'>{shortDate(ev().date ? new Date(`${ev().date}T12:00:00Z`) : null)}</span>
        </>
      )}
    </Show>
  );
}

/** The row's marked slots as small art, each with its count; a dash for a stock list. */
function OddArt(props: { slots: OddSlot[] }) {
  const hidden = () => props.slots.length - ROW_TECHS;
  return (
    <Show when={props.slots.length > 0} fallback={<span class='lists-none'>—</span>}>
      <span class='lists-odd'>
        <For each={props.slots.slice(0, ROW_TECHS)}>
          {slot => (
            <span
              class='lists-odd-card'
              title={`${slot.card.count}× ${slot.card.name} · in ${Math.round(slot.share)}% of lists`}
            >
              <CardImage set={slot.card.set} number={slot.card.number} size='xs' alt={slot.card.name} />
              <b class='lists-odd-count'>{slot.card.count}×</b>
            </span>
          )}
        </For>
        <Show when={hidden() > 0}>
          <span class='lists-odd-more'>+{hidden()}</span>
        </Show>
      </span>
    </Show>
  );
}

function ListDetail(props: { group: Same60Group; odd: OddSlot[]; techs: ReadonlySet<string>; oneEvent: boolean }) {
  const record = () => props.group.face.record;
  const marked = createMemo(() => new Set(props.odd.map(s => `${s.card.name}|${s.card.count}`)));
  const highlight = (c: DeckBodyCard) => marked().has(`${c.name}|${c.count}`) || props.techs.has(c.name);
  return (
    <div class='lists-body'>
      <DeckBody cards={record().cards} highlight={highlight} />
      <div class='lists-body-foot'>
        <CopyDeckButton cards={record().cards} />
        <Show when={props.group.face.venue === 'online' && record().event}>
          {ev => (
            <a href={`https://play.limitlesstcg.com/tournament/${ev().id}/standings`} target='_blank' rel='noopener'>
              Standings ↗
            </a>
          )}
        </Show>
      </div>
      <Show when={props.group.others.length > 0}>
        <Same60 others={props.group.others} oneEvent={props.oneEvent} />
      </Show>
    </div>
  );
}

/** Everyone else who ran this exact 60, one row each, best finish first. */
function Same60(props: { others: ArchetypeList[]; oneEvent: boolean }) {
  const [all, setAll] = createSignal(false);
  const shown = () => (all() ? props.others : props.others.slice(0, SAME60_FIRST));
  return (
    <div class='lists-same'>
      <h3>
        Same 60 <span class='count'>{props.others.length.toLocaleString()} more pilots</span>
      </h3>
      <For each={shown()}>
        {list => (
          <div class='lists-same-row'>
            <span class='lists-finish'>
              <Finish record={list.record} />
            </span>
            <span class='lists-pilot'>{list.record.player}</span>
            <Show when={!props.oneEvent}>
              <span class='lists-event'>
                <EventCell record={list.record} />
              </span>
            </Show>
          </div>
        )}
      </For>
      <Show when={props.others.length > SAME60_FIRST}>
        <button type='button' class='lists-linkbtn' onClick={() => setAll(v => !v)}>
          {all() ? 'Show fewer' : `Show ${(props.others.length - SAME60_FIRST).toLocaleString()} more`}
        </button>
      </Show>
    </div>
  );
}
