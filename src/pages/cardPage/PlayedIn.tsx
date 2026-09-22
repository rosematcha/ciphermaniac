import { A } from '@solidjs/router';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { ArchetypeIcons } from '../../components/ArchetypeIcon';
import { DeckBody } from '../../components/DeckBody';
import { Segmented } from '../../components/Segmented';
import { getArchetypeIconMap, resolveArchetypeIcons } from '../../lib/data';
import { ONLINE } from '../../lib/data/paths';
import type { ListRecord } from '../../lib/data/lists';
import { buildCanonicalCardId } from '../../../shared/deckCardId';
import type { SynonymDatabase } from '../../../shared/data/cardIdentity.js';
import { buildPtcglDeck } from '../../utils/ptcglExport';
import { ordinal, shortDate } from '../../lib/format';
import type { CardItem } from '../../types';
import { type ArchetypeUsageRow, formatWholePct as fmtWholePct } from './model';
import {
  buildPlayedInGroups,
  type CardList,
  FINISH_OPTIONS,
  foldedCount,
  LISTS_PER_GROUP,
  LISTS_PER_GROUP_MORE,
  type PlayedInGroup
} from './playedInModel';

interface PlayedInProps {
  rows: ArchetypeUsageRow[];
  /** Every list running the card, or null when the report has no list index. */
  lists: CardList[] | null;
  /** Whether the report is a single event (the rows then drop the event column). */
  oneEvent: boolean;
  card: CardItem;
  cardUid: string | null;
  db: SynonymDatabase | null;
  tournament: string;
}

function useToggleSet<T>() {
  const [set, setSet] = createSignal<Set<T>>(new Set());
  const toggle = (key: T) =>
    setSet(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  return { has: (key: T) => set().has(key), toggle };
}

/**
 * "Played in": every archetype that plays the card as one row — its inclusion,
 * usual copy count and best finish — opening to the copy split and the lists
 * behind it. The finish control re-scopes the lists and the ranking; the block
 * folds after six archetypes when enough would hide to be worth it.
 */
export function PlayedIn(props: PlayedInProps) {
  const [finish, setFinish] = createSignal('all');
  const groups = createMemo(() => buildPlayedInGroups(props.rows, props.lists, finish()));
  const [unfolded, setUnfolded] = createSignal(false);
  const shown = createMemo(() => (unfolded() ? groups() : groups().slice(0, foldedCount(groups().length))));
  const hidden = createMemo(() => groups().length - foldedCount(groups().length));
  const open = useToggleSet<string>();

  return (
    <div class='card-section'>
      <div class='pi-head'>
        <h3>
          Played in <span class='count'>{groups().length}</span>
        </h3>
        <Show when={props.lists}>
          <Segmented options={FINISH_OPTIONS} selected={finish()} onSelect={setFinish} ariaLabel='Finish' />
        </Show>
      </div>
      <div class='au-block'>
        <For each={shown()}>
          {group => (
            <PlayedInRow
              group={group}
              open={open.has(group.usage.entry.name)}
              onToggle={() => open.toggle(group.usage.entry.name)}
              hasLists={props.lists !== null}
              oneEvent={props.oneEvent}
              card={props.card}
              cardUid={props.cardUid}
              db={props.db}
              tournament={props.tournament}
            />
          )}
        </For>
        <Show when={hidden() > 0}>
          <div class='pi-fold'>
            <button type='button' class='pi-linkbtn' onClick={() => setUnfolded(v => !v)}>
              {unfolded() ? 'Show fewer' : `Show ${hidden()} more archetypes`}
            </button>
          </div>
        </Show>
      </div>
    </div>
  );
}

interface RowProps {
  group: PlayedInGroup;
  open: boolean;
  onToggle: () => void;
  hasLists: boolean;
  oneEvent: boolean;
  card: CardItem;
  cardUid: string | null;
  db: SynonymDatabase | null;
  tournament: string;
}

function PlayedInRow(props: RowProps) {
  const entry = () => props.group.usage.entry;
  const best = () => props.group.lists[0];
  const detailId = () => `pi-detail-${entry().name.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  return (
    <div class='au-row pi-row' classList={{ 'is-open': props.open }}>
      <div
        class='au-head pi-arch'
        classList={{ 'no-lists': !props.hasLists }}
        onClick={e => {
          if (!(e.target as HTMLElement).closest('a')) {
            props.onToggle();
          }
        }}
      >
        <button
          type='button'
          class='au-chevron'
          aria-expanded={props.open}
          aria-controls={detailId()}
          aria-label={`${props.hasLists ? 'Lists' : 'Copy counts'} in ${entry().label}`}
        >
          ▶
        </button>
        <span class='au-name'>
          <ArchetypeIcons slugs={resolveArchetypeIcons(entry(), getArchetypeIconMap())} size={20} reserveSlot />
          <A href={`/archetypes/${encodeURIComponent(entry().name)}`}>{entry().label}</A>
        </span>
        <span class='au-pct'>{fmtWholePct(props.group.usage.item.pct ?? 0)}</span>
        <span class='au-modal'>
          <Show when={props.group.modal} keyed>
            {m => (
              <>
                <span class='au-chip'>{m.copies}×</span>
                <span class='au-modal-share'>in {fmtWholePct(m.percent ?? 0)}</span>
              </>
            )}
          </Show>
        </span>
        <Show when={props.hasLists}>
          <span class='pi-teaser' classList={{ 'is-hidden': props.open }}>
            <Show when={best()} keyed>
              {b => (
                <>
                  <Finish record={b.record} /> · {b.record.player}
                </>
              )}
            </Show>
          </span>
          <span class='pi-count'>{props.group.lists.length.toLocaleString()} lists</span>
        </Show>
      </div>
      <Show when={props.open}>
        <div class='au-detail' id={detailId()}>
          <CopySplit group={props.group} card={props.card} db={props.db} withLinks={!props.hasLists} />
        </div>
        <Show when={props.hasLists}>
          <GroupLists
            lists={props.group.lists}
            oneEvent={props.oneEvent}
            cardUid={props.cardUid}
            archetype={entry()}
            tournament={props.tournament}
          />
        </Show>
      </Show>
    </div>
  );
}

/**
 * The copy-count split inside an opened row. Without a list index the buckets
 * still deep-link into the archetype builder, which is the only route to lists
 * on those reports.
 */
function CopySplit(props: { group: PlayedInGroup; card: CardItem; db: SynonymDatabase | null; withLinks: boolean }) {
  // The builder's rules key by the GLOBAL canonical printing, so resolve the
  // card's rolling print to its cluster canonical before building the id.
  const cardId = createMemo(() => (props.withLinks ? buildCanonicalCardId(props.card, props.db) : null));
  return (
    <For each={props.group.dist}>
      {d => (
        <div class='au-dist-line' classList={{ 'is-modal': d.copies === props.group.modal?.copies }}>
          <span class='au-dist-copies'>{d.copies}× copies</span>
          <div class='au-dist-bar' aria-hidden='true'>
            <div class='au-dist-fill' style={{ width: `${Math.min(100, d.percent ?? 0)}%` }} />
          </div>
          <span class='au-dist-stat'>
            {fmtWholePct(d.percent ?? 0)} · {(d.players ?? 0).toLocaleString()} decks
            <Show when={cardId()}>
              {' · '}
              <A
                class='au-dist-link'
                href={`/archetypes/${encodeURIComponent(props.group.usage.entry.name)}?b=${cardId()}:i:e:${d.copies}`}
              >
                view lists →
              </A>
            </Show>
          </span>
        </div>
      )}
    </For>
  );
}

function GroupLists(props: {
  lists: CardList[];
  oneEvent: boolean;
  cardUid: string | null;
  archetype: { name: string; label: string };
  tournament: string;
}) {
  const [limit, setLimit] = createSignal(LISTS_PER_GROUP);
  const shown = createMemo(() => props.lists.slice(0, limit()));
  const open = useToggleSet<number>();
  return (
    <div class='pi-lists'>
      <For each={shown()}>
        {list => (
          <ListRow
            list={list}
            open={open.has(list.record.id)}
            onToggle={() => open.toggle(list.record.id)}
            oneEvent={props.oneEvent}
            cardUid={props.cardUid}
            archetype={props.archetype}
            tournament={props.tournament}
          />
        )}
      </For>
      <Show when={props.lists.length > LISTS_PER_GROUP}>
        <div class='pi-lists-foot'>
          <button
            type='button'
            class='pi-linkbtn'
            onClick={() => setLimit(n => (n < props.lists.length ? n + LISTS_PER_GROUP_MORE : LISTS_PER_GROUP))}
          >
            {limit() < props.lists.length ? 'Show more' : 'Show fewer'}
          </button>
          <span class='pi-showing'>
            {Math.min(limit(), props.lists.length)} of {props.lists.length}
          </span>
        </div>
      </Show>
    </div>
  );
}

function ListRow(props: {
  list: CardList;
  open: boolean;
  onToggle: () => void;
  oneEvent: boolean;
  cardUid: string | null;
  archetype: { name: string; label: string };
  tournament: string;
}) {
  const record = () => props.list.record;
  return (
    <div class='pi-list' classList={{ 'is-open': props.open }}>
      <div
        class='pi-list-head'
        role='button'
        tabIndex={0}
        aria-expanded={props.open}
        onClick={() => props.onToggle()}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            props.onToggle();
          }
        }}
      >
        <span class='au-chevron' aria-hidden='true'>
          ▶
        </span>
        <span class='pi-place'>
          <Finish record={record()} />
        </span>
        <span class='pi-player'>
          {record().player}
          <Show when={record().country}>
            <span class='pi-cc'>{record().country}</span>
          </Show>
        </span>
        <Show when={!props.oneEvent && record().event} keyed>
          {ev => (
            <span class='pi-event'>
              <span class='pi-event-name'>{ev.name}</span>
              <span class='pi-date'>{shortDate(ev.date ? new Date(`${ev.date}T12:00:00Z`) : null)}</span>
            </span>
          )}
        </Show>
        <span class='au-chip pi-copies'>{props.list.copies}×</span>
      </div>
      <Show when={props.open}>
        <div class='pi-list-body'>
          <DeckBody cards={record().cards} highlight={c => (c as { uid?: string }).uid === props.cardUid} />
          <ListFooter record={record()} archetype={props.archetype} tournament={props.tournament} />
        </div>
      </Show>
    </div>
  );
}

function Finish(props: { record: ListRecord }) {
  return (
    <Show when={props.record.placement > 0} fallback={<span class='pi-of'>Unplaced</span>}>
      <b>{ordinal(props.record.placement)}</b>
      <Show when={props.record.event?.players}>
        <span class='pi-of'>of {props.record.event!.players.toLocaleString()}</span>
      </Show>
    </Show>
  );
}

function ListFooter(props: { record: ListRecord; archetype: { name: string; label: string }; tournament: string }) {
  const [copied, setCopied] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function copy() {
    const { text } = buildPtcglDeck(props.record.cards);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timer);
      timer = setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div class='pi-list-foot'>
      <button type='button' class='btn btn-secondary' onClick={() => void copy()}>
        {copied() ? 'Copied' : 'Copy for PTCGL'}
      </button>
      <A href={`/archetypes/${encodeURIComponent(props.archetype.name)}`}>{props.archetype.label} →</A>
      <Show when={props.tournament === ONLINE && props.record.event}>
        <a
          href={`https://play.limitlesstcg.com/tournament/${props.record.event!.id}/standings`}
          target='_blank'
          rel='noopener'
        >
          Standings ↗
        </a>
      </Show>
    </div>
  );
}
