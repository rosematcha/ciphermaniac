import { A, useParams } from '@solidjs/router';
import { createEffect, createMemo, createResource, createSignal, For, onMount, Show } from 'solid-js';
import { fetchPlayerDecks, fetchPlayerProfile, prettyTournamentName } from '../lib/data';
import { Breadcrumb } from '../components/Breadcrumb';
import { Section } from '../components/Section';
import { Badge } from '../components/Badge';
import { Skeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import type { PlayerDeckCard, PlayerProfile, PlayerTournamentEntry } from '../types';
import { capitalize, winPercent } from '../lib/format';
import { groupDeckByCategory } from '../lib/deckGrouping';
import { resolved } from '../lib/resource';
import '../styles/pages/players-tables.css';

const ARCHETYPE_PREVIEW_COUNT = 5;
const SMALL_SAMPLE_GAMES = 10;

export function PlayerProfilePage() {
  const params = useParams<{ id: string }>();
  const [profile] = createResource(() => params.id, fetchPlayerProfile);

  // Non-suspending read (see lib/resource.ts). Param-keyed: show the skeleton
  // on player change, not the previous player's profile.
  const profileData = () => resolved(profile);

  onMount(() => {
    document.title = 'Player — Ciphermaniac';
  });

  createEffect(() => {
    const p = profileData();
    if (p) {
      document.title = `${p.name} — Ciphermaniac`;
    }
  });

  return (
    <>
      <Breadcrumb
        crumbs={[{ label: 'Players', href: '/players' }, { label: profileData()?.name ?? `#${params.id}` }]}
      />

      <Show
        when={profileData()}
        fallback={
          <Show when={profile.error || profileData() === null} fallback={<ProfileSkeleton />}>
            <EmptyState
              title='Player not found.'
              description="No career profile exists for this player ID. They may not have a Limitless Labs ID, or the index hasn't been rebuilt."
              actions={
                <A href='/players' class='btn btn-secondary'>
                  Back to players
                </A>
              }
            />
          </Show>
        }
      >
        <ProfileBody profile={profileData()!} playerId={params.id} />
      </Show>
    </>
  );
}

function ProfileBody(props: { profile: PlayerProfile; playerId: string }) {
  const s = () => props.profile.summary;
  const matchesPlayed = () => s().wins + s().losses + s().ties;
  const winPct = () => winPercent(s().wins, s().losses);
  const day2Pct = () => (s().eventCount > 0 ? Math.round((s().day2s / s().eventCount) * 1000) / 10 : 0);
  const [showAllArchetypes, setShowAllArchetypes] = createSignal(false);

  // Lazy-loaded decklists. The resource is created up-front but gated on
  // `decksRequested`, so the network call doesn't fire until the first row
  // expand. Creating createResource inside a click handler would leak (no
  // reactive owner) — gate via signal instead.
  const [decksRequested, setDecksRequested] = createSignal(false);
  const [decks] = createResource(() => (decksRequested() ? props.playerId : null), fetchPlayerDecks);
  // Non-suspending read: cardsFor is called from row-expansion JSX.
  const decksData = () => resolved(decks);
  const ensureDecks = () => setDecksRequested(true);
  const cardsFor = (tournamentId: string): PlayerDeckCard[] | undefined => {
    return decksData()?.decks?.[tournamentId];
  };
  const decksLoading = () => decksRequested() && decks.loading;

  const archetypesToShow = createMemo(() => {
    if (showAllArchetypes()) {
      return props.profile.archetypes;
    }
    return props.profile.archetypes.slice(0, ARCHETYPE_PREVIEW_COUNT);
  });
  const hiddenArchetypeCount = () => Math.max(0, props.profile.archetypes.length - ARCHETYPE_PREVIEW_COUNT);
  const archetypeName = (base: string | null): string => (base ? (props.profile.archetypeNames[base] ?? base) : '');

  return (
    <>
      <section class='hero'>
        <h1>{props.profile.name}</h1>
        <div class='hero-meta'>
          <Show when={props.profile.countries.length}>
            <span>{props.profile.countries.join(' · ')}</span>
            <span class='dot'>·</span>
          </Show>
          <span>
            {s().eventCount} {s().eventCount === 1 ? 'event' : 'events'}
          </span>
          <Show when={props.profile.aliases.length}>
            <span class='dot'>·</span>
            <span class='muted-cell'>aka {props.profile.aliases.join(', ')}</span>
          </Show>
        </div>
      </section>

      <section class='kpis'>
        <div class='kpi'>
          <div class='kpi-label'>Day 2s</div>
          <div class='kpi-value leader'>{s().day2s.toLocaleString()}</div>
          <div class='kpi-foot'>
            <Show when={s().eventCount > 0}>{day2Pct().toFixed(1)}% of events</Show>
          </div>
        </div>
        <div class='kpi'>
          <div class='kpi-label'>Matches</div>
          <div class='kpi-value'>{matchesPlayed().toLocaleString()}</div>
          <div class='kpi-foot'>
            {s().wins}-{s().losses}-{s().ties}
          </div>
        </div>
        <div class='kpi'>
          <div class='kpi-label'>Win %</div>
          <div class='kpi-value'>{winPct() != null ? `${winPct()!.toFixed(1)}%` : '—'}</div>
          <div class='kpi-foot'>ties excluded</div>
        </div>
        <div class='kpi'>
          <div class='kpi-label'>Best placement</div>
          <div class='kpi-value'>{s().bestPlacement ?? '—'}</div>
          <div class='kpi-foot'>
            <Show when={s().topCuts > 0}>
              {s().topCuts} top cut{s().topCuts === 1 ? '' : 's'}
            </Show>
            <Show when={s().tournamentWins > 0}>
              <span class='dot'>·</span>
              <Badge variant='regulation'>{s().tournamentWins}× winner</Badge>
            </Show>
          </div>
        </div>
      </section>

      <Show when={props.profile.archetypes.length > 0}>
        <Section
          title='Archetype usage'
          right={`${props.profile.archetypes.length} archetype${props.profile.archetypes.length === 1 ? '' : 's'}`}
        >
          <div class='table-wrap'>
            <table class='data'>
              <thead>
                <tr>
                  <th>Archetype</th>
                  <th class='num'>Events</th>
                  <th class='num'>Record</th>
                  <th class='num'>Win % (ties excluded)</th>
                  <th class='num'>Day 2s</th>
                  <th class='num'>Best</th>
                </tr>
              </thead>
              <tbody>
                <For each={archetypesToShow()}>
                  {a => {
                    const pct = winPercent(a.wins, a.losses);
                    const decisiveGames = a.wins + a.losses;
                    const smallSample = decisiveGames < SMALL_SAMPLE_GAMES;
                    return (
                      <tr>
                        <td>
                          <A href={`/archetypes/${encodeURIComponent(a.base)}`} class='cardname'>
                            {archetypeName(a.base)}
                          </A>
                        </td>
                        <td class='num'>{a.eventCount.toLocaleString()}</td>
                        <td class='num'>
                          {a.wins}-{a.losses}-{a.ties}
                        </td>
                        <td
                          class='num'
                          classList={{ 'stat-dim': smallSample }}
                          title={smallSample ? `Small sample: ${decisiveGames} games` : undefined}
                        >
                          {pct != null ? `${pct.toFixed(1)}%` : '—'}
                        </td>
                        <td class='num'>{a.day2s.toLocaleString()}</td>
                        <td class='num'>{a.bestPlacement ?? '—'}</td>
                      </tr>
                    );
                  }}
                </For>
              </tbody>
            </table>
          </div>
          <Show when={hiddenArchetypeCount() > 0}>
            <button type='button' class='row-toggle' onClick={() => setShowAllArchetypes(v => !v)}>
              {showAllArchetypes() ? 'Show less' : `… ${hiddenArchetypeCount()} more`}
            </button>
          </Show>
        </Section>
      </Show>

      <Section
        title='Tournament history'
        right={`${props.profile.tournaments.length} event${props.profile.tournaments.length === 1 ? '' : 's'}`}
      >
        <div class='table-wrap'>
          <table class='data'>
            <thead>
              <tr>
                <th class='num expand-col' aria-label='Expand' />
                <th>Date</th>
                <th>Event</th>
                <th>Archetype</th>
                <th class='num'>Placement</th>
                <th class='num'>Record</th>
                <th>Day 2</th>
              </tr>
            </thead>
            <tbody>
              <For each={props.profile.tournaments}>
                {t => (
                  <TournamentRow
                    entry={t}
                    archetypeName={archetypeName(t.archetype)}
                    ensureDecks={ensureDecks}
                    cards={() => cardsFor(t.tournamentId)}
                    loading={decksLoading}
                  />
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}

interface TournamentRowProps {
  entry: PlayerTournamentEntry;
  archetypeName: string;
  ensureDecks: () => void;
  cards: () => PlayerDeckCard[] | undefined;
  loading: () => boolean;
}

function TournamentRow(props: TournamentRowProps) {
  const [expanded, setExpanded] = createSignal(false);
  const toggle = () => {
    const next = !expanded();
    setExpanded(next);
    if (next) {
      props.ensureDecks();
    }
  };

  return (
    <>
      <tr
        class='is-link'
        onClick={toggle}
        tabIndex={0}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
          }
        }}
      >
        <td class='num expand-col'>
          <span class='row-caret' classList={{ open: expanded() }} aria-hidden='true'>
            ▸
          </span>
        </td>
        <td class='muted-cell'>{props.entry.tournamentDate}</td>
        <td>
          <span class='cardname'>{prettyTournamentName(props.entry.tournamentId)}</span>
        </td>
        <td class='muted-cell'>
          <Show when={props.entry.archetype} fallback='—'>
            <A
              href={`/archetypes/${encodeURIComponent(props.entry.archetype ?? '')}`}
              onClick={e => e.stopPropagation()}
            >
              {props.archetypeName}
            </A>
          </Show>
        </td>
        <td class='num'>
          {props.entry.placement ?? '—'}
          <Show when={props.entry.totalPlayers}>
            <span class='muted-cell'> / {props.entry.totalPlayers}</span>
          </Show>
        </td>
        <td class='num'>
          {props.entry.wins}-{props.entry.losses}-{props.entry.ties}
        </td>
        <td>
          <Show
            when={props.entry.madeTopCut}
            fallback={
              <Show when={props.entry.madePhase2} fallback={<span class='muted-cell'>—</span>}>
                <Badge>Day 2</Badge>
              </Show>
            }
          >
            <Badge variant='regulation'>Top cut</Badge>
          </Show>
        </td>
      </tr>
      <Show when={expanded()}>
        <tr class='row-expansion'>
          <td colspan={7}>
            <DeckPanel archetypeName={props.archetypeName} cards={props.cards()} loading={props.loading()} />
          </td>
        </tr>
      </Show>
    </>
  );
}

function DeckPanel(props: { archetypeName: string; cards: PlayerDeckCard[] | undefined; loading: boolean }) {
  // Solid components only run their function body once, so plain `if` against
  // `props.cards` / `props.loading` captures a stale snapshot — the panel was
  // sticking on "No decklist published" because the resource hadn't finished
  // loading on first expand, and the body never re-evaluated when it did.
  // Use <Show> so the branch tracks the underlying signals.
  return (
    <Show
      when={props.cards && props.cards.length > 0}
      fallback={
        <div class='row-expansion-empty'>
          <Show when={props.loading} fallback={<>No decklist published for this event.</>}>
            <Skeleton width='180px' height='14px' />
          </Show>
        </div>
      }
    >
      <DeckBody archetypeName={props.archetypeName} cards={props.cards!} />
    </Show>
  );
}

function DeckBody(props: { archetypeName: string; cards: PlayerDeckCard[] }) {
  const groups = createMemo(() => groupDeckByCategory(props.cards));
  const total = () => props.cards.reduce((acc, c) => acc + (c.count ?? 0), 0);

  return (
    <div class='deck-inline'>
      <div class='deck-inline-head'>
        <span class='cardname'>{props.archetypeName || 'Decklist'}</span>
        <span class='muted-cell'>{total()} cards</span>
      </div>
      <div class='deck-inline-groups'>
        <For each={groups()}>
          {group => (
            <div class='deck-inline-group'>
              <div class='deck-inline-group-head'>
                {capitalize(group.label)}
                <span class='deck-inline-group-count'>{group.total}</span>
              </div>
              <ul class='deck-inline-list'>
                <For each={group.cards}>
                  {c => (
                    <li>
                      <Show
                        when={c.set && c.number}
                        fallback={
                          <span>
                            <b>{c.count}×</b> {c.name}
                          </span>
                        }
                      >
                        <A href={`/cards/${c.set}/${c.number}`} onClick={e => e.stopPropagation()}>
                          <b>{c.count}×</b> {c.name}{' '}
                          <span class='muted-cell'>
                            {c.set}/{c.number}
                          </span>
                        </A>
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <>
      <section class='hero'>
        <Skeleton width='280px' height='32px' />
        <div style={{ 'margin-top': '6px' }}>
          <Skeleton width='220px' height='13px' />
        </div>
      </section>
      <section class='kpis'>
        <Skeleton height='100px' />
        <Skeleton height='100px' />
        <Skeleton height='100px' />
        <Skeleton height='100px' />
      </section>
      <section>
        <Skeleton height='320px' />
      </section>
    </>
  );
}
