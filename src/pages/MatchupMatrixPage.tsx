import { createMemo, createResource, createSignal, For, onMount, Show } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { fetchArchetypes, getArchetypeIconMap, prettyTournamentName, resolveArchetypeIcons } from '../lib/data';
import { useTournament } from '../lib/tournamentContext';
import { ONLINE_META_LABEL, ONLINE_META_NAME } from '../lib/constants';
import type { ArchetypeIndexEntry } from '../types';
import type { MatrixCell } from '../lib/matchups';
import { fetchMatchupMatrix, type MatrixEntry } from '../lib/matchupMatrix';
import { Section } from '../components/Section';
import { Segmented } from '../components/Segmented';
import { ChipGroup } from '../components/Chip';
import { Skeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { InfoTip } from '../components/InfoTip';
import { ArchetypeIcons } from '../components/ArchetypeIcon';
import { latestValue } from '../lib/resource';
import '../styles/pages/matchups.css';

type OrderBy = 'share' | 'games';
type Size = 12 | 16 | 24;

const ORDER_OPTIONS: { value: OrderBy; label: string }[] = [
  { value: 'share', label: 'Meta share' },
  { value: 'games', label: 'Games' }
];
const SIZE_OPTIONS: { value: string; label: string }[] = [
  { value: '12', label: 'Top 12' },
  { value: '16', label: 'Top 16' },
  { value: '24', label: 'Top 24' }
];
const MIN_GAMES_OPTIONS: { value: string; label: string }[] = [
  { value: '0', label: 'All' },
  { value: '10', label: '10+' },
  { value: '30', label: '30+' },
  { value: '50', label: '50+' }
];

/** Diverging fill intensity: full pole colour by ±25pp from the 50% centre. */
function cellStyle(wr: number): { background: string; color: string } {
  const dev = wr - 50;
  const intensity = Math.min(1, Math.abs(dev) / 25);
  const alpha = Math.round(intensity * 58);
  const pole = dev >= 0 ? 'var(--positive)' : 'var(--negative)';
  return {
    background: `color-mix(in srgb, ${pole} ${alpha}%, var(--surface))`,
    color: 'var(--fg)'
  };
}

export function MatchupMatrixPage() {
  const { tournament } = useTournament();
  const navigate = useNavigate();
  const [archetypes] = createResource(tournament, fetchArchetypes);
  const archetypesData = () => latestValue(archetypes);
  const iconMap = getArchetypeIconMap();

  const [orderBy, setOrderBy] = createSignal<OrderBy>('share');
  const [size, setSize] = createSignal<Size>(16);
  const [minGames, setMinGames] = createSignal(10);

  onMount(() => {
    document.title = 'Matchup matrix — Ciphermaniac';
  });

  // Top archetypes by meta share seed the axes; the matrix fetch keeps them square.
  const seed = createMemo<ArchetypeIndexEntry[]>(() => {
    const list = archetypesData() ?? [];
    return [...list].sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0)).slice(0, size());
  });

  const [matrix] = createResource(
    () => {
      const s = seed();
      return s.length > 0
        ? { t: tournament(), entries: s.map(e => ({ name: e.name, label: e.label || e.name })) }
        : null;
    },
    ({ t, entries }) => fetchMatchupMatrix(t, entries)
  );
  const matrixData = () => latestValue(matrix);

  // Total recorded games per archetype (non-mirror), used for the games ordering.
  const gamesByKey = createMemo(() => {
    const m = matrixData();
    const out = new Map<string, number>();
    if (!m) {
      return out;
    }
    for (const [rowKey, cells] of m.cells) {
      let total = 0;
      for (const cell of cells.values()) {
        if (!cell.isMirror) {
          total += cell.matches;
        }
      }
      out.set(rowKey, total);
    }
    return out;
  });

  // Axis order: meta share follows the seed; games re-sorts the same set.
  const ordered = createMemo<MatrixEntry[]>(() => {
    const m = matrixData();
    if (!m) {
      return [];
    }
    if (orderBy() === 'share') {
      return m.entries;
    }
    const games = gamesByKey();
    return [...m.entries].sort((a, b) => (games.get(b.key) ?? 0) - (games.get(a.key) ?? 0));
  });

  const iconsFor = (entry: MatrixEntry): string[] =>
    resolveArchetypeIcons({ label: entry.label, name: entry.name }, iconMap);

  const scopeLabel = () => (tournament() === ONLINE_META_NAME ? ONLINE_META_LABEL : prettyTournamentName(tournament()));

  function cellFor(rowKey: string, colKey: string): MatrixCell | undefined {
    return matrixData()?.cells.get(rowKey)?.get(colKey);
  }

  function goToMatchups(name: string) {
    navigate(`/archetypes/${encodeURIComponent(name)}?tab=matchups`);
  }

  const loading = () => !archetypesData() || matrix.loading;

  return (
    <>
      <section class='hero'>
        <h1>Matchup matrix</h1>
        <div class='hero-meta'>
          <Show when={archetypesData()} fallback={<Skeleton width='200px' height='13px' />}>
            <span>Head-to-head win rate, row vs column</span>
            <span class='dot'>·</span>
            <span>{scopeLabel()}</span>
          </Show>
        </div>
      </section>

      <Section>
        <div class='mx-controls'>
          <div class='mx-ctl'>
            <span class='mx-ctl-label'>Order</span>
            <Segmented<OrderBy>
              options={ORDER_OPTIONS}
              selected={orderBy()}
              onSelect={setOrderBy}
              ariaLabel='Order axes'
            />
          </div>
          <div class='mx-ctl'>
            <span class='mx-ctl-label'>Show</span>
            <Segmented
              options={SIZE_OPTIONS}
              selected={String(size())}
              onSelect={v => setSize(Number(v) as Size)}
              ariaLabel='Number of archetypes'
            />
          </div>
          <div class='mx-ctl'>
            <span class='mx-ctl-label'>Min games</span>
            <ChipGroup
              options={MIN_GAMES_OPTIONS}
              selected={String(minGames())}
              onSelect={v => setMinGames(Number(v))}
            />
          </div>
          <InfoTip marker='i' label='How the matrix is computed'>
            Each cell is the row deck's win rate against the column deck, scoring a win as 3× a tie (win 3, tie 1, loss
            0). The small number is games played. Cells below the games floor are hidden; the diagonal is the mirror
            (50/50). Click a row to open that deck's matchups.
          </InfoTip>
        </div>
      </Section>

      <Section>
        <Show when={!loading()} fallback={<Skeleton height='420px' />}>
          <Show
            when={ordered().length > 0}
            fallback={
              <EmptyState
                title='No matchup matrix for this scope.'
                description='Head-to-head win rates are generated per major event and for the online meta. Pick one from the tournament selector.'
              />
            }
          >
            <div class='mx-legend' aria-hidden='true'>
              <span class='mx-legend-swatch mx-legend-unfav' /> unfavorable
              <span class='mx-legend-swatch mx-legend-mid' /> even
              <span class='mx-legend-swatch mx-legend-fav' /> favorable
            </div>
            <div class='mx-scroll'>
              <table class='mx-table'>
                <thead>
                  <tr>
                    <th class='mx-corner' scope='col'>
                      <span class='mx-corner-label'>vs →</span>
                    </th>
                    <For each={ordered()}>
                      {col => (
                        <th class='mx-colhead' scope='col' title={col.label}>
                          <ArchetypeIcons slugs={iconsFor(col)} size={22} />
                        </th>
                      )}
                    </For>
                  </tr>
                </thead>
                <tbody>
                  <For each={ordered()}>
                    {row => (
                      <tr>
                        <th
                          class='mx-rowhead is-link'
                          scope='row'
                          tabindex={0}
                          onClick={() => goToMatchups(row.name)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              goToMatchups(row.name);
                            }
                          }}
                        >
                          <ArchetypeIcons slugs={iconsFor(row)} size={20} reserveSlot />
                          <span class='mx-rowname'>{row.label}</span>
                        </th>
                        <For each={ordered()}>
                          {col => {
                            const cell = cellFor(row.key, col.key);
                            const isDiag = row.key === col.key;
                            const shown = () => Boolean(cell) && cell!.matches >= minGames();
                            return (
                              <Show
                                when={!isDiag}
                                fallback={
                                  <td class='mx-cell mx-cell-mirror' aria-label={`${row.label} mirror`}>
                                    <span class='mx-mirror-mark'>—</span>
                                  </td>
                                }
                              >
                                <Show
                                  when={shown()}
                                  fallback={<td class='mx-cell mx-cell-empty' aria-label='No data' />}
                                >
                                  <td
                                    class='mx-cell is-link'
                                    style={cellStyle(cell!.winRate)}
                                    tabindex={0}
                                    aria-label={`${row.label} vs ${col.label}: ${Math.round(cell!.winRate)} percent over ${cell!.matches} games`}
                                    onClick={() => goToMatchups(row.name)}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') {
                                        goToMatchups(row.name);
                                      }
                                    }}
                                  >
                                    <span class='mx-wr'>{Math.round(cell!.winRate)}</span>
                                    <span class='mx-n'>{cell!.matches}</span>
                                  </td>
                                </Show>
                              </Show>
                            );
                          }}
                        </For>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </Show>
        </Show>
      </Section>
    </>
  );
}
