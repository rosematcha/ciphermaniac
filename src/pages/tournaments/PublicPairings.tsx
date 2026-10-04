/**
 * The public page's pairings box: the round's tables, or once a top cut has
 * started, the cut as a bracket for whoever would rather see it that way.
 * The table stays the default; the choice rides in the address (`view=bracket`)
 * so a shared link opens the same way. Under the bar, a spectator narrows the
 * table to the tables still playing, the players they follow, or one deck.
 */

import { useSearchParams } from '@solidjs/router';
import { createMemo, createSignal, type JSX, lazy, Show } from 'solid-js';
import { withSwiss } from '../../../shared/tournament/rounds';
import type { Pod, Round } from '../../../shared/tournament/types';
import type { TournamentView } from '../../../shared/tournament/view';
import { Segmented } from '../../components/Segmented';
import { filterMatches, hasCut, MATCH_VIEWS, type MatchView } from '../../lib/tournament/present';
import { NO_FILTER, roundDecks, type SpectateFilter, spectatorMatches } from '../../lib/tournament/spectate';
import { MatchTable } from './MatchTable';
import { SpectateBar } from './SpectateBar';

const CutBracket = lazy(() => import('./Bracket').then(m => ({ default: m.CutBracket })));

export function PublicPairings(props: {
  view: TournamentView;
  pod: Pod | undefined;
  round: Round | undefined;
  names: Map<string, string>;
  me: string | null;
  query: string;
  /** The players this device follows. */
  following: ReadonlySet<string>;
  /** The box's bar: the division switch, the search when `withSearch`, the round picker when `withRounds`. */
  bar: (withRounds: boolean, withSearch: boolean) => JSX.Element;
  /** Drawn in place of the tables before round 1. */
  registered: JSX.Element;
  onPlayer: (id: string) => void;
}) {
  const [params, setParams] = useSearchParams<{ view?: string }>();
  const cut = createMemo(() => hasCut(props.pod));
  const shown = (): MatchView => (params.view === 'bracket' && cut() ? 'bracket' : 'table');
  // Memos, so a new copy of the event does not draw the bar again and drop the search mid-word.
  const asTable = createMemo(() => shown() === 'table');
  const withRounds = createMemo(() => props.round !== undefined && asTable());
  const [filter, setFilter] = createSignal<SpectateFilter>(NO_FILTER);
  // Kept as a list of names, so a new copy of the event with the same decks leaves the select alone.
  const decks = createMemo(() => (props.round ? roundDecks(props.round.matches, props.view.decks) : []), [], {
    equals: (a, b) => a.join('\n') === b.join('\n')
  });
  /** The filter as it can apply: following nobody, or a deck nobody plays this round, shows every table. */
  const applied = createMemo((): SpectateFilter => {
    const { showing, deck } = filter();
    return {
      showing: showing === 'following' && props.following.size === 0 ? 'all' : showing,
      deck: deck !== null && decks().includes(deck) ? deck : null
    };
  });
  const matches = (pod: Pod, round: Round) =>
    spectatorMatches(filterMatches(round.matches, props.names, props.query), applied(), {
      pod,
      round,
      pending: props.view.pending,
      decks: props.view.decks,
      following: props.following
    });
  const table = () => (
    <MatchTable
      pod={withSwiss(props.view.tournament, props.pod!)}
      round={props.round!}
      matches={matches(props.pod!, props.round!)}
      names={props.names}
      decks={props.view.decks}
      pending={props.view.pending}
      me={props.me}
      onPlayer={props.onPlayer}
      status
    />
  );
  const choose = (value: MatchView) => setParams({ view: value === 'bracket' ? value : undefined }, { replace: true });
  return (
    <>
      <div class='tm-box-bar'>
        {props.bar(withRounds(), asTable())}
        <Show when={cut()}>
          <Segmented options={MATCH_VIEWS} selected={shown()} onSelect={choose} ariaLabel='Show matches as' />
        </Show>
      </div>
      <Show when={props.round && asTable()}>
        <SpectateBar filter={applied()} decks={decks()} following={props.following.size} onFilter={setFilter} />
      </Show>
      <Show when={props.pod && props.round} fallback={props.registered}>
        <Show when={shown() === 'bracket'} fallback={table()}>
          <CutBracket
            tournament={props.view.tournament}
            pod={props.pod!}
            pending={props.view.pending}
            names={props.names}
            me={props.me}
            onPlayer={props.onPlayer}
            fallback={table()}
          />
        </Show>
      </Show>
    </>
  );
}
