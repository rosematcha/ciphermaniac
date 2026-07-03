import { A, useNavigate, useParams } from '@solidjs/router';
import { createEffect, createMemo, createResource, createSignal, For, onMount, Show } from 'solid-js';
import {
  type Day2CardStat,
  fetchArchetype,
  fetchArchetypes,
  fetchDay2CardStats,
  fetchMaster,
  fetchPrices,
  fetchRotationIndex,
  findCardBySetNumber,
  isSnapshotSource,
  resolveCanonicalSetNumber,
  snapshotDateForCard,
  snapshotSourceKey
} from '../lib/data';
import { ONLINE_META_NAME } from '../lib/constants';
import { useTournament } from '../lib/tournamentContext';
import type { ArchetypeIndexEntry, ArchetypeReport, CardItem } from '../types';
import { Breadcrumb } from '../components/Breadcrumb';
import { Badge } from '../components/Badge';
import { Skeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { CardImage } from '../components/CardImage';
import { InfoTip } from '../components/InfoTip';

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
  const [rotationIndex] = createResource(fetchRotationIndex);

  const liveCard = createMemo<CardItem | undefined>(() => {
    const items = master()?.items;
    if (!items) {
      return undefined;
    }
    return findCardBySetNumber(items, params.set, params.number);
  });

  // If the URL points at a non-canonical printing (reprint) and the master
  // lookup misses, resolve via the synonym DB and redirect to the canonical
  // URL. Mirrors the edge redirect in `functions/cards/[set]/[number].ts` for
  // SPA navigations. While the lookup is in flight, `canonicalPending` is true
  // so the page shows the loading skeleton instead of the "no card found"
  // empty state.
  const [canonicalPending, setCanonicalPending] = createSignal(false);
  createEffect(() => {
    const items = master()?.items;
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
    const idx = rotationIndex();
    if (idx === undefined) {
      return null;
    } // still loading
    return snapshotDateForCard(idx ?? null, params.set, params.number);
  });
  const [snapshotMaster] = createResource(
    () => snapshotDate(),
    date => fetchMaster(snapshotSourceKey(date))
  );
  const snapshotCard = createMemo<CardItem | undefined>(() => {
    const items = snapshotMaster()?.items;
    if (!items) {
      return undefined;
    }
    return findCardBySetNumber(items, params.set, params.number);
  });

  // The card actually rendered: live wins; snapshot fills in when there is no
  // live entry for this canonical set/number.
  const card = createMemo<CardItem | undefined>(() => liveCard() ?? snapshotCard());

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
    const p = prices();
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
  const [archetypeUsage] = createResource(
    () => {
      const c = card();
      const list = archetypeIndex();
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
  const conversionStat = createMemo<Day2CardStat | undefined>(() => {
    const c = card();
    const stats = day2Stats();
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

  onMount(() => {
    document.title = `${setNumber()} — Ciphermaniac`;
  });

  createEffect(() => {
    const c = card();
    if (c) {
      document.title = `${c.name} — Ciphermaniac`;
    }
  });

  return (
    <>
      <Breadcrumb crumbs={[{ label: 'Cards', href: '/cards' }, { label: card()?.name ?? setNumber() }]} />

      <Show
        when={card()}
        fallback={
          <Show
            when={
              master() &&
              !liveCard() &&
              !canonicalPending() &&
              !rotationIndex.loading &&
              (snapshotDate() === null || (!snapshotMaster.loading && !snapshotCard()))
            }
            fallback={<CardPageSkeleton setNumber={setNumber()} />}
          >
            <EmptyState
              title={`No card found at ${setNumber()}.`}
              description="That set/number combination doesn't appear in the current online meta report. The card may not have been played in the rolling 14-day window."
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
          archetypeUsage={archetypeUsage()}
          archetypeUsageLoading={archetypeUsage.loading || archetypeIndex.loading}
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

  const totalCopies = createMemo(() => {
    const dist = props.card.dist ?? [];
    return dist.reduce((acc, d) => acc + (d.copies ?? 0) * (d.players ?? 0), 0);
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
            <div class='stat-row'>
              <span class='stat-label'>Inclusion</span>
              <span class='stat-value'>{props.card.pct.toFixed(1)}%</span>
            </div>
            <div class='stat-row'>
              <span class='stat-label'>Decks found</span>
              <span class='stat-value'>{props.card.found.toLocaleString()}</span>
            </div>
            <div class='stat-row'>
              <span class='stat-label'>Decks total</span>
              <span class='stat-value'>{props.card.total.toLocaleString()}</span>
            </div>
            <Show when={props.conversion}>
              <div class='stat-row'>
                <span class='stat-label'>Day 1→2 conversion</span>
                <span class='stat-value'>
                  {props.conversion!.conversion.toFixed(1)}%
                  <Show when={conversionCaveats().length > 0}>
                    <InfoTip label={conversionCaveats().join(' ')}>
                      <For each={conversionCaveats()}>{note => <p>{note}</p>}</For>
                    </InfoTip>
                  </Show>
                </span>
              </div>
            </Show>
            <Show when={avgCopies() !== null}>
              <div class='stat-row'>
                <span class='stat-label'>Avg copies</span>
                <span class='stat-value'>{avgCopies()!.toFixed(2)}</span>
              </div>
            </Show>
            <div class='stat-row'>
              <span class='stat-label'>Total seen</span>
              <span class='stat-value'>{totalCopies().toLocaleString()}</span>
            </div>
            <Show when={props.card.rank}>
              <div class='stat-row'>
                <span class='stat-label'>Rank</span>
                <span class='stat-value'>#{props.card.rank}</span>
              </div>
            </Show>
          </div>

          <Show when={props.priceEntry?.price !== undefined && props.priceEntry?.price !== null}>
            <div class='price-panel'>
              <div class='price-label'>Market price</div>
              <div class='price-value'>${props.priceEntry!.price!.toFixed(2)}</div>
              <div class='price-note'>
                <Show when={props.priceEntry?.tcgPlayerId} fallback={<>via TCGCSV</>}>
                  <a
                    href={`https://www.tcgplayer.com/product/${props.priceEntry!.tcgPlayerId}`}
                    target='_blank'
                    rel='noopener'
                  >
                    View on TCGPlayer →
                  </a>
                </Show>
              </div>
            </div>
          </Show>
        </div>

        <div class='card-page-right'>
          <Show when={props.card.dist && props.card.dist.length > 0}>
            <div class='card-section'>
              <h3>Copy count distribution</h3>
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
                <ArchetypeUsageTable rows={props.archetypeUsage!} />
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

/**
 * Sortable table of "this card's footprint" across every archetype that plays it.
 * Sorted by inclusion percentage within the archetype, descending — the
 * archetypes that lean hardest on this card surface first.
 */
function ArchetypeUsageTable(props: { rows: ArchetypeUsageRow[] }) {
  const sorted = createMemo(() => {
    return [...props.rows].sort((a, b) => (b.item.pct ?? 0) - (a.item.pct ?? 0));
  });
  return (
    <div class='archetype-usage-block'>
      <For each={sorted()}>
        {row => {
          const inclusion = row.item.pct ?? 0;
          const avgCopies = (() => {
            const dist = row.item.dist ?? [];
            const players = dist.reduce((acc, d) => acc + (d.players ?? 0), 0);
            if (!players) {
              return null;
            }
            const copies = dist.reduce((acc, d) => acc + (d.copies ?? 0) * (d.players ?? 0), 0);
            return copies / players;
          })();
          const totalDecks = row.report.deckTotal ?? 0;
          const foundDecks = row.item.found ?? 0;
          return (
            <A class='archetype-usage-row' href={`/archetypes/${encodeURIComponent(row.entry.name)}`}>
              <span class='arch-name'>{row.entry.label}</span>
              <div class='arch-bar' aria-hidden='true'>
                <div class='arch-bar-fill' style={{ width: `${Math.min(100, inclusion)}%` }} />
              </div>
              <span class='arch-pct'>{inclusion.toFixed(1)}%</span>
              <span class='arch-decks'>
                {foundDecks.toLocaleString()}/{totalDecks.toLocaleString()} decks
              </span>
              <Show when={avgCopies !== null}>
                <span class='arch-avg'>{avgCopies!.toFixed(2)}× avg</span>
              </Show>
            </A>
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
