import { A, useNavigate } from '@solidjs/router';
import { createEffect, createMemo, createResource, createSignal, For, on, Show } from 'solid-js';
import {
  fetchArchetypeDecks,
  fetchArchetypeMatches,
  fetchArchetypeMatchupsOnline,
  fetchArchetypes,
  fetchMatchupProfiles,
  fetchPlayerMatches,
  normalizeArchetypeKey
} from '../lib/data';
import {
  bucketWinRate,
  gaugeWidth,
  type MatchupRowCore,
  rowsFromMajorsProfile,
  rowsFromOnlineMatchups,
  selectKeyMatchups,
  shrunkWinRate,
  summarizeMatchups,
  WR_MIN_GAMES
} from '../lib/matchups';
import {
  buildLensRows,
  canonicalizeForLens,
  copiesByPlayer,
  type LensRow,
  partitionByCopies,
  tallyLens,
  wrOf
} from '../lib/cardLens';
import { getSynonymDatabase } from '../utils/cardSynonyms';
import { buildCardId } from '../utils/deckCardId';
import type { ArchetypeIndexEntry, ArchetypeReport, CardItem } from '../types';
import { Segmented } from './Segmented';
import { EmptyState } from './EmptyState';
import { Skeleton } from './Skeleton';
import { InfoTip } from './InfoTip';
import { buildArchetypeIndexByKey, OpponentCell, resolveOpponentMeta } from './OpponentCell';
import '../styles/pages/archetype.css';

interface MatchupsPanelProps {
  slug: string;
  label: string;
  tournament: string;
  /** Forwarded from ArchetypePage so the panel reuses the already-loaded index. */
  indexEntries?: ArchetypeIndexEntry[];
  report: ArchetypeReport;
}

type SortBy = 'winRate' | 'prevalence';

interface FieldRow extends MatchupRowCore {
  opponentSlug: string | null;
  iconSlugs: string[];
  prevalence: number | null;
}

interface LensDisplayRow {
  opponentLabel: string;
  opponentSlug: string | null;
  iconSlugs: string[];
  prevalence: number | null;
  isMirror: boolean;
  lens: LensRow;
}

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: 'winRate', label: 'Win rate' },
  { value: 'prevalence', label: 'Prevalence' }
];

/** Number of decision-relevant opponents surfaced in the Key matchups section. */
const KEY_COUNT = 5;
/** Below this many games a shown field row is faded (still visible, just quieter). */
const FIELD_MUTED = 50;
/** A lens opponent needs this many games in BOTH subsets to show by default. */
const LENS_FLOOR = 3;
/** Up to this many suggested tech-card chips in the lens drawer. */
const CHIP_COUNT = 4;
/** Tech-card inclusion band (share of lists), mirrored from ArchetypePage's Tech tab. */
const CORE_THRESHOLD = 90;
const TECH_THRESHOLD = 30;

/** Whole-number win-rate readout, or an em-dash placeholder for low-sample rows. */
function fmtWinRate(n: number | null): string {
  return n === null || !Number.isFinite(n) ? '—' : `${Math.round(n)}%`;
}

/** Field-share readout: one decimal, e.g. "12.7%". Empty when unknown. */
function fmtShare(n: number | null): string {
  return n === null || !Number.isFinite(n) ? '' : `${n.toFixed(1)}%`;
}

/** Win-rate delta in whole percentage points, signed, for the lens rows. */
function fmtDeltaPp(n: number | null): string {
  if (n === null || !Number.isFinite(n)) {
    return '—';
  }
  return `${n > 0 ? '+' : ''}${Math.round(n)}pp`;
}

/**
 * Per-row tone keyed off the exact 50% center (not the overview's 48-52 band):
 * above 50 reads favored (green), below reads unfavored (red), exactly 50 is
 * neutral. This is the redundant, non-color encoding of the gauge fill's hue.
 */
function toneClass(wr: number | null): string {
  if (wr === null || !Number.isFinite(wr) || Math.abs(wr - 50) < 0.5) {
    return 'mu-flat';
  }
  return wr > 50 ? 'mu-pos' : 'mu-neg';
}

/** Sort desc by prevalence (when chosen) else by the quality metric, nulls last. */
function sortByMode<T>(
  rows: T[],
  mode: SortBy,
  quality: (t: T) => number | null,
  prevalence: (t: T) => number | null
): T[] {
  const cmp = (a: number | null, b: number | null) => {
    if (a === null && b === null) {
      return 0;
    }
    if (a === null) {
      return 1;
    }
    if (b === null) {
      return -1;
    }
    return b - a;
  };
  return [...rows].sort((a, b) => {
    if (mode === 'prevalence') {
      const p = cmp(prevalence(a), prevalence(b));
      if (p !== 0) {
        return p;
      }
    }
    return cmp(quality(a), quality(b));
  });
}

export function MatchupsPanel(props: MatchupsPanelProps) {
  const navigate = useNavigate();

  // Field data: the pre-aggregated matrix (majors) or the online matchups map.
  // Both fetches start immediately in parallel — whichever source has data wins
  // (majors: profiles; online: trends) — rather than waiting on profiles first.
  const [profiles] = createResource(() => props.tournament, fetchMatchupProfiles);
  const [onlineMatchups] = createResource(
    () => ({ t: props.tournament, slug: props.slug }),
    src => fetchArchetypeMatchupsOnline(src.t, src.slug)
  );
  const [indexFallback] = createResource(() => (props.indexEntries ? false : props.tournament), fetchArchetypes);
  const indexEntries = (): ArchetypeIndexEntry[] => props.indexEntries ?? indexFallback() ?? [];
  const indexByKey = createMemo(() => buildArchetypeIndexByKey(indexEntries()));

  const [sortBy, setSortBy] = createSignal<SortBy>('winRate');

  // Card lens state.
  const [engaged, setEngaged] = createSignal(false); // gates the heavy fetches
  const [lensCard, setLensCard] = createSignal<{ cardId: string; name: string } | null>(null);
  const [minCopies, setMinCopies] = createSignal(1);
  const [search, setSearch] = createSignal('');
  const [highlighted, setHighlighted] = createSignal(0);
  const [showAllLens, setShowAllLens] = createSignal(false);

  // Heavy, lazy resources — only fetched once the lens is engaged.
  const [decks] = createResource(
    () => (engaged() ? { t: props.tournament, slug: props.slug } : false),
    ({ t, slug }) => fetchArchetypeDecks(t, slug)
  );
  // Prefer the per-archetype slice (a few KB); fall back to the whole-event
  // playerMatches.json (~7MB) for tournaments ingested before the slice existed.
  const [matches] = createResource(
    () => (engaged() ? { t: props.tournament, slug: props.slug } : false),
    async ({ t, slug }) => (await fetchArchetypeMatches(t, slug)) ?? fetchPlayerMatches(t)
  );
  const [synonymDb] = createResource(
    () => Boolean(engaged()),
    () => getSynonymDatabase()
  );

  // Reset when the archetype/tournament changes without unmounting.
  createEffect(
    on(
      [() => props.slug, () => props.tournament],
      () => {
        setSortBy('winRate');
        setEngaged(false);
        setLensCard(null);
        setMinCopies(1);
        setSearch('');
        setShowAllLens(false);
      },
      { defer: true }
    )
  );

  const isMajors = () => Boolean(profiles());
  const isOnline = () => !isMajors() && Boolean(onlineMatchups());
  // Wait for both sources to settle unless majors already has data (the preferred
  // source), so we don't flash the empty state while online is still in flight.
  const loading = () => (profiles.loading || onlineMatchups.loading) && !isMajors();

  // ---- Field rows — always quality-weighted for majors. Mirror INCLUDED (it now
  // lives in "Rest of the field" and counts toward the overview as an even row).
  const fieldRows = createMemo<FieldRow[]>(() => {
    const payload = profiles();
    const majorsProfile = payload?.profiles.qualityWeighted ?? payload?.profiles.all;
    const cores: MatchupRowCore[] = majorsProfile
      ? rowsFromMajorsProfile(majorsProfile, props.label)
      : onlineMatchups()
        ? rowsFromOnlineMatchups(onlineMatchups()!, props.label)
        : [];
    return cores.map(core => {
      const meta = resolveOpponentMeta(core.opponentLabel, indexByKey());
      return { ...core, opponentSlug: meta.slug, iconSlugs: meta.iconSlugs, prevalence: meta.percent };
    });
  });

  // Overview summary + strip proportions (derived counts only, no editorial copy).
  const summary = createMemo(() =>
    summarizeMatchups(
      fieldRows().map(r => ({
        opponentLabel: r.opponentLabel,
        winRate: r.winRate,
        matches: r.matches,
        fieldShare: r.prevalence,
        isMirror: r.isMirror
      }))
    )
  );

  // The 5 most decision-relevant opponents (mirror + low-sample excluded), by
  // importance = fieldShare * sqrt(max(|WR-50|,1)), displayed by field share desc.
  const keyRows = createMemo<FieldRow[]>(() =>
    selectKeyMatchups(
      fieldRows().map(r => ({ ...r, fieldShare: r.prevalence })),
      WR_MIN_GAMES,
      KEY_COUNT
    ).map(({ fieldShare: _fieldShare, ...row }) => row)
  );

  const keyStats = createMemo(() => {
    const rows = keyRows();
    let favored = 0;
    let even = 0;
    let unfavored = 0;
    let shareSum = 0;
    for (const r of rows) {
      const bucket = bucketWinRate(r.winRate);
      if (bucket === 'fav') {
        favored += 1;
      } else if (bucket === 'even') {
        even += 1;
      } else {
        unfavored += 1;
      }
      shareSum += r.prevalence ?? 0;
    }
    return { favored, even, unfavored, shareSum };
  });

  // Rest of the field: everything not surfaced as a key row (mirror included),
  // split into a shown set (>= WR_MIN_GAMES games) and low-sample rows behind the
  // expander. Ordered by the chosen sort; win rate uses a sample-adjusted metric.
  const restRows = createMemo<FieldRow[]>(() => {
    const keySet = new Set(keyRows().map(r => r.opponentLabel));
    const rows = fieldRows().filter(r => !keySet.has(r.opponentLabel));
    return sortByMode(
      rows,
      sortBy(),
      r => shrunkWinRate(r.wins, r.ties, r.matches),
      r => r.prevalence
    );
  });
  const restVisible = createMemo(() => restRows().filter(r => r.matches >= WR_MIN_GAMES));
  const restLowSample = createMemo(() => restRows().filter(r => r.matches < WR_MIN_GAMES));

  // ---- Lens rows ----
  const lensDecks = createMemo(() => {
    const raw = decks();
    return raw ? canonicalizeForLens(raw, synonymDb()) : null;
  });

  const lensCopies = createMemo(() => {
    const card = lensCard();
    const ds = lensDecks();
    if (!card || !ds) {
      return null;
    }
    return copiesByPlayer(ds, card.cardId);
  });

  const lensTallies = createMemo(() => {
    const copies = lensCopies();
    const ms = matches();
    if (!copies || !ms) {
      return null;
    }
    const part = partitionByCopies(copies, minCopies());
    return { part, ...tallyLens(ms, part) };
  });

  const lensLoading = () => Boolean(lensCard()) && !lensTallies();

  const lensOverall = createMemo(() => {
    const t = lensTallies();
    if (!t) {
      return null;
    }
    const w = wrOf(t.withOverall);
    const wo = wrOf(t.withoutOverall);
    return {
      withWR: w,
      withoutWR: wo,
      delta: w !== null && wo !== null ? w - wo : null,
      withCount: t.part.withCount,
      withoutCount: t.part.withoutCount
    };
  });

  const lensRows = createMemo<LensDisplayRow[]>(() => {
    const t = lensTallies();
    if (!t) {
      return [];
    }
    const rows = buildLensRows(t)
      .filter(r => showAllLens() || (r.withRec.n >= LENS_FLOOR && r.withoutRec.n >= LENS_FLOOR))
      .map(lens => {
        const meta = resolveOpponentMeta(lens.opponent, indexByKey());
        return {
          opponentLabel: lens.opponent,
          opponentSlug: meta.slug,
          iconSlugs: meta.iconSlugs,
          prevalence: meta.percent,
          isMirror: normalizeArchetypeKey(lens.opponent) === normalizeArchetypeKey(props.label),
          lens
        };
      });
    return sortByMode(
      rows,
      sortBy(),
      r => r.lens.delta,
      r => r.prevalence
    );
  });
  const lensHidden = createMemo(() => {
    const t = lensTallies();
    return t ? buildLensRows(t).length - lensRows().length : 0;
  });

  // ---- Suggested tech-card chips (reuse the Tech tab's source: report items in
  // the 30-90% inclusion band, most-played first). Empty → search-only fallback.
  const techSuggestions = createMemo<{ cardId: string; name: string; label: string }[]>(() => {
    return (props.report.items as CardItem[])
      .filter(
        i =>
          i.set &&
          i.number !== undefined &&
          i.number !== null &&
          (i.pct ?? 0) >= TECH_THRESHOLD &&
          (i.pct ?? 0) < CORE_THRESHOLD
      )
      .sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0))
      .slice(0, CHIP_COUNT)
      .map(i => ({
        cardId: buildCardId(i.set!, i.number!),
        name: i.name,
        label: `${i.name} ${i.set} ${i.number}`
      }));
  });

  // ---- Card search ----
  const candidates = createMemo<CardItem[]>(() => {
    const q = search().trim().toLowerCase();
    if (!q) {
      return [];
    }
    return (props.report.items as CardItem[])
      .filter(i => i.set && i.number !== undefined && i.number !== null && i.name.toLowerCase().includes(q))
      .slice(0, 8);
  });

  function pickCard(cardId: string, name: string) {
    setEngaged(true);
    setLensCard({ cardId, name });
    setSearch('');
    setShowAllLens(false);
  }
  function pick(item: CardItem) {
    if (!item.set || item.number === undefined || item.number === null) {
      return;
    }
    pickCard(buildCardId(item.set, item.number), item.name);
  }
  function clearLens() {
    setLensCard(null);
    setSearch('');
    setShowAllLens(false);
  }

  function go(slug: string | null) {
    if (slug) {
      navigate(`/archetypes/${slug}`);
    }
  }

  return (
    <div class='matchups'>
      <Show when={!loading()} fallback={<Skeleton height='320px' />}>
        <Show
          when={isMajors() || isOnline()}
          fallback={
            <EmptyState
              title='No matchups for this scope.'
              description='Head-to-head win rates are generated per major event and for the online meta. Pick one from the tournament selector.'
            />
          }
        >
          <Show
            when={fieldRows().length > 0}
            fallback={<EmptyState title={`No recorded matchups for ${props.label} here.`} />}
          >
            {/* ===== 1. Overview ===== */}
            <Show when={summary().tracked > 0 ? summary() : undefined}>
              {overview => {
                const total = () => Math.max(1, overview().favored + overview().even + overview().unfavored);
                const pct = (n: number) => `${(n / total()) * 100}%`;
                return (
                  <>
                    <div class='r2-overview'>
                      <div
                        class='r2-strip'
                        role='img'
                        aria-label={`${overview().favored} favored, ${overview().even} even, ${overview().unfavored} unfavored of ${overview().tracked} tracked matchups`}
                      >
                        <Show when={overview().favored > 0}>
                          <span class='r2-strip-seg fav' style={{ width: pct(overview().favored) }} />
                        </Show>
                        <Show when={overview().even > 0}>
                          <span class='r2-strip-seg even' style={{ width: pct(overview().even) }} />
                        </Show>
                        <Show when={overview().unfavored > 0}>
                          <span class='r2-strip-seg unf' style={{ width: pct(overview().unfavored) }} />
                        </Show>
                      </div>
                      <div class='r2-strip-labels'>
                        <span>
                          <span class='r2-swatch fav' />
                          <b>{overview().favored}</b> favored
                        </span>
                        <span>
                          <span class='r2-swatch even' />
                          <b>{overview().even}</b> even
                        </span>
                        <span>
                          <span class='r2-swatch unf' />
                          <b>{overview().unfavored}</b> unfavored
                        </span>
                      </div>
                    </div>
                    <p class='mu-summary'>
                      Favored in <b>{overview().favored}</b> of <b>{overview().tracked}</b> tracked matchups,{' '}
                      <b>{overview().even}</b> even, <b>{overview().unfavored}</b> unfavored.
                      <Show when={overview().best && overview().toughest}>
                        {' '}
                        Best against <b>{overview().best!.label}</b> ({Math.round(overview().best!.winRate)}%), toughest
                        against <b>{overview().toughest!.label}</b> ({Math.round(overview().toughest!.winRate)}%).
                      </Show>
                    </p>
                  </>
                );
              }}
            </Show>

            {/* ===== 2. Key matchups ===== */}
            <Show when={keyRows().length > 0}>
              <div class='r2-sec'>
                <div class='r2-sechead'>
                  <span class='r2-sechead-title'>Key matchups</span>
                  <span class='r2-sechead-count'>{keyRows().length}</span>
                  <span class='r2-sechead-note'>most decision-relevant</span>
                </div>
                <p class='rf-subline'>
                  These <b>{keyRows().length}</b> key opponents make up <b>{Math.round(keyStats().shareSum)}%</b> of the
                  tracked field, ordered by field share. Favored in <b>{keyStats().favored}</b>, even in{' '}
                  <b>{keyStats().even}</b>, unfavored in <b>{keyStats().unfavored}</b>.
                </p>
                <div class='mu-list'>
                  <For each={keyRows()}>{row => <KeyMatchupRow row={row} onGo={go} />}</For>
                </div>
              </div>
            </Show>

            {/* ===== 3. Rest of the field ===== */}
            <div class='r2-sec'>
              <div class='r2-sechead'>
                <span class='r2-sechead-title'>Rest of the field</span>
                <span class='r2-sechead-count'>{restVisible().length}</span>
                <span class='r2-sechead-note'>best to worst</span>
                <div class='mu-sort'>
                  <Segmented<SortBy>
                    options={SORT_OPTIONS}
                    selected={sortBy()}
                    onSelect={setSortBy}
                    ariaLabel='Sort matchups'
                  />
                  <InfoTip marker='i' label='How matchups are computed'>
                    <Show when={isMajors()} fallback={<>Aggregated across recent online events. </>}>
                      Quality-weighted: games in later rounds and against stronger opponents count for more.{' '}
                    </Show>
                    Win rate scores a win as 3× a tie (win 3, tie 1, loss 0). The % by each deck is its share of the
                    field. Rows are ordered by a sample-size-adjusted win rate so a 2-0 matchup does not outrank a
                    proven one.
                  </InfoTip>
                </div>
              </div>
              <div class='mu-list'>
                <For each={restVisible()}>{row => <RestMatchupRow row={row} onGo={go} />}</For>
              </div>
              <Show when={restLowSample().length > 0}>
                <details class='r2-more'>
                  <summary>
                    Show {restLowSample().length} low-sample matchups (&lt; {WR_MIN_GAMES} games)
                  </summary>
                  <div class='mu-list' style={{ 'margin-top': '8px' }}>
                    <For each={restLowSample()}>{row => <RestMatchupRow row={row} onGo={go} />}</For>
                  </div>
                </details>
              </Show>
            </div>

            {/* ===== 4. Card lens, demoted ===== */}
            <div class='r2-lens'>
              <details onToggle={e => e.currentTarget.open && setEngaged(true)}>
                <summary>
                  <span class='r2-lens-plus'>+</span> Compare with a specific card
                </summary>
                <div class='r2-lens-body'>
                  <Show when={techSuggestions().length > 0}>
                    <div class='rf-chips' role='group' aria-label='Suggested tech cards'>
                      <For each={techSuggestions()}>
                        {chip => (
                          <button
                            type='button'
                            class='rf-chip'
                            classList={{ 'is-active': lensCard()?.cardId === chip.cardId }}
                            aria-pressed={lensCard()?.cardId === chip.cardId}
                            onClick={() => pickCard(chip.cardId, chip.name)}
                          >
                            {chip.label}
                          </button>
                        )}
                      </For>
                    </div>
                  </Show>

                  <div class='rf-search-wrap'>
                    <input
                      class='rf-search'
                      type='search'
                      placeholder='Search all cards…'
                      aria-label='Search all cards'
                      value={search()}
                      onFocus={() => setEngaged(true)}
                      onInput={e => {
                        setSearch(e.currentTarget.value);
                        setHighlighted(0);
                      }}
                      onKeyDown={e => {
                        const list = candidates();
                        if (e.key === 'ArrowDown') {
                          e.preventDefault();
                          setHighlighted(h => Math.min(list.length - 1, h + 1));
                        } else if (e.key === 'ArrowUp') {
                          e.preventDefault();
                          setHighlighted(h => Math.max(0, h - 1));
                        } else if (e.key === 'Enter') {
                          e.preventDefault();
                          const item = list[highlighted()];
                          if (item) {
                            pick(item);
                          }
                        } else if (e.key === 'Escape') {
                          setSearch('');
                        }
                      }}
                    />
                    <Show when={candidates().length > 0}>
                      <div class='fb-b-popover'>
                        <For each={candidates()}>
                          {(item, idx) => (
                            <div
                              class={`item ${idx() === highlighted() ? 'highlighted' : ''}`}
                              onMouseDown={e => {
                                e.preventDefault();
                                pick(item);
                              }}
                              onMouseEnter={() => setHighlighted(idx())}
                            >
                              <span class='name'>{item.name}</span>
                              <span class='meta'>
                                {item.set}/{item.number} · {(item.pct ?? 0).toFixed(1)}%
                              </span>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>

                  <Show when={lensCard()}>
                    <div class='r2-lens-controls'>
                      <span class='mu-lens-chip'>
                        <span class='mu-lens-name'>{lensCard()!.name}</span>
                        <span class='mu-copies'>
                          ≥
                          <input
                            type='number'
                            min='1'
                            max='4'
                            value={minCopies()}
                            aria-label='Minimum copies'
                            onInput={e => {
                              const v = Number.parseInt(e.currentTarget.value, 10);
                              if (Number.isFinite(v) && v >= 1) {
                                setMinCopies(Math.min(4, v));
                              }
                            }}
                          />
                        </span>
                        <button type='button' class='mu-lens-clear' aria-label='Remove card' onClick={clearLens}>
                          ✕
                        </button>
                      </span>
                    </div>

                    <Show when={!lensLoading()} fallback={<p class='r2-lens-hint'>Loading match data…</p>}>
                      <Show when={lensOverall()}>
                        {overall => (
                          <p class='r2-lens-hint'>
                            Win rate with at least {minCopies()} cop{minCopies() === 1 ? 'y' : 'ies'} versus without,
                            across shared matchups. Overall <b>{fmtWinRate(overall().withWR)}</b> with vs{' '}
                            <b>{fmtWinRate(overall().withoutWR)}</b> without, over {overall().withCount} of{' '}
                            {overall().withCount + overall().withoutCount} decks.
                          </p>
                        )}
                      </Show>

                      <Show
                        when={lensRows().length > 0}
                        fallback={
                          <EmptyState
                            title='Not enough games to compare.'
                            actions={
                              <button class='btn btn-secondary' type='button' onClick={() => setShowAllLens(true)}>
                                Show all opponents
                              </button>
                            }
                          />
                        }
                      >
                        <div class='r2-lens-list'>
                          <For each={lensRows()}>{row => <LensDisplayRowView row={row} onGo={go} />}</For>
                        </div>
                        <Show when={lensHidden() > 0 && !showAllLens()}>
                          <button type='button' class='mu-more' onClick={() => setShowAllLens(true)}>
                            Show {lensHidden()} low-sample matchups
                          </button>
                        </Show>
                      </Show>
                    </Show>
                  </Show>
                </div>
              </details>
            </div>
          </Show>
        </Show>
      </Show>
    </div>
  );
}

/** The gauge: a half-width deviation bar, empty at even, green above / red below. */
function Gauge(props: { winRate: number | null; matches: number }) {
  const shown = () => props.matches >= WR_MIN_GAMES && props.winRate !== null;
  const width = () => (shown() ? gaugeWidth(props.winRate!) : 0);
  return (
    <span class='mu-gauge' aria-hidden='true'>
      <span class={`mu-gauge-fill ${toneClass(shown() ? props.winRate : null)}`} style={{ width: `${width()}%` }} />
    </span>
  );
}

/** W-L-T record + total games; double losses fold into the shown loss count. */
function RowStats(props: { row: FieldRow }) {
  const wr = () => (props.row.matches >= WR_MIN_GAMES ? props.row.winRate : null);
  const lossesShown = () => props.row.losses + props.row.doubleLosses;
  return (
    <div class='mu-stats'>
      <span class={`mu-wr ${toneClass(wr())}`}>{fmtWinRate(wr())}</span>
      <span class='mu-rec'>
        {props.row.wins}-{lossesShown()}-{props.row.ties} · {props.row.matches.toLocaleString()}
      </span>
    </div>
  );
}

/**
 * Hover-revealed deep link to the matchup matrix. The matrix page focuses no
 * specific pair (it reads only the global tournament + navigates by row), so we
 * link to /matchups plainly.
 * TODO: focus this opponent's row/cell once MatchupMatrixPage supports a pair anchor.
 */
function MatrixLink(props: { label: string }) {
  return (
    <A
      class='rf-link'
      href='/matchups'
      aria-label={`Open ${props.label} in the matchup matrix`}
      onClick={e => e.stopPropagation()}
    >
      ↗
    </A>
  );
}

function rowNav(row: FieldRow, onGo: (slug: string | null) => void) {
  return {
    classList: { 'is-link': Boolean(row.opponentSlug), 'mu-low': row.matches < FIELD_MUTED },
    role: row.opponentSlug ? ('link' as const) : undefined,
    tabindex: row.opponentSlug ? 0 : undefined,
    onClick: () => onGo(row.opponentSlug),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        onGo(row.opponentSlug);
      }
    }
  };
}

/** A large, decision-relevant Key matchup row. */
function KeyMatchupRow(props: { row: FieldRow; onGo: (slug: string | null) => void }) {
  const nav = () => rowNav(props.row, props.onGo);
  return (
    <div class='r2-krow' {...nav()}>
      <div class='r2-kname'>
        <OpponentCell
          label={props.row.isMirror ? `${props.row.opponentLabel} (mirror)` : props.row.opponentLabel}
          iconSlugs={props.row.iconSlugs}
        />
        <Show when={props.row.prevalence !== null}>
          <span class='r2-share'>{fmtShare(props.row.prevalence)} of field</span>
        </Show>
      </div>
      <Gauge winRate={props.row.winRate} matches={props.row.matches} />
      <RowStats row={props.row} />
      <MatrixLink label={props.row.opponentLabel} />
    </div>
  );
}

/** A compact Rest-of-the-field matchup row. */
function RestMatchupRow(props: { row: FieldRow; onGo: (slug: string | null) => void }) {
  const nav = () => rowNav(props.row, props.onGo);
  return (
    <div class='r2-rrow' {...nav()}>
      <div class='r2-rname'>
        <OpponentCell
          label={props.row.isMirror ? `${props.row.opponentLabel} (mirror)` : props.row.opponentLabel}
          iconSlugs={props.row.iconSlugs}
        />
        <Show when={props.row.prevalence !== null}>
          <span class='mu-meta' title='Share of the field'>
            {fmtShare(props.row.prevalence)}
          </span>
        </Show>
      </div>
      <Gauge winRate={props.row.winRate} matches={props.row.matches} />
      <RowStats row={props.row} />
      <MatrixLink label={props.row.opponentLabel} />
    </div>
  );
}

/** One lens comparison row: opponent, with/without win rates, delta chip. */
function LensDisplayRowView(props: { row: LensDisplayRow; onGo: (slug: string | null) => void }) {
  const lens = () => props.row.lens;
  return (
    <div
      class='r2-lensrow'
      classList={{ 'is-link': Boolean(props.row.opponentSlug) }}
      role={props.row.opponentSlug ? 'link' : undefined}
      tabindex={props.row.opponentSlug ? 0 : undefined}
      onClick={() => props.onGo(props.row.opponentSlug)}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          props.onGo(props.row.opponentSlug);
        }
      }}
    >
      <div class='mu-name'>
        <OpponentCell
          label={props.row.isMirror ? `${props.row.opponentLabel} (mirror)` : props.row.opponentLabel}
          iconSlugs={props.row.iconSlugs}
        />
      </div>
      <span class='r2-ww'>
        <span>
          with <b class='num'>{fmtWinRate(lens().withWR)}</b>
        </span>
        <span>
          without <b class='num'>{fmtWinRate(lens().withoutWR)}</b>
        </span>
      </span>
      <span class={`r2-delta ${toneClass(lens().delta === null ? null : 50 + lens().delta!)}`}>
        {fmtDeltaPp(lens().delta)}
      </span>
    </div>
  );
}
