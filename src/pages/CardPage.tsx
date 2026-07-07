import { A, useNavigate, useParams } from '@solidjs/router';
import { createEffect, createMemo, createResource, createSignal, For, Show } from 'solid-js';
import {
  type Day2CardStat,
  fetchArchetype,
  fetchArchetypes,
  fetchDay2CardStats,
  fetchMaster,
  fetchPrices,
  fetchRotationIndex,
  findCardBySetNumber,
  getArchetypeIconMap,
  isSnapshotSource,
  resolveArchetypeIcons,
  resolveCanonicalSetNumber,
  snapshotDateForCard,
  snapshotSourceKey
} from '../lib/data';
import { buildCardId } from '../utils/deckCardId';
import { ArchetypeIcons } from '../components/ArchetypeIcon';
import { ONLINE_META_NAME } from '../lib/constants';
import { nameFromTournamentKey } from '../lib/format';
import { useTournament } from '../lib/tournamentContext';
import '../styles/pages/cards.css';
import { latestValue, resolved } from '../lib/resource';
import type { ArchetypeIndexEntry, ArchetypeReport, CardDistributionEntry, CardItem } from '../types';
import { Breadcrumb } from '../components/Breadcrumb';
import { Badge } from '../components/Badge';
import { Skeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { CardImage } from '../components/CardImage';
import { InfoTip } from '../components/InfoTip';

const CONVERSION_INTRO = 'Share of the Day 1 decks playing this card that advanced to Day 2.';

/**
 * /cards/[set]/[number] — full page detail for a single card.
 * Mirrors Limitless URL structure (e.g., /cards/MEG/114 for Boss's Orders).
 */
export function CardPage() {
  const params = useParams<{ set: string; number: string }>();
  const navigate = useNavigate();
  const { tournament } = useTournament();
  const [master] = createResource(tournament, fetchMaster);
  const [prices] = createResource(fetchPrices);
  // Non-suspending reads (see lib/resource.ts). Master/prices are
  // tournament-scoped, so keep the last value while a refetch is in flight;
  // the per-card fan-out below uses `resolved` so a param change shows the
  // skeleton instead of the previous card's data.
  const masterData = () => latestValue(master);
  const pricesData = () => latestValue(prices);
  const liveCard = createMemo<CardItem | undefined>(() => {
    const items = masterData()?.items;
    if (!items) {
      return undefined;
    }
    return findCardBySetNumber(items, params.set, params.number);
  });

  // Deferred: the 49KB Snapshots index only matters for the historical
  // fallback, so fetch it only once the live report has loaded without this
  // card (P3.2). A falsy source keeps createResource idle.
  const [rotationIndex] = createResource(
    () => (masterData() && !liveCard() ? 'fallback' : undefined),
    () => fetchRotationIndex()
  );
  const rotationIndexData = () => resolved(rotationIndex);

  // If the URL points at a non-canonical printing (reprint) and the master
  // lookup misses, resolve via the synonym DB and redirect to the canonical
  // URL. Mirrors the edge redirect in `functions/cards/[set]/[number].ts` for
  // SPA navigations. While the lookup is in flight, `canonicalPending` is true
  // so the page shows the loading skeleton instead of the "no card found"
  // empty state.
  const [canonicalPending, setCanonicalPending] = createSignal(false);
  createEffect(() => {
    const items = masterData()?.items;
    const reqSet = params.set;
    const reqNumber = params.number;
    if (!items) {
      setCanonicalPending(false);
      return;
    }
    if (findCardBySetNumber(items, reqSet, reqNumber)) {
      setCanonicalPending(false);
      return;
    }
    setCanonicalPending(true);
    resolveCanonicalSetNumber(reqSet, reqNumber)
      .then(canonical => {
        // Bail out if the user navigated away in the meantime.
        if (reqSet !== params.set || reqNumber !== params.number) {
          return;
        }
        if (canonical) {
          navigate(`/cards/${canonical.set}/${canonical.number}`, { replace: true });
        }
      })
      .finally(() => {
        if (reqSet === params.set && reqNumber === params.number) {
          setCanonicalPending(false);
        }
      });
  });

  // Pre-rotation snapshot fallback. Fires only when live + canonical paths
  // have both come up empty — at that point check the rotation index and, if
  // the card belongs to a snapshot, refetch from the snapshot's master.json.
  const snapshotDate = createMemo<string | null>(() => {
    if (liveCard()) {
      return null;
    }
    if (canonicalPending()) {
      return null;
    }
    const idx = rotationIndexData();
    if (idx === undefined) {
      return null;
    } // still loading
    return snapshotDateForCard(idx ?? null, params.set, params.number);
  });
  const [snapshotMaster] = createResource(
    () => snapshotDate(),
    date => fetchMaster(snapshotSourceKey(date))
  );
  const snapshotMasterData = () => resolved(snapshotMaster);
  const snapshotCard = createMemo<CardItem | undefined>(() => {
    const items = snapshotMasterData()?.items;
    if (!items) {
      return undefined;
    }
    return findCardBySetNumber(items, params.set, params.number);
  });

  // The card actually rendered: live wins; snapshot fills in when there is no
  // live entry for this canonical set/number.
  const card = createMemo<CardItem | undefined>(() => liveCard() ?? snapshotCard());

  // True when the rendered card came from a frozen pre-rotation snapshot rather
  // than the live report — drives the banner and the "current price" annotation.
  const isSnapshot = createMemo<boolean>(() => !liveCard() && Boolean(snapshotCard()));

  // Population behind the card's rank, taken from the same report the card came
  // from so "#30 of 944" stays internally consistent. Null in either report's
  // loading gap, which falls the rank display back to a bare "#30".
  const rankTotal = createMemo<number | null>(() => {
    const items = liveCard() ? masterData()?.items : snapshotMasterData()?.items;
    return items ? items.length : null;
  });

  // Human-readable snapshot date for the banner (snapshotDate() is YYYY-MM-DD).
  const snapshotDateLabel = createMemo<string>(() => {
    const raw = snapshotDate();
    if (!raw) {
      return '';
    }
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) {
      return raw;
    }
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isNaN(d.getTime())
      ? raw
      : d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  });

  // Empty-state copy reflects the active scope: the online meta has its rolling
  // 14-day caveat, but a specific event should name that event instead.
  const emptyDescription = createMemo<string>(() => {
    if (tournament() === ONLINE_META_NAME) {
      return "That set/number combination doesn't appear in the current online meta report. The card may not have been played in the rolling 14-day window.";
    }
    return `That set/number combination doesn't appear in the ${nameFromTournamentKey(tournament())} report.`;
  });

  // Tournament key threaded into the archetype fan-out below. When the page is
  // rendering snapshot data, point downstream fetches at the same snapshot so
  // "Where it's played" shows historical archetypes, not the current ones.
  const effectiveTournament = createMemo<string>(() => {
    if (liveCard()) {
      return tournament();
    }
    const date = snapshotDate();
    return date ? snapshotSourceKey(date) : tournament();
  });

  const priceEntry = createMemo(() => {
    const c = card();
    const p = pricesData();
    if (!c || !p) {
      return null;
    }
    return p[`${c.name}::${c.set}::${c.number}`] ?? null;
  });

  // Per-archetype usage: list every archetype that plays this card, with its
  // inclusion rate + average copy count. We fan out one fetch per archetype
  // (these are small JSON files that R2 serves cached); the deduping in
  // `fetchJson` means revisiting the same card during a session is free.
  const [archetypeIndex] = createResource(effectiveTournament, fetchArchetypes);
  const archetypeIndexData = () => latestValue(archetypeIndex);
  const [archetypeUsage] = createResource(
    () => {
      const c = card();
      const list = archetypeIndexData();
      const t = effectiveTournament();
      return c && list ? { card: c, list, tournament: t } : null;
    },
    async ({ card, list, tournament }) => {
      const results = await Promise.all(
        list.map(async entry => {
          try {
            const report = await fetchArchetype(tournament, entry.name);
            const item = findCardInArchetypeReport(report, card);
            if (!item) {
              return null;
            }
            return { entry, item, report };
          } catch {
            return null;
          }
        })
      );
      return results.filter((r): r is ArchetypeUsageRow => r !== null);
    }
  );
  const archetypeUsageData = () => resolved(archetypeUsage);

  // Day 1 → Day 2 conversion for the card, scoped to the active tournament.
  // Skipped for sources with no single Day 2 cut: Online Meta (rolling 14-day
  // window) and pre-rotation snapshots (frozen meta reports, no decks.json with
  // a `madePhase2` flag). For those `fetchDay2CardStats` has nothing to read, so
  // we don't even fire the request — the row is simply hidden.
  const [day2Stats] = createResource(
    () => {
      const t = effectiveTournament();
      return t && t !== ONLINE_META_NAME && !isSnapshotSource(t) ? t : null;
    },
    t => fetchDay2CardStats(t)
  );
  const day2StatsData = () => resolved(day2Stats);
  const conversionStat = createMemo<Day2CardStat | undefined>(() => {
    const c = card();
    const stats = day2StatsData();
    if (!c || !stats) {
      return undefined;
    }
    const uid = c.uid ?? (c.set && c.number != null ? `${c.name}::${c.set}::${c.number}` : c.name);
    const byUid = stats.find(s => s.uid === uid);
    if (byUid) {
      return byUid;
    }
    // Fallback: match on set + number with leading zeros stripped, mirroring
    // the archetype-report lookup above.
    if (c.set && c.number != null) {
      const setU = c.set.toUpperCase();
      const numTrim = String(c.number).replace(/^0+/, '') || '0';
      return stats.find(s => s.set?.toUpperCase() === setU && (String(s.number).replace(/^0+/, '') || '0') === numTrim);
    }
    return undefined;
  });

  const setNumber = () => `${params.set.toUpperCase()}/${params.number}`;

  // Reacts to route changes too — a run-once title would leave card A's name
  // up after navigating to a loading/missing card B.
  createEffect(() => {
    const c = card();
    document.title = `${c ? c.name : setNumber()} — Ciphermaniac`;
  });

  return (
    <>
      <Breadcrumb crumbs={[{ label: 'Cards', href: '/cards' }, { label: card()?.name ?? setNumber() }]} />

      <Show
        when={card()}
        fallback={
          <Show
            when={
              masterData() &&
              !liveCard() &&
              !canonicalPending() &&
              !rotationIndex.loading &&
              (snapshotDate() === null || (!snapshotMaster.loading && !snapshotCard()))
            }
            fallback={<CardPageSkeleton setNumber={setNumber()} />}
          >
            <EmptyState
              title={`No card found at ${setNumber()}.`}
              description={emptyDescription()}
              actions={
                <A href='/cards' class='btn btn-secondary'>
                  Back to all cards
                </A>
              }
            />
          </Show>
        }
      >
        <CardPageBody
          card={card()!}
          setNumber={setNumber()}
          priceEntry={priceEntry()}
          conversion={conversionStat()}
          archetypeUsage={archetypeUsageData()}
          archetypeUsageLoading={archetypeUsage.loading || archetypeIndex.loading}
          isSnapshot={isSnapshot()}
          snapshotDateLabel={snapshotDateLabel()}
          rankTotal={rankTotal()}
        />
      </Show>
    </>
  );
}

interface ArchetypeUsageRow {
  entry: ArchetypeIndexEntry;
  item: CardItem;
  report: ArchetypeReport;
}

function CardPageBody(props: {
  card: CardItem;
  setNumber: string;
  priceEntry: { price?: number; tcgPlayerId?: string } | null;
  conversion: Day2CardStat | undefined;
  archetypeUsage: ArchetypeUsageRow[] | null | undefined;
  archetypeUsageLoading: boolean;
  isSnapshot: boolean;
  snapshotDateLabel: string;
  rankTotal: number | null;
}) {
  // Caveats that make the conversion rate less trustworthy. A card played by
  // nearly the whole field just tracks the field's overall Day 2 rate, and a
  // card seen in a handful of decks is too small a sample to read into.
  const conversionCaveats = createMemo<string[]>(() => {
    const cv = props.conversion;
    if (!cv) {
      return [];
    }
    const out: string[] = [];
    if (props.card.pct >= 60) {
      out.push(
        `${props.card.pct.toFixed(0)}% of decks play this card. At that usage, conversion mirrors the field's Day 2 rate instead of telling you anything about the card.`
      );
    }
    if (cv.day1Count <= 15) {
      out.push(
        `Only ${cv.day1Count.toLocaleString()} deck${cv.day1Count === 1 ? '' : 's'} in this event played this card. That's too small a sample for a reliable conversion rate.`
      );
    }
    return out;
  });

  const avgCopies = createMemo(() => {
    const dist = props.card.dist ?? [];
    const players = dist.reduce((acc, d) => acc + (d.players ?? 0), 0);
    if (!players) {
      return null;
    }
    const copies = dist.reduce((acc, d) => acc + (d.copies ?? 0) * (d.players ?? 0), 0);
    return copies / players;
  });

  return (
    <>
      <div class='card-page-hero'>
        <div class='title-block'>
          <h1>{props.card.name}</h1>
          <div class='card-meta-row'>
            <Show when={props.card.category}>
              <Badge>{categoryToBadge(props.card.category!)}</Badge>
            </Show>
            <Show when={props.card.trainerType}>
              <Badge>{props.card.trainerType!}</Badge>
            </Show>
            <Show when={props.card.regulationMark}>
              <Badge variant='regulation'>Reg {props.card.regulationMark}</Badge>
            </Show>
            <span class='sep'>·</span>
            <span>
              {props.card.set} · #{props.card.number}
            </span>
          </div>
        </div>
      </div>

      <Show when={props.isSnapshot}>
        <div class='snapshot-banner' role='status'>
          <span class='snapshot-banner-label'>Rotated out</span>
          <span>
            This card rotated out of Standard. You're looking at the final pre-rotation report from{' '}
            {props.snapshotDateLabel}.
          </span>
        </div>
      </Show>

      <div class='card-page-grid'>
        <div class='card-page-left'>
          <div class='card-image-real'>
            <Show
              when={props.card.set && props.card.number !== undefined}
              fallback={
                <div class='card-image-fallback' style={{ 'aspect-ratio': '5 / 7' }}>
                  <div class='card-image-fallback-inner'>
                    <div class='set'>{props.card.set ?? '—'}</div>
                    <div class='number'>#{props.card.number ?? '—'}</div>
                  </div>
                </div>
              }
            >
              <CardImage
                set={props.card.set!}
                number={props.card.number!}
                size='lg'
                sizes='(max-width: 760px) 240px, 300px'
                lazy={false}
                alt={`${props.card.name} card`}
              />
            </Show>
          </div>

          <div class='stats-panel'>
            <div class='stat-row stat-row--lead'>
              <span class='stat-label'>
                Inclusion
                <InfoTip label='Share of decks playing at least one copy of this card.'>
                  <p>Share of decks playing at least one copy of this card.</p>
                </InfoTip>
              </span>
              <span class='stat-lead-value'>
                <span class='stat-value'>{props.card.pct.toFixed(1)}%</span>
                <span class='stat-subline'>
                  {props.card.found.toLocaleString()} of {props.card.total.toLocaleString()} decks
                </span>
              </span>
            </div>
            <Show when={props.conversion}>
              <div class='stat-row'>
                <span class='stat-label'>Conversion</span>
                <span class='stat-value'>
                  {props.conversion!.conversion.toFixed(1)}%
                  <InfoTip label={[CONVERSION_INTRO, ...conversionCaveats()].join(' ')}>
                    <p>{CONVERSION_INTRO}</p>
                    <For each={conversionCaveats()}>{note => <p>{note}</p>}</For>
                  </InfoTip>
                </span>
              </div>
            </Show>
            <Show when={avgCopies() !== null}>
              <div class='stat-row'>
                <span class='stat-label'>Avg copies</span>
                <span class='stat-value'>{avgCopies()!.toFixed(2)}</span>
              </div>
            </Show>
            <Show when={props.card.rank}>
              <div class='stat-row'>
                <span class='stat-label'>Rank</span>
                <span class='stat-value'>
                  #{props.card.rank}
                  <Show when={props.rankTotal}>
                    <span class='stat-rank-total'>of {props.rankTotal!.toLocaleString()}</span>
                  </Show>
                </span>
              </div>
            </Show>
            <Show when={props.priceEntry?.price !== undefined && props.priceEntry?.price !== null}>
              <div class='stat-row'>
                <span class='stat-label'>
                  Market price
                  <Show when={props.isSnapshot}>
                    <span class='stat-note'>current</span>
                  </Show>
                </span>
                <span class='stat-value'>
                  <Show when={props.priceEntry?.tcgPlayerId} fallback={<>${props.priceEntry!.price!.toFixed(2)}</>}>
                    <a
                      class='price-link'
                      href={`https://www.tcgplayer.com/product/${props.priceEntry!.tcgPlayerId}`}
                      target='_blank'
                      rel='noopener'
                    >
                      ${props.priceEntry!.price!.toFixed(2)} →
                    </a>
                  </Show>
                </span>
              </div>
            </Show>
          </div>
        </div>

        <div class='card-page-right'>
          <Show when={props.card.dist && props.card.dist.length > 0}>
            <div class='card-section'>
              <h3>Copy count distribution</h3>
              <p class='dist-caption'>Of the {props.card.found.toLocaleString()} decks running it</p>
              <div class='dist-block'>
                <For each={props.card.dist}>
                  {d => (
                    <div class='dist-row'>
                      <span class='copies-label'>{d.copies}× copies</span>
                      <div class='bar' aria-hidden='true'>
                        <div class='bar-fill' style={{ width: `${Math.min(100, d.percent ?? 0)}%` }} />
                      </div>
                      <span class='pct'>
                        {(d.percent ?? 0).toFixed(1)}% · {(d.players ?? 0).toLocaleString()} decks
                      </span>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Show>

          <div class='card-section'>
            <h3>Where it's played</h3>
            <Show when={!props.archetypeUsageLoading} fallback={<Skeleton height='220px' />}>
              <Show
                when={props.archetypeUsage && props.archetypeUsage.length > 0}
                fallback={
                  <EmptyState
                    title='Not seen in any tracked archetype.'
                    description="This card appears in the master report but isn't currently associated with an archetype's deck list."
                  />
                }
              >
                <ArchetypeUsageTable rows={props.archetypeUsage!} card={props.card} />
              </Show>
            </Show>
          </div>
        </div>
      </div>
    </>
  );
}

function categoryToBadge(category: string): string {
  const main = category.split('/')[0] ?? category;
  return main.charAt(0).toUpperCase() + main.slice(1);
}

/**
 * Locate a card in an archetype report by matching the canonical set + number
 * (preferred) or falling back to name match. Number comparison strips leading
 * zeros so PAL/185 ≈ PAL/0185.
 */
function findCardInArchetypeReport(report: ArchetypeReport, card: CardItem): CardItem | null {
  if (!report?.items) {
    return null;
  }
  const setU = card.set?.toUpperCase();
  const numTrim = card.number ? String(card.number).replace(/^0+/, '') || '0' : null;
  for (const item of report.items) {
    if (setU && numTrim && item.set && item.number !== undefined) {
      if (item.set.toUpperCase() === setU && (String(item.number).replace(/^0+/, '') || '0') === numTrim) {
        return item;
      }
    }
  }
  // Fallback: name-only match. Useful for cards that lack set/number in the
  // archetype report (rare, but defensive).
  for (const item of report.items) {
    if (item.name && card.name && item.name === card.name) {
      return item;
    }
  }
  return null;
}

/** Whole-number percent for the usage rows; sub-1% shows as "<1%" instead of rounding to 0. */
function fmtWholePct(p: number): string {
  return p > 0 && p < 1 ? '<1%' : `${Math.round(p)}%`;
}

/**
 * Expandable per-archetype usage rows: every archetype that plays this card,
 * with its inclusion rate and most common copy count on the collapsed row, and
 * the full copy-count distribution behind a chevron — each bucket deep-linking
 * into that archetype's filter tab pre-set to the exact count. Sorted by
 * inclusion within the archetype, descending.
 */
function ArchetypeUsageTable(props: { rows: ArchetypeUsageRow[]; card: CardItem }) {
  const iconMap = getArchetypeIconMap();
  const sorted = createMemo(() => {
    return [...props.rows].sort((a, b) => (b.item.pct ?? 0) - (a.item.pct ?? 0));
  });
  const [open, setOpen] = createSignal<Set<string>>(new Set());
  const toggle = (name: string) =>
    setOpen(prev => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  // Filter deep links need the card's SET~NUMBER id; without set/number the
  // expansion still renders, just without "view lists" links.
  const cardId = createMemo(() =>
    props.card.set && props.card.number !== undefined && props.card.number !== null
      ? buildCardId(props.card.set, props.card.number)
      : null
  );

  return (
    <div class='au-block'>
      <For each={sorted()}>
        {row => {
          const inclusion = row.item.pct ?? 0;
          const totalDecks = row.report.deckTotal ?? 0;
          const foundDecks = row.item.found ?? 0;
          const dist = () => (row.item.dist ?? []).filter(d => d.copies !== undefined && (d.players ?? 0) > 0);
          const modalBucket = () =>
            dist().reduce<CardDistributionEntry | null>(
              (m, d) => (m === null || (d.players ?? 0) > (m.players ?? 0) ? d : m),
              null
            );
          const isOpen = () => open().has(row.entry.name);
          const detailId = `au-detail-${row.entry.name.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
          return (
            <div class='au-row' classList={{ 'is-open': isOpen() }}>
              <div
                class='au-head'
                onClick={e => {
                  if (!(e.target as HTMLElement).closest('a')) {
                    toggle(row.entry.name);
                  }
                }}
              >
                <button
                  type='button'
                  class='au-chevron'
                  aria-expanded={isOpen()}
                  aria-controls={detailId}
                  aria-label={`Copy counts in ${row.entry.label}`}
                >
                  ▶
                </button>
                <span class='au-name'>
                  <ArchetypeIcons slugs={resolveArchetypeIcons(row.entry, iconMap)} size={20} />
                  <A href={`/archetypes/${encodeURIComponent(row.entry.name)}`}>{row.entry.label}</A>
                </span>
                <div class='au-bar' aria-hidden='true'>
                  <div class='au-bar-fill' style={{ width: `${Math.min(100, inclusion)}%` }} />
                </div>
                <span class='au-pct'>{fmtWholePct(inclusion)}</span>
                <span class='au-decks'>
                  {foundDecks.toLocaleString()}/{totalDecks.toLocaleString()} decks
                </span>
                <span class='au-modal'>
                  <Show when={modalBucket()} keyed>
                    {m => (
                      <>
                        <span class='au-chip'>{m.copies}×</span>
                        <span class='au-modal-share'>in {fmtWholePct(m.percent ?? 0)}</span>
                      </>
                    )}
                  </Show>
                </span>
              </div>
              <Show when={isOpen()}>
                <div class='au-detail' id={detailId}>
                  <For each={dist()}>
                    {d => (
                      <div class='au-dist-line' classList={{ 'is-modal': d.copies === modalBucket()?.copies }}>
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
                              href={`/archetypes/${encodeURIComponent(row.entry.name)}?b=${cardId()}:i:e:${d.copies}`}
                            >
                              view lists →
                            </A>
                          </Show>
                        </span>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          );
        }}
      </For>
    </div>
  );
}

function CardPageSkeleton(_props: { setNumber: string }) {
  return (
    <>
      <div class='card-page-hero'>
        <div class='title-block'>
          <Skeleton width='240px' height='32px' />
          <Skeleton width='200px' height='14px' />
        </div>
      </div>
      <div class='card-page-grid'>
        <div class='card-page-left'>
          <Skeleton height='350px' />
          <Skeleton height='180px' />
        </div>
        <div class='card-page-right'>
          <Skeleton height='200px' />
          <Skeleton height='180px' />
        </div>
      </div>
    </>
  );
}
