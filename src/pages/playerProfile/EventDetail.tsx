import { A } from '@solidjs/router';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { ArchetypeIcons } from '../../components/ArchetypeIcon';
import { CardHoverPreview } from '../../components/CardHoverPreview';
import { Segmented } from '../../components/Segmented';
import { Skeleton } from '../../components/Skeleton';
import { getArchetypeIconMap, resolveArchetypeIcons } from '../../lib/data';
import { groupDeckByCategory } from '../../lib/deckGrouping';
import { capitalize } from '../../lib/format';
import type { PlayerDeckCard, PlayerRound, PlayerTournamentEntry } from '../../types';
import { groupRoundsByPhase, OUTCOME_LETTER, outcomeTone } from './model';

type Pane = 'decklist' | 'rounds';

const CHRIS_FRANCO_ID = '2037';
const ORLANDO_TOURNAMENT_ID = '2026-04-03, Regional Championship Orlando';
const SHOUT_OUT_URL = 'https://www.youtube.com/watch?v=SpkkypxnGTs&t=13369s';

const PANE_OPTIONS: { value: Pane; label: string }[] = [
  { value: 'decklist', label: 'Decklist' },
  { value: 'rounds', label: 'Rounds' }
];

/**
 * Where the opened row's data comes from. Decklists and rounds live in two
 * lazy files; the page owns both resources and hands the row accessors.
 */
export interface EventDetailSource {
  /** Start the lazy fetches; safe to call repeatedly. */
  ensure: () => void;
  cards: (tournamentId: string) => PlayerDeckCard[] | undefined;
  rounds: (tournamentId: string) => PlayerRound[] | undefined;
  loading: () => boolean;
}

interface EventDetailProps {
  entry: PlayerTournamentEntry;
  playerId: string;
  source: EventDetailSource;
}

/**
 * The body of an opened event: a Decklist / Rounds switch and one pane. The
 * decklist opens first when the event published one; otherwise the rounds do.
 */
export function EventDetail(props: EventDetailProps) {
  // eslint-disable-next-line solid/reactivity -- opening pane only; the row owns the switch after that
  const [pane, setPane] = createSignal<Pane>(props.entry.deckId ? 'decklist' : 'rounds');
  const cards = () => props.source.cards(props.entry.tournamentId);
  const rounds = () => props.source.rounds(props.entry.tournamentId);

  return (
    <div class='event-detail'>
      <Segmented<Pane> options={PANE_OPTIONS} selected={pane()} onSelect={setPane} ariaLabel='Event detail' />
      <Show when={props.playerId === CHRIS_FRANCO_ID && props.entry.tournamentId === ORLANDO_TOURNAMENT_ID}>
        <a class='btn btn-secondary event-shout-out' href={SHOUT_OUT_URL} target='_blank' rel='noopener'>
          Anyone you'd like to shout out?
        </a>
      </Show>
      <Show when={pane() === 'decklist'}>
        <Show
          when={cards()?.length}
          fallback={<DetailEmpty loading={props.source.loading()} text='No decklist published for this event.' />}
        >
          <DeckBody cards={cards()!} />
        </Show>
      </Show>
      <Show when={pane() === 'rounds'}>
        <Show
          when={rounds()?.length}
          fallback={<DetailEmpty loading={props.source.loading()} text='No round data published for this event.' />}
        >
          <RoundsList rounds={rounds()!} dropRound={props.entry.dropRound ?? null} />
        </Show>
      </Show>
    </div>
  );
}

function DetailEmpty(props: { loading: boolean; text: string }) {
  return (
    <div class='row-expansion-empty'>
      <Show when={props.loading} fallback={props.text}>
        <Skeleton width='180px' height='14px' />
      </Show>
    </div>
  );
}

function RoundsList(props: { rounds: PlayerRound[]; dropRound: number | null }) {
  const groups = createMemo(() => groupRoundsByPhase(props.rounds));
  const iconMap = getArchetypeIconMap();
  return (
    <ol class='rounds'>
      <For each={groups()}>
        {group => (
          <>
            <li class='rounds-phase'>{group.label}</li>
            <For each={group.rounds}>
              {round => (
                <li class='round'>
                  <span class='round-n'>R{round.round}</span>
                  <b class={`round-outcome ${outcomeTone(round.outcome) ?? ''}`}>{OUTCOME_LETTER[round.outcome]}</b>
                  <span class='round-opp'>
                    <Show when={round.opponentName} fallback={<span class='muted-cell'>{roundNote(round)}</span>}>
                      <Show when={round.opponentId} fallback={round.opponentName}>
                        <A href={`/players/${encodeURIComponent(round.opponentId!)}`}>{round.opponentName}</A>
                      </Show>
                    </Show>
                  </span>
                  <span class='round-deck'>
                    <Show when={round.opponentArchetype}>
                      <ArchetypeIcons
                        slugs={resolveArchetypeIcons({ name: round.opponentArchetype }, iconMap)}
                        size={16}
                      />
                      <span>{round.opponentArchetype}</span>
                    </Show>
                  </span>
                  <span class='round-finish'>
                    <Show when={round.opponentPlacement}>#{round.opponentPlacement!.toLocaleString()}</Show>
                  </span>
                </li>
              )}
            </For>
          </>
        )}
      </For>
      <Show when={props.dropRound != null}>
        <li class='rounds-drop'>Dropped after round {props.dropRound}</li>
      </Show>
    </ol>
  );
}

/** What to show in the opponent slot when there was no opponent. */
function roundNote(round: PlayerRound): string {
  if (round.outcome === 'bye') {
    return 'Bye';
  }
  if (round.outcome === 'unpaired') {
    return 'Not paired';
  }
  return '—';
}

export function DeckBody(props: { cards: PlayerDeckCard[] }) {
  const groups = createMemo(() => groupDeckByCategory(props.cards));

  return (
    <div class='deck-inline'>
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
                        <CardHoverPreview set={c.set!} number={c.number!}>
                          <A href={`/cards/${c.set}/${c.number}`}>
                            <b>{c.count}×</b> {c.name}{' '}
                            <span class='muted-cell'>
                              {c.set}/{c.number}
                            </span>
                          </A>
                        </CardHoverPreview>
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
