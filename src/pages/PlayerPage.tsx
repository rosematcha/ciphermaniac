import { A, useParams } from '@solidjs/router';
import { createEffect, createMemo, createResource, For, onMount, Show } from 'solid-js';
import { type DeckRecord, fetchDecks, fetchParticipants, prettyTournamentName } from '../lib/data';
import { useTournament } from '../lib/tournamentContext';
import { ONLINE_META_NAME } from '../lib/constants';
import type { TournamentParticipant } from '../types';
import { Breadcrumb } from '../components/Breadcrumb';
import { Badge } from '../components/Badge';
import { Skeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { CardImage } from '../components/CardImage';
import { capitalize, formatRecord } from '../lib/format';
import { groupDeckByCategory } from '../lib/deckGrouping';
import { resolved } from '../lib/resource';
import '../styles/pages/players-tables.css';

/** Match win rate excluding ties. Returns null when there are no decisive games. */
function winPercent(wins: number, losses: number): number | null {
  const denom = wins + losses;
  if (!denom) {
    return null;
  }
  return Math.round((wins / denom) * 1000) / 10;
}

export function PlayerPage() {
  const params = useParams<{ id: string }>();
  const { tournament } = useTournament();
  const [participants] = createResource(tournament, fetchParticipants);
  const [decks] = createResource(tournament, fetchDecks);

  // Non-suspending reads (see lib/resource.ts). `resolved`, not `latestValue`:
  // on a tournament switch we'd rather show the skeleton than the previous
  // tournament's player under this URL.
  const participantsData = () => resolved(participants);
  const decksData = () => resolved(decks);

  const player = createMemo<TournamentParticipant | undefined>(() => {
    const list = participantsData() ?? [];
    return list.find(p => String(p.tpId) === params.id);
  });

  const deck = createMemo<DeckRecord | undefined>(() => {
    const list = decksData() ?? [];
    const p = player();
    if (!p) {
      return undefined;
    }
    return list.find(d => String(d.playerId) === params.id || d.player === p.name);
  });

  onMount(() => {
    document.title = 'Player — Ciphermaniac';
  });

  createEffect(() => {
    const p = player();
    if (p) {
      document.title = `${p.name} — Ciphermaniac`;
    }
  });

  const isOnline = () => tournament() === ONLINE_META_NAME;

  return (
    <>
      <Breadcrumb crumbs={[{ label: 'Standings', href: '/standings' }, { label: player()?.name ?? `#${params.id}` }]} />

      <Show when={isOnline()}>
        <EmptyState
          title='Player profiles require a tournament.'
          description='The rolling online window aggregates many tournaments without per-player attribution. Switch to a specific tournament from the selector to see players.'
          actions={
            <A href='/tournaments' class='btn btn-primary'>
              Browse tournaments
            </A>
          }
        />
      </Show>

      <Show when={!isOnline()}>
        <Show
          when={participantsData() && player()}
          fallback={
            // participants() resolves null (not undefined) when players.json is
            // missing — without this branch the skeleton spins forever.
            <Show
              when={participantsData() === null}
              fallback={
                <Show when={participantsData() && !player()} fallback={<PlayerSkeleton />}>
                  <EmptyState
                    title='Player not found.'
                    description="That player isn't listed in the active tournament's records."
                    actions={
                      <A href='/standings' class='btn btn-secondary'>
                        Back to standings
                      </A>
                    }
                  />
                </Show>
              }
            >
              <EmptyState
                title='No player data for this tournament.'
                description="players.json isn't published for this tournament yet. It might be a special event with limited reporting."
                actions={
                  <A href='/tournaments' class='btn btn-primary'>
                    Browse tournaments
                  </A>
                }
              />
            </Show>
          }
        >
          <PlayerBody player={player()!} deck={deck()} tournament={tournament()} />
        </Show>
      </Show>
    </>
  );
}

function PlayerBody(props: { player: TournamentParticipant; deck: DeckRecord | undefined; tournament: string }) {
  const grouped = createMemo(() => groupDeckByCategory(props.deck?.cards));
  const winPct = () => winPercent(props.player.wins ?? 0, props.player.losses ?? 0);

  return (
    <>
      <section class='hero'>
        <h1>{props.player.name}</h1>
        <div class='hero-meta'>
          <Show when={props.player.placement}>
            <span>Placed #{props.player.placement}</span>
            <span class='dot'>·</span>
          </Show>
          <span>{formatRecord(props.player)}</span>
          <Show when={props.player.points !== undefined}>
            <span class='dot'>·</span>
            <span>{props.player.points} pts</span>
          </Show>
          <span class='dot'>·</span>
          <span>{prettyTournamentName(props.tournament)}</span>
        </div>
      </section>

      <section class='kpis'>
        <div class='kpi'>
          <div class='kpi-label'>Archetype</div>
          <div class='kpi-value leader'>{props.player.deckName ?? '—'}</div>
          <div class='kpi-foot'>
            {props.player.country ?? '—'}
            <Show when={props.player.madeTopCut}>
              <span class='dot'>·</span>
              <Badge variant='regulation'>Top cut</Badge>
            </Show>
            <Show when={!props.player.madeTopCut && props.player.madePhase2}>
              <span class='dot'>·</span>
              <Badge>Phase 2</Badge>
            </Show>
          </div>
        </div>
        <div class='kpi'>
          <div class='kpi-label'>Wins</div>
          <div class='kpi-value'>{props.player.wins ?? '—'}</div>
        </div>
        <div class='kpi'>
          <div class='kpi-label'>Losses</div>
          <div class='kpi-value'>{props.player.losses ?? '—'}</div>
        </div>
        <div class='kpi'>
          <div class='kpi-label'>Ties</div>
          <div class='kpi-value'>{props.player.ties ?? '—'}</div>
        </div>
        <div class='kpi'>
          <div class='kpi-label'>Win %</div>
          <div class='kpi-value'>{winPct() != null ? `${winPct()!.toFixed(1)}%` : '—'}</div>
          <div class='kpi-foot'>ties excluded</div>
        </div>
      </section>

      <Show
        when={props.deck && props.deck.cards.length > 0}
        fallback={
          <section>
            <EmptyState
              title='No decklist published.'
              description={
                props.player.decklistPublished
                  ? 'The deck record is missing or unreadable.'
                  : 'This player did not publish a decklist.'
              }
            />
          </section>
        }
      >
        <section>
          <div class='section-head'>
            <h2>Decklist</h2>
            <span class='right'>
              {totalDeckCount(props.deck!)} cards · {grouped().length} groups
            </span>
          </div>
          <div class='deck-grid'>
            <For each={grouped()}>
              {group => (
                <div class='deck-group'>
                  <div class='deck-group-head'>
                    {capitalize(group.label)}
                    <span class='deck-group-count'>{group.total}</span>
                  </div>
                  <div class='deck-cards'>
                    <For each={group.cards}>
                      {c => (
                        <A
                          href={c.set && c.number ? `/cards/${c.set}/${c.number}` : '#'}
                          class='deck-card'
                          tabIndex={c.set && c.number ? 0 : -1}
                        >
                          <div class='deck-card-image'>
                            <Show
                              when={c.set && c.number}
                              fallback={
                                <div class='card-image-fallback'>
                                  <div class='card-image-fallback-inner'>
                                    <div class='set'>{c.set ?? '?'}</div>
                                    <div class='number'>#{c.number ?? '?'}</div>
                                  </div>
                                </div>
                              }
                            >
                              <CardImage set={c.set!} number={c.number!} size='sm' />
                            </Show>
                          </div>
                          <div class='deck-card-info'>
                            <span class='deck-card-count'>{c.count}×</span>
                            <span class='deck-card-name'>{c.name}</span>
                          </div>
                        </A>
                      )}
                    </For>
                  </div>
                </div>
              )}
            </For>
          </div>
        </section>
      </Show>
    </>
  );
}

function totalDeckCount(deck: DeckRecord): number {
  return deck.cards.reduce((acc, c) => acc + (c.count ?? 0), 0);
}

function PlayerSkeleton() {
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
        <Skeleton height='360px' />
      </section>
    </>
  );
}
