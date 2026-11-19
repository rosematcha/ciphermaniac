import { createMemo, For, Show } from 'solid-js';
import { A, useNavigate } from '@solidjs/router';
import { InfoTip } from '@ciphermaniac/design/components/InfoTip';
import { Skeleton } from '@ciphermaniac/design/components/Skeleton';
import { CardImage } from '../../components/CardImage';
import { cropFrame } from '../../components/cardCropFrame';
import { parseISODate, shortDateParts } from '../../lib/format';
import { changeArrow, signedPercent, wholePercent } from '../trendsPage/weekly';
import type { ArchetypeTrends } from '../../lib/data/archetypeTrends';
import { type DeckSection, deckSection } from '../../../shared/data/cardOrder';
import type { CardItem } from '../../types';
import { type Change, MIN_WEEK_LISTS, rangeText, type Week, weeklyChanges } from './changesModel';
import '../../styles/pages/archetype-changes.css';

interface ChangesTabProps {
  /** The archetype's trends; undefined while loading, null when they couldn't be read. */
  trends: ArchetypeTrends | null | undefined;
  items: CardItem[];
}

const TYPE_LABELS: Record<DeckSection, string> = {
  pokemon: 'Pokémon',
  supporter: 'Supporter',
  item: 'Item',
  trainerOther: 'Item',
  tool: 'Tool',
  stadium: 'Stadium',
  energySpecial: 'Energy',
  energyBasic: 'Energy'
};

/** "Nov 11–17", or "Oct 29–Nov 4" across a month. */
function weekLabel(week: Week): string {
  const start = shortDateParts(parseISODate(week.start));
  const end = shortDateParts(parseISODate(week.end));
  if (!start || !end) {
    return `${week.start}–${week.end}`;
  }
  return `${start.month} ${start.day}–${start.month === end.month ? '' : `${end.month} `}${end.day}`;
}

const lists = (n: number) => `${n.toLocaleString()} list${n === 1 ? '' : 's'}`;
const cardHref = (row: Change) => `/cards/${row.set}/${row.number}`;
const shares = (row: Change) => `${wholePercent(row.before)} → ${wholePercent(row.after)}`;

/**
 * The Changes tab: one table from the biggest rise to the biggest fall, each
 * row with a bar for the change and its 95% range around a centre line.
 */
export default function ChangesTab(props: ChangesTabProps) {
  const changes = createMemo(() => (props.trends?.days ? weeklyChanges(props.trends, props.items) : null));
  const enough = () => {
    const c = changes();
    return Boolean(c && Math.min(c.thisWeek.lists, c.lastWeek.lists) >= MIN_WEEK_LISTS);
  };
  return (
    <Show when={props.trends !== undefined} fallback={<Skeleton height='320px' />}>
      <Show when={changes()} fallback={<p class='muted'>Couldn't load this week's changes.</p>}>
        {c => (
          <Show
            when={enough()}
            fallback={
              <div class='changes-floor'>
                <h3>Too few lists to compare weeks</h3>
                <p>
                  {lists(c().thisWeek.lists)} this week and {c().lastWeek.lists.toLocaleString()} last week. Changes
                  show once both weeks have {MIN_WEEK_LISTS}.
                </p>
              </div>
            }
          >
            <p class='changes-intro'>
              This week ({weekLabel(c().thisWeek)}, {lists(c().thisWeek.lists)}) against last week (
              {weekLabel(c().lastWeek)}, {lists(c().lastWeek.lists)}).{' '}
              <InfoTip label='About the bars'>
                Faded rows could be noise. The bar shows the 95% range of the change.
              </InfoTip>
            </p>
            <Show when={c().rows.length > 0} fallback={<p class='muted'>No changes this week.</p>}>
              <ChangesTable rows={c().rows} />
            </Show>
          </Show>
        )}
      </Show>
    </Show>
  );
}

function Thumb(props: { row: Change }) {
  return (
    <span
      class={`card-crop-art is-${cropFrame({ name: props.row.name, category: props.row.category ?? undefined })} changes-thumb`}
    >
      <CardImage set={props.row.set} number={props.row.number} size='xs' sizes='64px' alt='' />
    </span>
  );
}

/** "Pokémon", "Supporter", "Item"…; a dash for a card the report doesn't list. */
function typeLabel(row: Change): string {
  return row.category ? TYPE_LABELS[deckSection({ name: row.name, category: row.category }, null)] : '—';
}

/**
 * The card's name over one note: its printing when another row shares the
 * name, so two cards called Dudunsparce don't read as one, and the
 * pre-evolutions that moved with it.
 */
function CardCell(props: { row: Change; sharedName: boolean }) {
  const note = () =>
    [
      props.sharedName ? `${props.row.set} ${props.row.number}` : '',
      props.row.line.length ? `with ${props.row.line.join(', ')}` : ''
    ]
      .filter(Boolean)
      .join(' · ');
  return (
    <span class='changes-card'>
      <Thumb row={props.row} />
      <span class='changes-card-text'>
        <A class='cardname' href={cardHref(props.row)}>
          {props.row.name}
        </A>
        <Show when={note()}>
          <span class='changes-note' title={note()}>
            {note()}
          </span>
        </Show>
      </span>
    </span>
  );
}

function Delta(props: { value: number }) {
  return (
    <span class='changes-delta' classList={{ up: props.value > 0, down: props.value < 0 }}>
      <span aria-hidden='true'>{changeArrow(props.value)}</span> {signedPercent(props.value)}
    </span>
  );
}

/** The change as a dot on its 95% range, centred on no change. */
function RangeBar(props: { row: Change; span: number }) {
  const x = (v: number) => `${(50 + (v / props.span) * 50).toFixed(1)}%`;
  const dir = () => (props.row.delta > 0 ? 'up' : 'down');
  const text = () => rangeText(props.row);
  return (
    <>
      <span class='changes-bar' title={text()} aria-hidden='true'>
        <span class='changes-bar-zero' />
        <span
          class={`changes-bar-range ${dir()}`}
          style={{ left: x(props.row.low), width: `${((props.row.high - props.row.low) / props.span) * 50}%` }}
        />
        <span class={`changes-bar-dot ${dir()}`} style={{ left: x(props.row.delta) }} />
      </span>
      <span class='sr-only'>{text()}</span>
    </>
  );
}

function useRowLink() {
  const navigate = useNavigate();
  return (row: Change) => navigate(cardHref(row));
}

function ChangesTable(props: { rows: Change[] }) {
  const go = useRowLink();
  // One scale for every bar, wide enough for the widest range and never under ±20 points.
  const span = createMemo(() => Math.max(20, ...props.rows.map(row => Math.max(-row.low, row.high))));
  const sharedNames = createMemo(() => {
    const names = props.rows.map(row => row.name);
    return new Set(names.filter((name, index) => names.indexOf(name) !== index));
  });
  return (
    <div class='table-wrap'>
      <table class='data changes-table'>
        <caption class='sr-only'>Each card's share of lists, this week against last, biggest rise first</caption>
        <thead>
          <tr>
            <th scope='col'>Card</th>
            <th scope='col' class='changes-type'>
              Type
            </th>
            <th scope='col' class='num'>
              Share of lists
            </th>
            <th scope='col' class='num'>
              Change
            </th>
            <th scope='col' class='changes-range'>
              Range
            </th>
          </tr>
        </thead>
        <tbody>
          <For each={props.rows}>
            {row => (
              <tr class='is-link' classList={{ 'is-noise': !row.clear }} onClick={() => go(row)}>
                <td>
                  <CardCell row={row} sharedName={sharedNames().has(row.name)} />
                </td>
                <td class='muted-cell changes-type'>{typeLabel(row)}</td>
                <td class='num'>{shares(row)}</td>
                <td class='num'>
                  <Delta value={row.delta} />
                </td>
                <td class='changes-range'>
                  <RangeBar row={row} span={span()} />
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}
