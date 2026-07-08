import { A, useSearchParams } from '@solidjs/router';
import { createMemo, createResource, createSignal, For, onMount, Show } from 'solid-js';
import { fetchPlayerIndex, fetchPlayerProfile, prettyTournamentName } from '../lib/data';
import { Breadcrumb } from '../components/Breadcrumb';
import { Section } from '../components/Section';
import { SearchInput } from '../components/Chip';
import { Skeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { resolved } from '../lib/resource';
import type { PlayerIndexEntry, PlayerProfile, PlayerTournamentEntry } from '../types';
import '../styles/pages/players-tables.css';
import '../styles/pages/player-compare.css';

const PICKER_LIMIT = 8;

/** Win rate on a 0–1 scale from a W/L record (ties excluded), or null when unplayed. */
function winRate(wins: number, losses: number): number | null {
  const denom = wins + losses;
  return denom ? wins / denom : null;
}

/** Whole-number percent (site convention), or em dash when unplayed. */
function pctWhole(wins: number, losses: number): string {
  const r = winRate(wins, losses);
  return r == null ? '—' : `${Math.round(r * 100)}%`;
}

function record(w: number, l: number, t: number): string {
  return `${w}-${l}-${t}`;
}

interface SharedEvent {
  tournamentId: string;
  date: string;
  a: PlayerTournamentEntry;
  b: PlayerTournamentEntry;
}

/**
 * Events both players attended. This is the honest head-to-head surface the
 * data supports: Limitless publishes final standings, not round pairings, so
 * we compare where each player finished at the same event — not direct matches.
 */
function sharedEvents(a: PlayerProfile, b: PlayerProfile): SharedEvent[] {
  const byId = new Map(b.tournaments.map(t => [t.tournamentId, t]));
  const out: SharedEvent[] = [];
  for (const ta of a.tournaments) {
    const tb = byId.get(ta.tournamentId);
    if (tb) {
      out.push({ tournamentId: ta.tournamentId, date: ta.tournamentDate, a: ta, b: tb });
    }
  }
  out.sort((x, y) => y.date.localeCompare(x.date));
  return out;
}

/** −1 when `a` finished higher (lower placement), 1 when `b` did, 0 otherwise. */
function finishCmp(a: PlayerTournamentEntry, b: PlayerTournamentEntry): number {
  if (a.placement == null || b.placement == null || a.placement === b.placement) {
    return 0;
  }
  return a.placement < b.placement ? -1 : 1;
}

export function PlayerComparePage() {
  const [params, setParams] = useSearchParams<{ a?: string; b?: string }>();

  const [index] = createResource(fetchPlayerIndex);
  const indexData = () => resolved(index) ?? [];

  const [profileA] = createResource(() => params.a ?? null, fetchPlayerProfile);
  const [profileB] = createResource(() => params.b ?? null, fetchPlayerProfile);
  const a = () => resolved(profileA);
  const b = () => resolved(profileB);

  onMount(() => {
    document.title = 'Compare players — Ciphermaniac';
  });

  const setSlot = (slot: 'a' | 'b', id: string) => setParams({ [slot]: id || undefined });

  const shared = createMemo(() => {
    const pa = a();
    const pb = b();
    return pa && pb ? sharedEvents(pa, pb) : [];
  });

  // Head-to-head by finish across shared events: wins for A, wins for B, ties.
  const headToHead = createMemo(() => {
    let aWins = 0;
    let bWins = 0;
    let ties = 0;
    for (const ev of shared()) {
      const c = finishCmp(ev.a, ev.b);
      if (c < 0) {
        aWins += 1;
      } else if (c > 0) {
        bWins += 1;
      } else {
        ties += 1;
      }
    }
    return { aWins, bWins, ties };
  });

  const bothPicked = () => Boolean(params.a && params.b);

  return (
    <>
      <Breadcrumb crumbs={[{ label: 'Players', href: '/players' }, { label: 'Compare' }]} />

      <section class='hero'>
        <h1>Compare players</h1>
        <div class='hero-meta'>
          <span>Pick two players to compare records and shared events.</span>
        </div>
      </section>

      <div class='compare-pickers'>
        <PlayerSlot
          label='Player 1'
          index={indexData()}
          selected={a()}
          selectedId={params.a}
          otherId={params.b}
          onPick={id => setSlot('a', id)}
        />
        <PlayerSlot
          label='Player 2'
          index={indexData()}
          selected={b()}
          selectedId={params.b}
          otherId={params.a}
          onPick={id => setSlot('b', id)}
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
          <ComparisonBody a={a()!} b={b()!} shared={shared()} headToHead={headToHead()} />
        </Show>
      </Show>
    </>
  );
}

function PlayerSlot(props: {
  label: string;
  index: PlayerIndexEntry[];
  selected: PlayerProfile | null | undefined;
  selectedId: string | undefined;
  otherId: string | undefined;
  onPick: (id: string) => void;
}) {
  const [query, setQuery] = createSignal('');
  const matches = createMemo(() => {
    const q = query().trim().toLowerCase();
    if (!q) {
      return [];
    }
    return props.index
      .filter(p => p.playerId !== props.otherId && p.name.toLowerCase().includes(q))
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
          <Show when={props.selected} fallback={<Skeleton width='160px' height='20px' />}>
            <A href={`/players/${props.selectedId}`} class='cardname compare-slot-name'>
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
  const winA = winRate(sa.wins, sa.losses);
  const winB = winRate(sb.wins, sb.losses);
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
      aValue: pctWhole(sa.wins, sa.losses),
      bValue: pctWhole(sb.wins, sb.losses),
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
      aValue: sa.bestPlacement == null ? '—' : String(sa.bestPlacement),
      bValue: sb.bestPlacement == null ? '—' : String(sb.bestPlacement),
      lead: lower(sa.bestPlacement, sb.bestPlacement)
    },
    {
      label: 'Median placement',
      aValue: sa.medianPlacement == null ? '—' : String(sa.medianPlacement),
      bValue: sb.medianPlacement == null ? '—' : String(sb.medianPlacement),
      lead: lower(sa.medianPlacement, sb.medianPlacement)
    }
  ];
}

function ComparisonBody(props: {
  a: PlayerProfile;
  b: PlayerProfile;
  shared: SharedEvent[];
  headToHead: { aWins: number; bWins: number; ties: number };
}) {
  const metrics = createMemo(() => buildMetrics(props.a, props.b));
  const archetypeName = (p: PlayerProfile, base: string | null) => (base ? (p.archetypeNames[base] ?? base) : '—');

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
          <span
            class='compare-h2h'
            title='Compares final standings at events both attended. Limitless publishes no round pairings, so this reflects placement, not direct matches.'
          >
            <Show when={props.shared.length > 0} fallback='—'>
              Head-to-head by finish {props.headToHead.aWins}–{props.headToHead.bWins}
              <Show when={props.headToHead.ties > 0}> · {props.headToHead.ties} even</Show>
            </Show>
          </span>
        }
      >
        <Show
          when={props.shared.length > 0}
          fallback={<EmptyState title='No shared events.' description='These two players have no events in common.' />}
        >
          <div class='table-wrap'>
            <table class='data'>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Event</th>
                  <th class='num'>{props.a.name}</th>
                  <th>Deck</th>
                  <th class='num'>{props.b.name}</th>
                  <th>Deck</th>
                </tr>
              </thead>
              <tbody>
                <For each={props.shared}>
                  {ev => {
                    const cmp = finishCmp(ev.a, ev.b);
                    return (
                      <tr>
                        <td class='muted-cell'>{ev.date}</td>
                        <td>
                          <span class='cardname'>{prettyTournamentName(ev.tournamentId)}</span>
                        </td>
                        <td class='num' classList={{ 'compare-lead': cmp < 0 }}>
                          <Show when={cmp < 0}>
                            <span class='compare-caret' aria-label='Higher finish'>
                              ▲
                            </span>{' '}
                          </Show>
                          {ev.a.placement ?? '—'}
                          <span class='muted-cell'> · {record(ev.a.wins, ev.a.losses, ev.a.ties)}</span>
                        </td>
                        <td class='muted-cell'>{archetypeName(props.a, ev.a.archetype)}</td>
                        <td class='num' classList={{ 'compare-lead': cmp > 0 }}>
                          <Show when={cmp > 0}>
                            <span class='compare-caret' aria-label='Higher finish'>
                              ▲
                            </span>{' '}
                          </Show>
                          {ev.b.placement ?? '—'}
                          <span class='muted-cell'> · {record(ev.b.wins, ev.b.losses, ev.b.ties)}</span>
                        </td>
                        <td class='muted-cell'>{archetypeName(props.b, ev.b.archetype)}</td>
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
