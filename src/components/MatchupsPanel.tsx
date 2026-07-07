import { useNavigate } from '@solidjs/router';
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
import { type MatchupRowCore, rowsFromMajorsProfile, rowsFromOnlineMatchups, shrunkWinRate } from '../lib/matchups';
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

/** Hide opponents below this many games unless the user expands. */
const FIELD_FLOOR = 5;
/** Below this many games a shown field row is faded (still visible, just quieter). */
const FIELD_LOW_SAMPLE = 20;
/** A lens opponent needs this many games in BOTH subsets to show by default. */
const LENS_FLOOR = 3;

/**
 * Map a win rate (0..100) to an x position (0..100) on the diverging bar.
 * Sqrt scaling expands the common 50–70% range (where matchups actually cluster)
 * while still differentiating blowouts. `extent` is how far ±50pp reaches from the
 * 50% center: the field fill uses the full half (50) so 0%/100% fill to the track
 * edge; the lens markers use 42 to keep the edges clear.
 */
function barX(wr: number, extent = 42): number {
  const dev = Math.max(-50, Math.min(50, wr - 50));
  return 50 + Math.sign(dev) * Math.sqrt(Math.abs(dev) / 50) * extent;
}

function fmtPct(n: number | null): string {
  return n === null || !Number.isFinite(n) ? '—' : `${n.toFixed(1)}%`;
}

function fmtShare(n: number | null): string {
  return n === null || !Number.isFinite(n) ? '' : `${n.toFixed(n < 1 ? 1 : 0)}%`;
}

function fmtDelta(n: number | null): string {
  if (n === null || !Number.isFinite(n)) {
    return '—';
  }
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}`;
}

function signClass(n: number | null, flat = 0.05): string {
  if (n === null || !Number.isFinite(n) || Math.abs(n) < flat) {
    return 'mu-flat';
  }
  return n > 0 ? 'mu-pos' : 'mu-neg';
}

/**
 * Signed percentage-point readout for a diverging bar (deviation from the 50%
 * center). This is a non-color redundant encoding of favorable/unfavorable
 * direction: the +/− sign carries the same information as the fill color, so
 * the bar reads correctly without relying on hue.
 */
function fmtBarPp(dev: number | null, flat: number): string {
  if (dev === null || !Number.isFinite(dev)) {
    return '';
  }
  if (Math.abs(dev) < flat) {
    return '±0pp';
  }
  const rounded = Math.round(Math.abs(dev));
  return `${dev > 0 ? '+' : '−'}${rounded}pp`;
}

/** Which side of the diverging bar a pp label should sit on, given its deviation. */
function ppSideClass(dev: number | null, flat: number): string {
  if (dev === null || !Number.isFinite(dev) || Math.abs(dev) < flat) {
    return 'mu-bar-pp-center';
  }
  return dev > 0 ? 'mu-bar-pp-right' : 'mu-bar-pp-left';
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
  const [showAllField, setShowAllField] = createSignal(false);

  // Card lens state.
  const [engaged, setEngaged] = createSignal(false); // gates the heavy fetches
  const [pickerOpen, setPickerOpen] = createSignal(false);
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
        setShowAllField(false);
        setEngaged(false);
        setPickerOpen(false);
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
  const showMeta = () => sortBy() === 'prevalence';

  // ---- Field rows (Source A) — always quality-weighted for majors ----
  const fieldRows = createMemo<FieldRow[]>(() => {
    const payload = profiles();
    const majorsProfile = payload?.profiles.qualityWeighted ?? payload?.profiles.all;
    const cores: MatchupRowCore[] = majorsProfile
      ? rowsFromMajorsProfile(majorsProfile, props.label)
      : onlineMatchups()
        ? rowsFromOnlineMatchups(onlineMatchups()!, props.label)
        : [];
    // The mirror is definitionally ~50/50, so omit it from the field view; it
    // still appears in the card lens, where a tech card can shift it.
    const rows = cores
      .filter(c => !c.isMirror)
      .map(core => {
        const meta = resolveOpponentMeta(core.opponentLabel, indexByKey());
        return {
          ...core,
          opponentSlug: meta.slug,
          iconSlugs: meta.iconSlugs,
          prevalence: meta.percent
        };
      });
    // Order by a sample-size-adjusted win rate so a 5-0 fringe matchup can't
    // outrank a proven 65% over 200 games. The RAW winRate is still displayed.
    return sortByMode(
      rows,
      sortBy(),
      r => shrunkWinRate(r.wins, r.ties, r.matches),
      r => r.prevalence
    );
  });

  const fieldVisible = createMemo(() =>
    showAllField() ? fieldRows() : fieldRows().filter(r => r.matches >= FIELD_FLOOR)
  );
  const fieldHidden = createMemo(() => fieldRows().length - fieldVisible().length);

  // ---- Lens rows (Source B) ----
  const lensDecks = createMemo(() => {
    const raw = decks();
    return raw ? canonicalizeForLens(raw, synonymDb()) : null;
  });

  // Copies-per-player only depends on the deck list + selected card, so it's
  // memoized independently: changing `minCopies` re-splits this map instead of
  // rescanning every deck's cards.
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

  const lensActive = () => Boolean(lensTallies());
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

  // ---- Card picker ----
  const candidates = createMemo<CardItem[]>(() => {
    const q = search().trim().toLowerCase();
    if (!q) {
      return [];
    }
    return (props.report.items as CardItem[])
      .filter(i => i.set && i.number !== undefined && i.number !== null && i.name.toLowerCase().includes(q))
      .slice(0, 8);
  });

  function openPicker() {
    setEngaged(true); // start prefetching the heavy data while the user searches
    setPickerOpen(true);
    setSearch('');
    setHighlighted(0);
  }
  function pick(item: CardItem) {
    if (!item.set || item.number === undefined || item.number === null) {
      return;
    }
    setLensCard({ cardId: buildCardId(item.set, item.number), name: item.name });
    setPickerOpen(false);
    setSearch('');
    setShowAllLens(false);
  }
  function clearLens() {
    setLensCard(null);
    setPickerOpen(false);
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
            {/* Controls */}
            <div class='mu-controls'>
              <div class='mu-controls-start'>
                <span class='mu-ctl-label'>Sort</span>
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
                  field. Rows are ordered by a sample-size-adjusted win rate so a 2-0 matchup does not outrank a proven
                  one. The bar emphasizes the common 50 to 70 percent range, with 50 percent marked at the center.
                </InfoTip>
              </div>

              <div class='mu-controls-end'>
                <Show
                  when={lensCard()}
                  fallback={
                    <button type='button' class='mu-lens-add' onClick={openPicker}>
                      <span class='mu-lens-plus'>+</span> Compare a card
                    </button>
                  }
                >
                  <div class='mu-lens-chip'>
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
                    <button type='button' class='mu-lens-clear' aria-label='Clear card lens' onClick={clearLens}>
                      ✕
                    </button>
                  </div>
                </Show>
              </div>
            </div>

            {/* Card search */}
            <Show when={pickerOpen()}>
              <div class='mu-search'>
                <input
                  type='text'
                  autofocus
                  placeholder={`Search a ${props.label} card to compare…`}
                  value={search()}
                  onInput={e => {
                    setSearch(e.currentTarget.value);
                    setHighlighted(0);
                  }}
                  onBlur={() => window.setTimeout(() => setPickerOpen(false), 140)}
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
                      setPickerOpen(false);
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
            </Show>

            {/* Lens summary */}
            <Show when={lensCard()}>
              <Show when={!lensLoading()} fallback={<p class='mu-summary mu-summary-loading'>Loading match data…</p>}>
                <Show when={lensOverall()}>
                  {summary => (
                    <p class='mu-summary'>
                      Overall <b>{fmtPct(summary().withWR)}</b> with the card vs <b>{fmtPct(summary().withoutWR)}</b>{' '}
                      without{' '}
                      <span class={`mu-summary-delta ${signClass(summary().delta)}`}>
                        {fmtDelta(summary().delta)} pp
                      </span>{' '}
                      <span class='mu-summary-sub'>
                        · {summary().withCount} of {summary().withCount + summary().withoutCount} decks run ≥{' '}
                        {minCopies()}
                      </span>
                      <InfoTip marker='i' label='About this comparison'>
                        Splitting by a single card makes small samples, so treat per-matchup deltas as directional.
                        Sorted by {sortBy() === 'prevalence' ? 'how common the opponent is' : 'biggest win-rate swing'}.
                      </InfoTip>
                    </p>
                  )}
                </Show>
              </Show>
            </Show>

            {/* The bar list */}
            <Show
              when={lensActive()}
              fallback={
                <div class='mu-list'>
                  <div class='mu-axis-head' aria-hidden='true'>
                    <span />
                    <span class='mu-axis-track'>
                      <span class='mu-axis-tick'>50%</span>
                    </span>
                    <span />
                  </div>
                  <For each={fieldVisible()}>{row => <FieldBar row={row} showMeta={showMeta()} onGo={go} />}</For>
                  <Show when={fieldHidden() > 0 && !showAllField()}>
                    <button type='button' class='mu-more' onClick={() => setShowAllField(true)}>
                      Show {fieldHidden()} rarer matchups (&lt; {FIELD_FLOOR} games)
                    </button>
                  </Show>
                </div>
              }
            >
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
                <div class='mu-list mu-list-lens'>
                  <div class='mu-legend'>
                    <span class='mu-legend-item'>
                      <span class='mu-mk mu-mk-out' /> without card
                    </span>
                    <span class='mu-legend-item'>
                      <span class='mu-mk mu-mk-in' /> with card
                    </span>
                  </div>
                  <For each={lensRows()}>{row => <LensBar row={row} showMeta={showMeta()} onGo={go} />}</For>
                  <Show when={lensHidden() > 0 && !showAllLens()}>
                    <button type='button' class='mu-more' onClick={() => setShowAllLens(true)}>
                      Show {lensHidden()} low-sample matchups
                    </button>
                  </Show>
                </div>
              </Show>
            </Show>
          </Show>
        </Show>
      </Show>
    </div>
  );
}

function MetaShare(props: { value: number | null; show: boolean }) {
  return (
    <Show when={props.show && props.value !== null}>
      <span class='mu-meta' title='Share of the field'>
        {fmtShare(props.value)}
      </span>
    </Show>
  );
}

/** One field matchup: a diverging win-rate bar. */
function FieldBar(props: { row: FieldRow; showMeta: boolean; onGo: (slug: string | null) => void }) {
  const wr = () => props.row.winRate;
  const pos = () => barX(wr(), 50); // field fill reaches the track edge at 0%/100%
  const dev = () => wr() - 50;
  const fillLeft = () => Math.min(50, pos());
  const fillWidth = () => Math.abs(pos() - 50);
  const tone = () => (Math.abs(wr() - 50) < 0.5 ? 'mu-flat' : wr() > 50 ? 'mu-pos' : 'mu-neg');
  // Fold double losses into the displayed loss count (a double loss is a loss for
  // us too), so W-L-T sums to the game total instead of appearing short by `d`.
  const lossesShown = () => props.row.losses + props.row.doubleLosses;
  return (
    <div
      class='mu-row'
      classList={{ 'is-link': Boolean(props.row.opponentSlug), 'mu-low': props.row.matches < FIELD_LOW_SAMPLE }}
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
        <MetaShare value={props.row.prevalence} show={props.showMeta} />
      </div>
      <div class='mu-bar'>
        <span class='mu-bar-axis' />
        <span class={`mu-bar-fill ${tone()}`} style={{ left: `${fillLeft()}%`, width: `${fillWidth()}%` }} />
        <span class={`mu-bar-pp ${ppSideClass(dev(), 0.5)}`} style={{ left: `${pos()}%` }}>
          {fmtBarPp(dev(), 0.5)}
        </span>
      </div>
      <div class='mu-stats'>
        <span class={`mu-wr ${tone()}`}>{fmtPct(wr())}</span>
        <span class='mu-rec'>
          {props.row.wins}–{lossesShown()}–{props.row.ties} · {props.row.matches.toLocaleString()}
        </span>
      </div>
    </div>
  );
}

/** One lens matchup: two markers (without ○ / with ●) on the same axis + delta. */
function LensBar(props: { row: LensDisplayRow; showMeta: boolean; onGo: (slug: string | null) => void }) {
  const w = () => props.row.lens.withWR;
  const wo = () => props.row.lens.withoutWR;
  const xIn = () => (w() === null ? null : barX(w()!));
  const xOut = () => (wo() === null ? null : barX(wo()!));
  const lineLeft = () => Math.min(xIn() ?? 50, xOut() ?? 50);
  const lineWidth = () => Math.abs((xIn() ?? 50) - (xOut() ?? 50));
  const lowSample = () => props.row.lens.withRec.n < LENS_FLOOR || props.row.lens.withoutRec.n < LENS_FLOOR;
  return (
    <div
      class='mu-row mu-row-lens'
      classList={{ 'is-link': Boolean(props.row.opponentSlug), 'mu-low': lowSample() }}
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
        <MetaShare value={props.row.prevalence} show={props.showMeta} />
      </div>
      <div class='mu-bar'>
        <span class='mu-bar-axis' />
        <Show when={xIn() !== null && xOut() !== null}>
          <span
            class={`mu-bar-line ${signClass(props.row.lens.delta)}`}
            style={{ left: `${lineLeft()}%`, width: `${lineWidth()}%` }}
          />
        </Show>
        <Show when={xOut() !== null}>
          <span class='mu-mk mu-mk-out' style={{ left: `${xOut()}%` }} />
        </Show>
        <Show when={xIn() !== null}>
          <span class='mu-mk mu-mk-in' style={{ left: `${xIn()}%` }} />
        </Show>
        <Show when={xIn() !== null}>
          <span class={`mu-bar-pp ${ppSideClass(props.row.lens.delta, 0.05)}`} style={{ left: `${xIn()}%` }}>
            {fmtBarPp(props.row.lens.delta, 0.05)}
          </span>
        </Show>
      </div>
      <div class='mu-stats'>
        <span class={`mu-wr ${signClass(props.row.lens.delta)}`}>{fmtDelta(props.row.lens.delta)}</span>
        <span class='mu-rec'>
          {props.row.lens.withRec.n}v{props.row.lens.withoutRec.n}
        </span>
      </div>
    </div>
  );
}
