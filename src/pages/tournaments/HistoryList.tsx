/**
 * An account's History as one box, newest first, shared by /history and the
 * public profile (/u/:slug): each event with its day, format and division,
 * then the deck played, the place and the record. Those three fill in as
 * each event's public copy arrives (see lib/tournament/historyCopies.ts), read only
 * once its row comes into view. A row opens in place to the rounds played,
 * with the way to the event's page.
 */

import { A } from '@solidjs/router';
import { createResource, createSignal, For, onCleanup, Show } from 'solid-js';
import { recordLabel } from '../../../shared/tournament/standings';
import type { HistoryEntry } from '../../lib/tournament/api';
import { ordinal } from '../../lib/format';
import { type EntryResult, eventDay } from '../../lib/tournament/history';
import { loadEntry } from '../../lib/tournament/historyCopies';
import { divisionHeading } from '../../lib/tournament/present';
import { resolved } from '../../lib/resource';
import { Skeleton } from '../../components/Skeleton';
import { DeckIcons } from './DeckIcons';
import { Squares } from './Squares';
import '../../styles/pages/tournament-history.css';

const STATUS_FLAGS: Record<HistoryEntry['status'], string | null> = {
  live: 'In progress',
  upcoming: 'Upcoming',
  finished: null
};

/** Calls a row's `seen` once it comes near the screen, so only rows someone may look at read their event. */
type Watch = (row: Element, seen: () => void) => void;

function watchRows(): Watch {
  const waiting = new Map<Element, () => void>();
  // Without the observer (an old browser), every row reads its event at once, still four at a time.
  if (typeof IntersectionObserver === 'undefined') {
    return (_row, seen) => seen();
  }
  const observer = new IntersectionObserver(
    found => {
      for (const { target } of found.filter(f => f.isIntersecting)) {
        waiting.get(target)?.();
        waiting.delete(target);
        observer.unobserve(target);
      }
    },
    { rootMargin: '200px 0px' }
  );
  onCleanup(() => observer.disconnect());
  return (row, seen) => {
    waiting.set(row, seen);
    observer.observe(row);
  };
}

/** One round: its name and table, the opponent (or the bye), and the result. */
function RoundLine(props: { row: EntryResult['finish']['rounds'][number]; result: EntryResult }) {
  return (
    <li>
      <span class='tm-hist-round'>
        <span>{props.row.label}</span>
        <Show when={props.row.table > 0}>
          <small class='muted tm-num'>Table {props.row.table}</small>
        </Show>
      </span>
      <Show
        when={props.row.opponent}
        fallback={<span class='tm-hist-opp muted'>{props.row.outcome === 'bye' ? 'Bye' : 'Missed round'}</span>}
      >
        {opponent => (
          <span class='tm-hist-opp'>
            <DeckIcons label={props.result.decks[opponent()]} />
            <span class='tm-name'>{props.result.names.get(opponent()) ?? ''}</span>
          </span>
        )}
      </Show>
      <span class='tm-hist-mark'>
        <Show when={props.row.mark} fallback={<span class='muted'>Playing</span>}>
          <Squares marks={[props.row.mark]} />
        </Show>
      </span>
    </li>
  );
}

/** The opened row: every round played, then the event's page. */
function Rounds(props: { entry: HistoryEntry; result: EntryResult | undefined; failed: boolean }) {
  return (
    <div class='tm-hist-more'>
      <Show
        when={props.result}
        fallback={
          <Show when={props.failed} fallback={<Skeleton width='60%' height='14px' />}>
            <p class='muted'>Results could not be loaded</p>
          </Show>
        }
      >
        {result => (
          <Show when={result().finish.rounds.length} fallback={<p class='muted'>No rounds played yet</p>}>
            <ol class='tm-hist-rounds'>
              <For each={result().finish.rounds}>{row => <RoundLine row={row} result={result()} />}</For>
            </ol>
          </Show>
        )}
      </Show>
      <A class='btn btn-secondary tm-small' href={`/t/${props.entry.code}`}>
        Event page
      </A>
    </div>
  );
}

/** A figure the event's copy fills in: a placeholder while it is read, a dash if it never came. */
function Figure(props: { value: string | null | undefined; loading: boolean }) {
  return (
    <Show
      when={props.value !== undefined}
      fallback={
        <Show when={props.loading}>
          <Skeleton inline width='32px' />
        </Show>
      }
    >
      {props.value ?? ''}
    </Show>
  );
}

function EntryRow(props: { entry: HistoryEntry; watch: Watch }) {
  const [open, setOpen] = createSignal(false);
  const [seen, setSeen] = createSignal(false);
  const [read] = createResource(() => (seen() ? props.entry : false), loadEntry);
  // Null is a copy with nobody under the key, whose row does not show.
  const result = () => resolved(read) ?? undefined;
  const failed = () => read.state === 'errored';
  const finish = () => result()?.finish;
  /** A figure: undefined until the copy is in, '—' if it never comes. */
  const figure = (value: (f: EntryResult['finish']) => string | null) => {
    const f = finish();
    return f ? value(f) : failed() ? '—' : undefined;
  };
  const sub = () =>
    [
      eventDay(props.entry.startsAt, props.entry.startDate),
      props.entry.format,
      divisionHeading(finish()?.division ?? null)
    ]
      .filter(Boolean)
      .join(' · ');
  return (
    // A copy with no player under the entry's key is a row left behind: nothing to show.
    <Show when={resolved(read) !== null}>
      <tr ref={row => props.watch(row, () => setSeen(true))} class='is-link' onClick={() => setOpen(!open())}>
        <td class='expand-col'>
          {/* No handler: the press reaches the row's own. */}
          <button
            type='button'
            class='row-caret'
            classList={{ open: open() }}
            aria-expanded={open()}
            aria-label={open() ? 'Hide rounds' : 'Show rounds'}
          >
            ▸
          </button>
        </td>
        <td class='tm-hist-event'>
          <span class='tm-hist-name'>
            {props.entry.name || props.entry.code}
            <Show when={STATUS_FLAGS[props.entry.status]}>{flag => <span class='tm-flag'>{flag()}</span>}</Show>
          </span>
          <span class='tm-hist-sub'>
            {/* On a phone the deck's own column gives way, and its sprites lead this line. */}
            <span class='tm-hist-phone-deck'>
              <DeckIcons label={finish()?.deck ?? undefined} />
            </span>
            {sub()}
            <Show when={finish()?.dropped}>
              <span class='tm-flag'>Dropped</span>
            </Show>
          </span>
        </td>
        <td class='tm-hist-deck'>
          <Show when={finish()?.deck}>
            {deck => (
              <span class='tm-hist-deck-in'>
                <DeckIcons label={deck()} />
                <span class='tm-name tm-hist-deck-name'>{deck()}</span>
              </span>
            )}
          </Show>
        </td>
        <td class='num tm-hist-place'>
          <Figure value={figure(f => (f.place ? ordinal(f.place) : null))} loading={read.loading} />
        </td>
        <td class='num tm-hist-record'>
          <Figure value={figure(f => (f.record ? recordLabel(f.record) : null))} loading={read.loading} />
        </td>
      </tr>
      <Show when={open()}>
        <tr class='row-expansion'>
          <td colSpan={5}>
            <Rounds entry={props.entry} result={result()} failed={failed()} />
          </td>
        </tr>
      </Show>
    </Show>
  );
}

/** `iconsOnly`: the deck as its sprites alone, its name left to the tooltip and assistive tech. */
export function HistoryList(props: { entries: readonly HistoryEntry[]; iconsOnly?: boolean }) {
  const watch = watchRows();
  return (
    <section class='tm-box tm-hist' classList={{ 'tm-hist-icons': props.iconsOnly }}>
      <div class='table-wrap'>
        <table class='data'>
          <thead>
            <tr>
              <th class='expand-col'>
                <span class='sr-only'>Rounds</span>
              </th>
              <th>Event</th>
              <th class='tm-hist-deck'>Deck</th>
              <th class='num tm-hist-place'>Place</th>
              <th class='num tm-hist-record'>Record</th>
            </tr>
          </thead>
          <tbody>
            <For each={props.entries}>{entry => <EntryRow entry={entry} watch={watch} />}</For>
          </tbody>
        </table>
      </div>
    </section>
  );
}
