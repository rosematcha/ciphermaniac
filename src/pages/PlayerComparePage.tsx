import { A, useSearchParams } from '@solidjs/router';
import { createEffect, createMemo, createResource, createSignal, For, Show } from 'solid-js';
import {
  fetchPlayerIndexSlim,
  fetchPlayerProfile,
  getArchetypeIconMap,
  prettyTournamentName,
  resolveArchetypeIcons
} from '../lib/data';
import { ArchetypeIcons } from '../components/ArchetypeIcon';
import { Section } from '../components/Section';
import { SearchInput } from '../components/Chip';
import { Skeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { InfoTip } from '../components/InfoTip';
import { resolved } from '../lib/resource';
import type { PlayerIndexSlimEntry, PlayerProfile } from '../types';
import { finishCmp, headToHead, type SharedEvent, sharedEvents } from './playerCompare/model';
import { placementLabel, winPercent, winPercentLabel } from '../lib/format';
import { foldSearch } from '../utils/searchFold';
import '../styles/pages/players-tables.css';
import '../styles/pages/player-compare.css';

const PICKER_LIMIT = 8;

function record(w: number, l: number, t: number): string {
  return `${w}-${l}-${t}`;
}

export function PlayerComparePage() {
  const [params, setParams] = useSearchParams<{ a?: string; b?: string }>();

  // The index only feeds the picker autocomplete, so we don't download it on
  // mount — we defer until the user focuses a search box. When the page loads
  // with ?a/?b already set, the chosen profiles fetch directly by id and the
  // index is never needed at all.
  const [indexRequested, setIndexRequested] = createSignal(false);
  const [index] = createResource(() => (indexRequested() ? 'load' : null), fetchPlayerIndexSlim);
  const indexData = () => resolved(index) ?? [];

  const [profileA] = createResource(() => params.a ?? null, fetchPlayerProfile);
  const [profileB] = createResource(() => params.b ?? null, fetchPlayerProfile);
  const a = () => resolved(profileA);
  const b = () => resolved(profileB);

  createEffect(() => {
    const pa = a();
    const pb = b();
    document.title = pa && pb ? `${pa.name} vs ${pb.name} — Ciphermaniac` : 'Compare players — Ciphermaniac';
  });

  // Replace, don't push: choosing a slot then changing it is two writes, and
  // the back button should leave the comparison, not walk its half-built states.
  const setSlot = (slot: 'a' | 'b', id: string) => setParams({ [slot]: id || undefined }, { replace: true });

  const shared = createMemo(() => {
    const pa = a();
    const pb = b();
    return pa && pb ? sharedEvents(pa, pb) : [];
  });

  const h2h = createMemo(() => headToHead(shared()));

  const bothPicked = () => Boolean(params.a && params.b);

  return (
    <>
      <section class='hero'>
        <h1>Compare players</h1>
      </section>

      <div class='compare-pickers'>
        <PlayerSlot
          label='Player 1'
          index={indexData()}
          selected={a()}
          selectedId={params.a}
          otherId={params.b}
          onPick={id => setSlot('a', id)}
          onActivate={() => setIndexRequested(true)}
        />
        <PlayerSlot
          label='Player 2'
          index={indexData()}
          selected={b()}
          selectedId={params.b}
          otherId={params.a}
          onPick={id => setSlot('b', id)}
          onActivate={() => setIndexRequested(true)}
        />
      </div>

      <Show
        when={bothPicked()}
        fallback={
          <EmptyState title='Choose two players.' description='Search each slot above to build a comparison.' />
        }
      >
        <Show
          when={a() && b()}
          fallback={
            <Show
              when={a() === null || b() === null}
              fallback={
                <section>
                  <Skeleton height='240px' />
                </section>
              }
            >
              <EmptyState
                title='Player not found.'
                description='One of these player IDs has no career profile. Try another.'
              />
            </Show>
          }
        >
          <ComparisonBody a={a()!} b={b()!} shared={shared()} headToHead={h2h()} />
        </Show>
      </Show>
    </>
  );
}

function PlayerSlot(props: {
  label: string;
  index: PlayerIndexSlimEntry[];
  selected: PlayerProfile | null | undefined;
  selectedId: string | undefined;
  otherId: string | undefined;
  onPick: (id: string) => void;
  /** Fired when the search box gains focus, so the parent can lazy-load the index. */
  onActivate: () => void;
}) {
  const [query, setQuery] = createSignal('');
  const matches = createMemo(() => {
    const q = foldSearch(query().trim());
    if (!q) {
      return [];
    }
    return props.index
      .filter(p => p.playerId !== props.otherId && foldSearch(p.name).includes(q))
      .slice(0, PICKER_LIMIT);
  });

  const pick = (id: string) => {
    props.onPick(id);
    setQuery('');
  };

  return (
    <div class='compare-slot'>
      <div class='compare-slot-label'>{props.label}</div>
      <Show
        when={props.selectedId}
        fallback={
          <>
            <SearchInput
              value={query()}
              onInput={setQuery}
              placeholder='Search players…'
              ariaLabel={`${props.label} search`}
              onFocus={() => props.onActivate()}
            />
            <Show when={matches().length > 0}>
              <ul class='compare-picker-list'>
                <For each={matches()}>
                  {p => (
                    <li>
                      <button type='button' class='compare-picker-item' onClick={() => pick(p.playerId)}>
                        <span class='cardname'>{p.name}</span>
                        <span class='muted-cell'>{p.eventCount} events</span>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </>
        }
      >
        <div class='compare-slot-chosen'>
          <Show
            when={props.selected}
            fallback={
              // undefined = still loading; null = fetched, no such profile.
              <Show when={props.selected === null} fallback={<Skeleton width='160px' height='20px' />}>
                <span class='muted-cell'>Player not found</span>
              </Show>
            }
          >
            <A href={`/players/${encodeURIComponent(props.selectedId!)}`} class='cardname compare-slot-name'>
              {props.selected!.name}
            </A>
            <span class='muted-cell'>{props.selected!.countries.join(' · ') || '—'}</span>
          </Show>
          <button type='button' class='row-toggle' onClick={() => props.onPick('')}>
            Change
          </button>
        </div>
      </Show>
    </div>
  );
}

interface MetricRow {
  label: string;
  aValue: string;
  bValue: string;
  /** -1 A leads, 1 B leads, 0 tie/na */
  lead: number;
}

function buildMetrics(a: PlayerProfile, b: PlayerProfile): MetricRow[] {
  const sa = a.summary;
  const sb = b.summary;
  const higher = (x: number, y: number) => (x === y ? 0 : x > y ? -1 : 1);
  // Lower placement number is better.
  const lower = (x: number | null, y: number | null) => {
    if (x == null && y == null) {
      return 0;
    }
    if (x == null) {
      return 1;
    }
    if (y == null) {
      return -1;
    }
    return x === y ? 0 : x < y ? -1 : 1;
  };
  const winA = winPercent(sa.wins, sa.losses);
  const winB = winPercent(sb.wins, sb.losses);
  return [
    {
      label: 'Events',
      aValue: String(sa.eventCount),
      bValue: String(sb.eventCount),
      lead: higher(sa.eventCount, sb.eventCount)
    },
    {
      label: 'Record',
      aValue: record(sa.wins, sa.losses, sa.ties),
      bValue: record(sb.wins, sb.losses, sb.ties),
      lead: 0
    },
    {
      label: 'Win %',
      aValue: winPercentLabel(sa.wins, sa.losses),
      bValue: winPercentLabel(sb.wins, sb.losses),
      lead: winA == null || winB == null ? 0 : higher(winA, winB)
    },
    { label: 'Day 2s', aValue: String(sa.day2s), bValue: String(sb.day2s), lead: higher(sa.day2s, sb.day2s) },
    { label: 'Top cuts', aValue: String(sa.topCuts), bValue: String(sb.topCuts), lead: higher(sa.topCuts, sb.topCuts) },
    {
      label: 'Titles',
      aValue: String(sa.tournamentWins),
      bValue: String(sb.tournamentWins),
      lead: higher(sa.tournamentWins, sb.tournamentWins)
    },
    {
      label: 'Best placement',
      aValue: placementLabel(sa.bestPlacement),
      bValue: placementLabel(sb.bestPlacement),
      lead: lower(sa.bestPlacement, sb.bestPlacement)
    },
    {
      label: 'Median placement',
      aValue: placementLabel(sa.medianPlacement),
      bValue: placementLabel(sb.medianPlacement),
      lead: lower(sa.medianPlacement, sb.medianPlacement)
    }
  ];
}

function ComparisonBody(props: {
  a: PlayerProfile;
  b: PlayerProfile;
  shared: SharedEvent[];
  headToHead: ReturnType<typeof headToHead>;
}) {
  const metrics = createMemo(() => buildMetrics(props.a, props.b));
  const archetypeName = (p: PlayerProfile, base: string | null) => (base ? (p.archetypeNames[base] ?? base) : '');
  const iconMap = getArchetypeIconMap;
  const deckCell = (p: PlayerProfile, base: string | null) => {
    const name = archetypeName(p, base);
    return (
      <Show when={name} fallback='—'>
        <span class='arche-name-cell'>
          <ArchetypeIcons slugs={resolveArchetypeIcons({ name }, iconMap())} size={16} reserveSlot />
          {name}
        </span>
      </Show>
    );
  };

  return (
    <>
      <Section title='Career'>
        <div class='table-wrap'>
          <table class='data compare-table'>
            <thead>
              <tr>
                <th>Metric</th>
                <th class='num'>{props.a.name}</th>
                <th class='num'>{props.b.name}</th>
              </tr>
            </thead>
            <tbody>
              <For each={metrics()}>
                {m => (
                  <tr>
                    <td class='muted-cell'>{m.label}</td>
                    <td class='num' classList={{ 'compare-lead': m.lead < 0 }}>
                      {m.aValue}
                    </td>
                    <td class='num' classList={{ 'compare-lead': m.lead > 0 }}>
                      {m.bValue}
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        title='Shared events'
        right={
          <span class='compare-h2h'>
            <Show when={props.shared.length > 0} fallback='—'>
              Head-to-head by finish {props.headToHead.aWins}-{props.headToHead.bWins}
              <Show when={props.headToHead.ties > 0}>-{props.headToHead.ties}</Show>
              {/* Without this, a pair with an unpublished finish shows four rows
                  in the table below and a record that only accounts for three,
                  with nothing on screen saying where the fourth went. */}
              <Show when={props.headToHead.unscored > 0}>
                <span class='compare-unscored'> · {props.headToHead.unscored} unscored</span>
              </Show>{' '}
              <InfoTip marker='i' label='How head-to-head is counted'>
                Compares final standings at events both attended. Limitless publishes no round pairings, so this
                reflects placement, not direct matches.
              </InfoTip>
            </Show>
          </span>
        }
      >
        <Show
          when={props.shared.length > 0}
          fallback={<EmptyState title='No shared events.' description='These two players have no events in common.' />}
        >
          <div class='table-wrap compare-events'>
            <table class='data'>
              <thead>
                <tr>
                  <th class='compare-event-col'>Event</th>
                  <th class='num'>{props.a.name}</th>
                  <th class='compare-deck-col'>Deck</th>
                  <th class='num'>{props.b.name}</th>
                  <th class='compare-deck-col'>Deck</th>
                </tr>
              </thead>
              <tbody>
                <For each={props.shared}>
                  {ev => {
                    const cmp = finishCmp(ev.a, ev.b);
                    return (
                      <tr>
                        <td class='compare-event-col'>
                          <span class='cardname'>{prettyTournamentName(ev.tournamentId)}</span>
                        </td>
                        <td class='num' classList={{ 'compare-lead': cmp === -1 }}>
                          <Show when={cmp === -1}>
                            <span class='compare-caret' aria-label='Higher finish'>
                              ▲
                            </span>{' '}
                          </Show>
                          {placementLabel(ev.a.placement)}
                          <span class='muted-cell'> · {record(ev.a.wins, ev.a.losses, ev.a.ties)}</span>
                        </td>
                        <td class='muted-cell compare-deck-col'>{deckCell(props.a, ev.a.archetype)}</td>
                        <td class='num' classList={{ 'compare-lead': cmp === 1 }}>
                          <Show when={cmp === 1}>
                            <span class='compare-caret' aria-label='Higher finish'>
                              ▲
                            </span>{' '}
                          </Show>
                          {placementLabel(ev.b.placement)}
                          <span class='muted-cell'> · {record(ev.b.wins, ev.b.losses, ev.b.ties)}</span>
                        </td>
                        <td class='muted-cell compare-deck-col'>{deckCell(props.b, ev.b.archetype)}</td>
                      </tr>
                    );
                  }}
                </For>
              </tbody>
            </table>
          </div>
        </Show>
      </Section>
    </>
  );
}
