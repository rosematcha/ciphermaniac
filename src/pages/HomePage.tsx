import { createMemo, createResource, For, onMount, Show } from 'solid-js';
import { A } from '@solidjs/router';
import {
  fetchArchetypes,
  fetchMeta,
  fetchOnlineArchetypes,
  fetchParticipants,
  fetchTournamentsList,
  fetchUpcomingTournaments,
  majorTournaments,
  prettyTournamentName,
  tournamentDate
} from '../lib/data';
import {
  ARC_TAG_META,
  type ArcTag,
  buildStories,
  classifyArc,
  countryLabel,
  type FieldRow,
  resolveArchetypeThumbnails,
  type Story
} from '../lib/storylines';
import type { ArchetypeIndexEntry, TournamentParticipant } from '../types';
import { Skeleton } from '../components/Skeleton';
import { Section } from '../components/Section';
import { ArchetypeCard } from '../components/ArchetypeCard';
import { CardStack } from '../components/CardImage';
import { EmptyState } from '../components/EmptyState';
import { formatPercent, nameFromTournamentKey, parseISODate, shortDate } from '../lib/format';
import { resolved } from '../lib/resource';

const LATEST_EVENT_WINDOW_DAYS = 14;
// Majors whose dates fall within this many days of each other count as the
// same "weekend cluster" — covers back-to-back Sat/Sun events in different
// regions (e.g. Utrecht + Campinas on the same weekend).
const LATEST_EVENT_CLUSTER_DAYS = 3;
const RECENT_MAJORS_COUNT = 6;
const UPCOMING_COUNT = 6;

/**
 * Home page.
 *
 * Locked to the rolling online meta regardless of the global tournament
 * selector — this page is a site-wide overview, not a tournament view.
 *
 * Sections:
 *   1. Latest major-event callout (only if a regional/international finished
 *      within the last 14 days)
 *   2. Top archetypes gallery (online meta)
 *   3. Recent major tournaments (regional + international + special)
 *   4. Upcoming tournaments (scraped from Limitless)
 */
export function HomePage() {
  const [archetypes] = createResource(fetchOnlineArchetypes);
  const [tournamentsList] = createResource(fetchTournamentsList);
  const [upcoming] = createResource(fetchUpcomingTournaments);

  // Non-suspending reads: keep navigation instant and let the skeleton /
  // error fallbacks below actually render (see lib/resource.ts).
  const archetypesData = () => resolved(archetypes);
  const tournamentsListData = () => resolved(tournamentsList);
  const upcomingData = () => resolved(upcoming);

  // Find the headline major tournament for the callout. We start from majors
  // in the latest-event window, then within the most recent "weekend cluster"
  // (events dated within LATEST_EVENT_CLUSTER_DAYS of each other) we prefer
  // the one with the most players. This avoids surfacing a smaller late-ID
  // event over a larger same-weekend event purely because of tournament-ID
  // ordering — e.g. Campinas (1,725) shouldn't outrank Utrecht (2,150).
  const [latestMajor] = createResource(tournamentsListData, async list => {
    if (!list) {
      return null;
    }
    const majors = majorTournaments(list);
    const now = Date.now();
    const windowMs = LATEST_EVENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const inWindow = majors
      .map(t => ({ t, date: tournamentDate(t) }))
      .filter(
        (x): x is { t: string; date: Date } =>
          x.date !== null && now - x.date.getTime() <= windowMs && x.date.getTime() <= now
      );
    if (inWindow.length === 0) {
      return null;
    }
    const mostRecentMs = Math.max(...inWindow.map(x => x.date.getTime()));
    const clusterMs = LATEST_EVENT_CLUSTER_DAYS * 24 * 60 * 60 * 1000;
    const cluster = inWindow.filter(x => mostRecentMs - x.date.getTime() <= clusterMs);
    if (cluster.length === 1) {
      return cluster[0].t;
    }
    const withCounts = await Promise.all(
      cluster.map(async x => {
        try {
          const m = (await fetchMeta(x.t)) as unknown as { players?: number; deckTotal?: number };
          const size = m.players ?? m.deckTotal ?? 0;
          return { t: x.t, size, dateMs: x.date.getTime() };
        } catch {
          return { t: x.t, size: 0, dateMs: x.date.getTime() };
        }
      })
    );
    withCounts.sort((a, b) => b.size - a.size || b.dateMs - a.dateMs);
    return withCounts[0].t;
  });

  onMount(() => {
    document.title = 'Ciphermaniac — Pokémon TCG meta analysis';
  });

  const latestMajorData = () => resolved(latestMajor);

  // The residual "Other" bucket is not a real archetype and must not rank
  // inline among named decks. Pull it out of the grid and surface it as a
  // footnote line below (see the gallery-other paragraph).
  const rankedArchetypes = () => (archetypesData() ?? []).filter(a => !isOtherEntry(a));
  const otherEntry = () => (archetypesData() ?? []).find(isOtherEntry);
  const topArchetypes = () => rankedArchetypes().slice(0, 8);

  const recentMajors = () => {
    const list = tournamentsListData();
    if (!list) {
      return [];
    }
    return majorTournaments(list).slice(0, RECENT_MAJORS_COUNT);
  };

  return (
    <>
      <Show when={latestMajorData()}>
        <section class='home-callout-wrap'>
          <LatestEventCallout tournamentKey={latestMajorData()!} onlineArchetypes={archetypesData()} />
        </section>
      </Show>

      <Section title='Top archetypes' right={<A href='/archetypes'>View all →</A>}>
        <Show
          when={archetypesData()}
          fallback={
            <div class='gallery-grid'>
              <For each={Array.from({ length: 8 })}>{() => <Skeleton height='220px' />}</For>
            </div>
          }
        >
          <Show
            when={topArchetypes().length > 0}
            fallback={
              <EmptyState
                title='No archetypes yet.'
                description="The current window hasn't aggregated archetype data yet."
              />
            }
          >
            <div class='gallery-grid'>
              <For each={topArchetypes()}>{a => <ArchetypeCard entry={a} />}</For>
            </div>
            <Show when={otherEntry()}>
              <p class='gallery-other'>
                + Other: {(otherEntry()!.deckCount ?? 0).toLocaleString()} decks, {formatPercent(otherEntry()!.percent)}
              </p>
            </Show>
          </Show>
        </Show>
      </Section>

      <Section title='Recent major tournaments' right={<A href='/tournaments'>View all →</A>}>
        <Show
          when={tournamentsListData()}
          fallback={
            <div class='tournament-list'>
              <For each={Array.from({ length: 4 })}>{() => <Skeleton height='44px' />}</For>
            </div>
          }
        >
          <Show when={recentMajors().length > 0} fallback={<EmptyState title='No recent majors.' />}>
            <div class='tournament-list'>
              <For each={recentMajors()}>{t => <RecentMajorRow tournamentKey={t} />}</For>
            </div>
          </Show>
        </Show>
      </Section>

      <Section title='Upcoming tournaments' right='from Limitless'>
        <Show
          when={upcomingData()}
          fallback={
            <Show
              when={upcoming.loading}
              fallback={
                <EmptyState
                  title="Couldn't load upcoming tournaments."
                  description="The Limitless scraper isn't reachable right now. Try again later."
                />
              }
            >
              <div class='tournament-list'>
                <For each={Array.from({ length: 4 })}>{() => <Skeleton height='44px' />}</For>
              </div>
            </Show>
          }
        >
          <Show
            when={(upcomingData()!.events ?? []).length > 0}
            fallback={<EmptyState title='No upcoming tournaments listed.' />}
          >
            <div class='tournament-list'>
              <For each={upcomingData()!.events.slice(0, UPCOMING_COUNT)}>
                {e => (
                  <a
                    class='tournament-row tournament-row-link'
                    href={e.limitlessUrl ?? e.externalUrl ?? '#'}
                    target='_blank'
                    rel='noopener'
                  >
                    <span class='date'>{shortDate(parseISODate(e.date))}</span>
                    <span class='name'>{e.name}</span>
                    <span class='players'>
                      {labelType(e.type)} · {e.country}
                    </span>
                  </a>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </Section>
    </>
  );
}

/* ---------- Latest event callout ---------- */

function LatestEventCallout(props: { tournamentKey: string; onlineArchetypes: ArchetypeIndexEntry[] | undefined }) {
  const [meta] = createResource(() => props.tournamentKey, fetchMeta);
  const [participants] = createResource(() => props.tournamentKey, fetchParticipants);
  const [tournamentArchetypes] = createResource(() => props.tournamentKey, fetchArchetypes);

  // Non-suspending reads (see lib/resource.ts): keyed on the headline event,
  // so on a key change show the loading gate rather than stale event data.
  const metaData = () => resolved(meta);
  const participantsData = () => resolved(participants);
  const tournamentArchetypesData = () => resolved(tournamentArchetypes);

  const winner = createMemo<TournamentParticipant | undefined>(() => {
    const list = participantsData() ?? [];
    return list.find(p => p.placement === 1);
  });

  /**
   * Lookup tiers for one archetype index, mirroring the original fallback
   * priority: exact label → exact name → normalized label → normalized name.
   * First entry in list order wins within each tier, matching `.find`.
   */
  function buildArchetypeLookup(list: ArchetypeIndexEntry[]) {
    const byLabel = new Map<string, ArchetypeIndexEntry>();
    const byName = new Map<string, ArchetypeIndexEntry>();
    const byNormLabel = new Map<string, ArchetypeIndexEntry>();
    const byNormName = new Map<string, ArchetypeIndexEntry>();
    for (const a of list) {
      if (!byLabel.has(a.label)) {
        byLabel.set(a.label, a);
      }
      if (!byName.has(a.name)) {
        byName.set(a.name, a);
      }
      const normLabel = normalize(a.label);
      if (!byNormLabel.has(normLabel)) {
        byNormLabel.set(normLabel, a);
      }
      const normName = normalize(a.name);
      if (!byNormName.has(normName)) {
        byNormName.set(normName, a);
      }
    }
    return { byLabel, byName, byNormLabel, byNormName };
  }

  const onlineLookup = createMemo(() => buildArchetypeLookup(props.onlineArchetypes ?? []));
  const tournamentLookup = createMemo(() => buildArchetypeLookup(tournamentArchetypesData() ?? []));

  /**
   * Find an archetype entry by name across either the per-tournament index
   * or the online-meta index, preferring whichever has thumbnails populated.
   * Called per participant, so it reads precomputed maps instead of doing
   * linear `.find`s with regex normalization on every call.
   */
  function lookupArchetype(deckName: string | null | undefined): ArchetypeIndexEntry | undefined {
    if (!deckName) {
      return undefined;
    }
    const target = normalize(deckName);
    const online = onlineLookup();
    const onlineHit =
      online.byLabel.get(deckName) ??
      online.byName.get(deckName) ??
      online.byNormLabel.get(target) ??
      online.byNormName.get(target);
    if (onlineHit) {
      return onlineHit;
    }
    const tournament = tournamentLookup();
    return (
      tournament.byLabel.get(deckName) ??
      tournament.byName.get(deckName) ??
      tournament.byNormLabel.get(target) ??
      tournament.byNormName.get(target)
    );
  }

  const topCutParticipants = createMemo<TournamentParticipant[]>(() =>
    (participantsData() ?? []).filter(p => p.madeTopCut)
  );

  const day2Participants = createMemo<TournamentParticipant[]>(() =>
    (participantsData() ?? []).filter(p => p.madePhase2)
  );

  // Winner's archetype is still used as an exclusion subject for the story
  // generators (we don't want the winner's deck to dominate every storyline)
  // even though the winner block itself no longer renders.
  const winnerArchetype = createMemo<ArchetypeIndexEntry | undefined>(() => lookupArchetype(winner()?.deckName));

  const eventMeta = createMemo(() => {
    return metaData() as unknown as
      | {
          name?: string;
          date?: string;
          city?: string;
          country?: string;
          players?: number;
          deckTotal?: number;
          format?: string;
        }
      | undefined;
  });

  /**
   * The canonical field-vs-top-cut crossover. One row per archetype with
   * non-zero presence (either in field, top cut, or online meta). Sorted by
   * descending field share.
   */
  const totalTopCut = createMemo(() => topCutParticipants().length);
  const totalDay2 = createMemo(() => day2Participants().length);

  const fieldRows = createMemo<FieldRow[]>(() => {
    const tournamentList = tournamentArchetypesData() ?? [];
    if (tournamentList.length === 0) {
      return [];
    }
    const onlineList = props.onlineArchetypes ?? [];
    const onlineByLabel = new Map<string, ArchetypeIndexEntry>();
    for (const o of onlineList) {
      onlineByLabel.set(normalize(o.label || o.name), o);
    }

    function bucket(list: TournamentParticipant[]): Map<string, number> {
      const m = new Map<string, number>();
      for (const p of list) {
        const a = lookupArchetype(p.deckName);
        const key = a ? normalize(a.label || a.name) : normalize(p.deckName ?? '—');
        m.set(key, (m.get(key) ?? 0) + 1);
      }
      return m;
    }
    const topCounts = bucket(topCutParticipants());
    const d2Counts = bucket(day2Participants());
    const totalCut = totalTopCut();
    const totalD2 = totalDay2();

    /** Per-archetype perf aggregates over every participant with a placement. */
    type PerfAgg = { count: number; sumWins: number; sumPlace: number; best: number };
    const perfByArch = new Map<string, PerfAgg>();
    for (const p of participantsData() ?? []) {
      const a = lookupArchetype(p.deckName);
      const key = a ? normalize(a.label || a.name) : normalize(p.deckName ?? '—');
      if (!perfByArch.has(key)) {
        perfByArch.set(key, { count: 0, sumWins: 0, sumPlace: 0, best: Infinity });
      }
      const slot = perfByArch.get(key)!;
      slot.count++;
      if (typeof p.wins === 'number') {
        slot.sumWins += p.wins;
      }
      if (typeof p.placement === 'number') {
        slot.sumPlace += p.placement;
        if (p.placement < slot.best) {
          slot.best = p.placement;
        }
      }
    }

    // Compute field share from raw deck counts rather than trusting the
    // upstream `.percent` field. Upstream uses two different unit conventions
    // (online: 0..1 fractions; per-tournament: 0..100) which our previous
    // heuristic mis-classified — anything <1% in per-tournament was being
    // multiplied by 100, producing e.g. "Hydrapple 87%". Deriving share from
    // counts is unambiguous.
    const totalDecklists = tournamentList.reduce((acc, a) => acc + (a.deckCount ?? 0), 0);

    return tournamentList
      .map<FieldRow>(a => {
        const key = normalize(a.label || a.name);
        const onlineHit = onlineByLabel.get(key);
        const fieldDecks = a.deckCount ?? 0;
        const fieldPct = totalDecklists > 0 ? (fieldDecks / totalDecklists) * 100 : 0;
        const topCutCount = topCounts.get(key) ?? 0;
        const day2Count = d2Counts.get(key) ?? 0;
        const onlinePct =
          onlineHit && typeof onlineHit.percent === 'number' && Number.isFinite(onlineHit.percent)
            ? onlineHit.percent
            : null;
        const delta = onlinePct === null ? null : fieldPct - onlinePct;
        const conversionPct = fieldDecks > 0 ? (topCutCount / fieldDecks) * 100 : null;
        const day2Pct = totalD2 > 0 ? (day2Count / totalD2) * 100 : null;
        const cutPct = totalCut > 0 ? (topCutCount / totalCut) * 100 : null;
        const day2Conversion = totalD2 > 0 && fieldDecks > 0 ? (day2Count / fieldDecks) * 100 : null;
        const perf = perfByArch.get(key);
        const avgWins = perf && perf.count > 0 ? perf.sumWins / perf.count : null;
        const bestPlacement = perf && perf.best !== Infinity ? perf.best : null;
        return {
          rawName: a.label || a.name,
          label: a.label || a.name,
          archetype: onlineHit ?? a,
          thumbnails: resolveArchetypeThumbnails(onlineHit, a),
          fieldPct,
          fieldDecks,
          day2Count,
          day2Pct,
          day2Conversion,
          topCutCount,
          cutPct,
          avgWins,
          bestPlacement,
          onlinePct,
          delta,
          conversionPct
        };
      })
      .sort((a, b) => b.fieldPct - a.fieldPct);
  });

  /** Placement-ordered standings, unsliced — story computation needs the whole
   * cut (32-player cuts would be truncated by the display slice below). */
  const fullStandings = createMemo<TournamentParticipant[]>(() => {
    return (participantsData() ?? [])
      .filter(p => typeof p.placement === 'number')
      .sort((a, b) => (a.placement ?? 9999) - (b.placement ?? 9999));
  });

  /**
   * Placement-ordered standings, near and around the cut line. Covers the
   * top ~20 finishers and the cut line so we can show "what was #11."
   */
  const standingsList = createMemo<TournamentParticipant[]>(() => fullStandings().slice(0, 24));

  const cutLine = createMemo<number | null>(() => {
    const cut = topCutParticipants();
    if (cut.length === 0) {
      return null;
    }
    let max = 0;
    for (const p of cut) {
      if (typeof p.placement === 'number' && p.placement > max) {
        max = p.placement;
      }
    }
    return max || null;
  });

  /**
   * Funnel rows for Variant C — sorted to put the most interesting
   * trajectories first: surgers, climbers, faders, then everything else by
   * peak share desc.
   */
  const funnelRows = createMemo<FieldRow[]>(() => {
    const rows = fieldRows();
    if (rows.length === 0) {
      return [];
    }
    const tagOrder: Record<ArcTag, number> = { surged: 0, faded: 1, climbed: 2, steady: 3 };
    const tagged = rows
      .filter(r => r.fieldPct >= 1 || r.day2Count > 0 || r.topCutCount > 0)
      .map(r => ({ row: r, tag: classifyArc(r) }))
      .sort((a, b) => {
        const t = tagOrder[a.tag] - tagOrder[b.tag];
        if (t !== 0) {
          return t;
        }
        const peakA = Math.max(a.row.fieldPct, a.row.day2Pct ?? 0, a.row.cutPct ?? 0);
        const peakB = Math.max(b.row.fieldPct, b.row.day2Pct ?? 0, b.row.cutPct ?? 0);
        return peakB - peakA;
      })
      .slice(0, 10);
    return tagged.map(t => t.row);
  });

  /** Field summary for the header line: players, decklists, drops, diversity. */
  const fieldSummary = createMemo(() => {
    const players = eventMeta()?.players ?? participantsData()?.length ?? 0;
    const decklists = eventMeta()?.deckTotal ?? fieldRows().reduce((acc, r) => acc + r.fieldDecks, 0);
    const drops = (participantsData() ?? []).filter(p => p.dropped).length;
    const cutDiversity = new Set(topCutParticipants().map(p => normalize(p.deckName ?? '—'))).size;
    return {
      players,
      decklists,
      drops,
      cutDiversity,
      cutSize: totalTopCut(),
      day2: totalDay2()
    };
  });

  return (
    <article class='callout'>
      <header class='callout-head'>
        <span class='callout-eyebrow'>Latest event</span>
        <h2 class='callout-title'>{eventMeta()?.name ?? prettyTournamentName(props.tournamentKey)}</h2>
        <div class='callout-meta'>
          <Show when={eventMeta()?.date}>
            <span>{eventMeta()!.date}</span>
          </Show>
          <Show when={eventMeta()?.city || eventMeta()?.country}>
            <span class='dot'>·</span>
            <span>{[eventMeta()!.city, eventMeta()!.country].filter(Boolean).join(', ')}</span>
          </Show>
          <Show when={fieldSummary().players > 0}>
            <span class='dot'>·</span>
            <span>{fieldSummary().players.toLocaleString()} players</span>
          </Show>
          <Show when={fieldSummary().decklists > 0 && fieldSummary().decklists !== fieldSummary().players}>
            <span class='dot'>·</span>
            <span>{fieldSummary().decklists.toLocaleString()} decklists</span>
          </Show>
          <Show when={fieldSummary().drops > 0}>
            <span class='dot'>·</span>
            <span>{fieldSummary().drops} dropped</span>
          </Show>
          <Show when={fieldSummary().day2 > 0}>
            <span class='dot'>·</span>
            <span>{fieldSummary().day2} to Day 2</span>
          </Show>
          <Show when={fieldSummary().cutSize > 0}>
            <span class='dot'>·</span>
            <span>
              {fieldSummary().cutDiversity} of {fieldSummary().cutSize} unique in cut
            </span>
          </Show>
          <Show when={eventMeta()?.format}>
            <span class='dot'>·</span>
            <span class='callout-format-pill'>{eventMeta()!.format}</span>
          </Show>
        </div>
      </header>

      {/* Gate on loading, not on winner() — players.json can be absent or
          carry no placement===1, and that must not leave an eternal skeleton. */}
      <Show
        when={!participants.loading}
        fallback={
          <div class='callout-body'>
            <Skeleton height='240px' />
          </div>
        }
      >
        <StoryBody
          winner={winner()}
          winnerArchetype={winnerArchetype()}
          totalTopCut={totalTopCut()}
          totalDay2={totalDay2()}
          fieldRows={fieldRows()}
          funnelRows={funnelRows()}
          standings={standingsList()}
          topCutParticipants={fullStandings().filter(p => p.madeTopCut)}
          cutLine={cutLine()}
          lookupArchetype={lookupArchetype}
          hasDay2={totalDay2() > 0}
        />
      </Show>

      <Show when={topCutParticipants().length > 0}>
        <div class='callout-cut-strip'>
          <ul class='callout-cut-strip-list'>
            <For
              each={topCutParticipants()
                .slice()
                .sort((a, b) => (a.placement ?? 99) - (b.placement ?? 99))}
            >
              {p => {
                const entry = lookupArchetype(p.deckName);
                return (
                  <li class='callout-cut-strip-row'>
                    <span class='cut-place'>#{p.placement ?? '—'}</span>
                    <Show when={countryLabel(p.country)} fallback={<span class='cut-country cut-country-empty' />}>
                      <span class='cut-country'>{countryLabel(p.country)}</span>
                    </Show>
                    <span class='cut-name'>{p.name}</span>
                    <Show when={entry} fallback={<span class='cut-deck'>{p.deckName ?? '—'}</span>}>
                      <A class='cut-deck' href={`/archetypes/${encodeURIComponent(entry!.name)}`}>
                        {p.deckName}
                      </A>
                    </Show>
                  </li>
                );
              }}
            </For>
          </ul>
        </div>
      </Show>

      <Show when={fieldRows().length > 0 && (totalDay2() > 0 || totalTopCut() > 0)}>
        <ConversionTable rows={fieldRows()} />
      </Show>
    </article>
  );
}

/* ---------- Conversion table (Field → Day 2 → top cut) ---------- */

/**
 * Compact funnel table for major-event scopes, collapsed behind a disclosure to
 * keep the callout calm. Each share column carries a title naming its
 * denominator, matching how the rows are computed in `fieldRows`:
 *   Field  = deck count / total decklists
 *   Day 2  = this deck's Day 2 count / all Day 2 decks
 *   Top cut = this deck's cut count / all top-cut slots
 */
function ConversionTable(props: { rows: FieldRow[] }) {
  const rows = () => props.rows.filter(r => r.fieldDecks > 0);
  return (
    <Show when={rows().length > 0}>
      <details class='conversion-disclosure'>
        <summary class='conversion-summary'>Show conversion table</summary>
        <div class='table-wrap conversion-table-wrap'>
          <table class='data conversion-table'>
            <thead>
              <tr>
                <th>Archetype</th>
                <th class='num' title='Share of all decklists in the field.'>
                  Field
                </th>
                <th class='num' title='Share of all decks that reached Day 2.'>
                  Day 2
                </th>
                <th class='num' title='Share of all top-cut slots.'>
                  Top cut
                </th>
              </tr>
            </thead>
            <tbody>
              <For each={rows()}>
                {r => (
                  <tr>
                    <td>{r.label}</td>
                    <td class='num'>
                      {formatPercent(r.fieldPct)} <span class='conv-count'>{r.fieldDecks}</span>
                    </td>
                    <td class='num'>
                      {formatPercent(r.day2Pct)} <span class='conv-count'>{r.day2Count}</span>
                    </td>
                    <td class='num'>
                      {formatPercent(r.cutPct)} <span class='conv-count'>{r.topCutCount}</span>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </details>
    </Show>
  );
}

/* ---------- Story body (the locked-in callout layout) ---------- */

function StoryBody(props: {
  winner: TournamentParticipant | undefined;
  winnerArchetype: ArchetypeIndexEntry | undefined;
  totalTopCut: number;
  totalDay2: number;
  fieldRows: FieldRow[];
  funnelRows: FieldRow[];
  standings: TournamentParticipant[];
  topCutParticipants: TournamentParticipant[];
  cutLine: number | null;
  lookupArchetype: (name: string | null | undefined) => ArchetypeIndexEntry | undefined;
  hasDay2: boolean;
}) {
  const stories = createMemo(() =>
    buildStories({
      rows: props.fieldRows,
      excludeArchetype: props.winnerArchetype,
      hasDay2: props.hasDay2,
      winner: props.winner,
      standings: props.standings,
      topCutParticipants: props.topCutParticipants,
      cutLine: props.cutLine,
      totalTopCut: props.totalTopCut,
      lookupArchetype: props.lookupArchetype
    })
  );
  return (
    <>
      <Show when={stories().length > 0}>
        <div class='callout-stories'>
          <div class='callout-stories-grid'>
            <For each={stories()}>{story => <StoryCard story={story} hasDay2={props.hasDay2} />}</For>
          </div>
        </div>
      </Show>
    </>
  );
}

function StoryCard(props: { story: Story; hasDay2: boolean }) {
  const r = () => props.story.row;
  const meta = () => ARC_TAG_META[props.story.tag];
  const href = () =>
    props.story.href ?? (r().archetype ? `/archetypes/${encodeURIComponent(r().archetype!.name)}` : '#');
  const thumbnails = createMemo<string[]>(() => {
    if (props.story.thumbnails && props.story.thumbnails.length > 0) {
      return props.story.thumbnails;
    }
    return r().thumbnails ?? [];
  });
  return (
    <A class={`story-card story-card-${props.story.tag}`} href={href()}>
      <div class='story-card-art'>
        <Show when={thumbnails().length > 0}>
          <CardStack thumbnails={thumbnails()} size='sm' />
        </Show>
      </div>
      <div class='story-card-tag' title={ARC_TAG_TITLES[props.story.tag]}>
        <span class='story-card-symbol' aria-hidden='true'>
          {meta().symbol}
        </span>
        <span>{props.story.tagLabel ?? meta().label}</span>
      </div>
      <h4 class='story-card-headline'>{props.story.headline}</h4>
      <p class='story-card-body'>{props.story.body}</p>
    </A>
  );
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Normalize-safe match for the residual "Other" bucket. */
function isOtherEntry(a: ArchetypeIndexEntry): boolean {
  return normalize(a.label || a.name) === 'other';
}

/**
 * Concrete scale for each story tag, taken verbatim from the thresholds in
 * `classifyArc` (src/lib/storylines.ts). Surfaced as a `title` on the tag so a
 * bare "surged"/"faded" chip states what it actually measures.
 */
const ARC_TAG_TITLES: Record<ArcTag, string> = {
  surged: 'Share climbed at least 1 pp at both the Day 2 and top-cut steps.',
  climbed: 'Share climbed at least 1 pp at either the Day 2 or top-cut step.',
  faded: 'At least 5% of the field, but none of the top cut.',
  steady: 'No move of at least 1 pp through the Day 2 and top-cut steps.'
};

/* ---------- Recent major row ---------- */

function RecentMajorRow(props: { tournamentKey: string }) {
  const date = () => tournamentDate(props.tournamentKey);
  return (
    <div class='tournament-row'>
      <span class='date'>{date() ? shortDate(date()!) : '—'}</span>
      <span class='name'>{nameFromTournamentKey(props.tournamentKey)}</span>
      <span class='players'>{classifyByName(props.tournamentKey)}</span>
    </div>
  );
}

function classifyByName(key: string): string {
  const lower = key.toLowerCase();
  if (lower.includes('international')) {
    return 'International';
  }
  if (lower.includes('regional')) {
    return 'Regional';
  }
  if (lower.includes('special event')) {
    return 'Special';
  }
  return 'Other';
}

function labelType(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}
