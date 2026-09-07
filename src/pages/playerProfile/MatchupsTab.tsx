import { A } from '@solidjs/router';
import { createMemo, For, Show } from 'solid-js';
import { ArchetypeIcons } from '../../components/ArchetypeIcon';
import { EmptyState } from '../../components/EmptyState';
import { getArchetypeIconMap, resolveArchetypeIcons } from '../../lib/data';
import {
  type CareerRounds,
  distinctOpponents,
  MATCHUP_MIN_GAMES,
  matchupRollup,
  phaseSplit,
  REPEAT_MIN_MEETINGS,
  repeatOpponents,
  shortTournamentName,
  winRateWhole
} from './model';

/**
 * The career against the field: record by opponent deck, by phase, and the
 * opponents met more than once. All three roll up from the rounds the profile
 * already carries, so this tab needs no fetch of its own.
 */
export function MatchupsTab(props: { rounds: CareerRounds }) {
  return (
    <Show
      when={Object.keys(props.rounds).length > 0}
      fallback={
        <EmptyState
          title='No round data for this player.'
          description="None of this player's events published round-by-round pairings."
        />
      }
    >
      <MatchupsBody rounds={props.rounds} />
    </Show>
  );
}

function MatchupsBody(props: { rounds: CareerRounds }) {
  const rows = createMemo(() => matchupRollup(props.rounds));
  const shown = createMemo(() => rows().filter(r => r.games >= MATCHUP_MIN_GAMES));
  const rare = createMemo(() => rows().length - shown().length);
  const phases = createMemo(() => phaseSplit(props.rounds));
  const repeats = createMemo(() => repeatOpponents(props.rounds));
  const opponents = createMemo(() => distinctOpponents(props.rounds));
  const iconMap = getArchetypeIconMap();

  return (
    <>
      <div class='matchups-grid'>
        <div>
          <h3 class='profile-h3'>
            Decks faced
            <span class='muted-note'>{MATCHUP_MIN_GAMES}+ games</span>
          </h3>
          <Show
            when={shown().length > 0}
            fallback={<p class='profile-note'>No deck faced {MATCHUP_MIN_GAMES} times yet.</p>}
          >
            <div class='table-wrap'>
              <table class='data matchup-table'>
                <thead>
                  <tr>
                    <th>Opponent's deck</th>
                    <th class='num'>Games</th>
                    <th class='num'>Record</th>
                    <th>Win %</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={shown()}>
                    {row => (
                      <tr>
                        <td>
                          <span class='arche-name-cell'>
                            <ArchetypeIcons
                              slugs={resolveArchetypeIcons({ name: row.archetype }, iconMap)}
                              size={18}
                              reserveSlot
                            />
                            <span class='cardname'>{row.archetype}</span>
                          </span>
                        </td>
                        <td class='num'>{row.games}</td>
                        <td class='num'>
                          {row.wins}-{row.losses}-{row.ties}
                        </td>
                        <td>
                          <WinRate rate={row.winRate} />
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </Show>
          <Show when={rare() > 0}>
            <p class='profile-note'>
              {rare()} more {rare() === 1 ? 'deck' : 'decks'} faced fewer than {MATCHUP_MIN_GAMES} times.
            </p>
          </Show>
        </div>
        <div>
          <h3 class='profile-h3'>By phase</h3>
          <div class='stats-list phase-list'>
            <For each={phases()}>
              {phase => (
                <div class='stat-row'>
                  <span class='stat-label'>{phase.label}</span>
                  <span class='stat-value'>
                    {formatRate(winRateWhole(phase.wins, phase.losses))}
                    <span class='stat-rank-total'>
                      {phase.wins}-{phase.losses}-{phase.ties}
                    </span>
                  </span>
                </div>
              )}
            </For>
          </div>
        </div>
      </div>

      <h3 class='profile-h3'>Players faced more than once</h3>
      <Show
        when={repeats().length > 0}
        fallback={<p class='profile-note'>No opponent has come up {REPEAT_MIN_MEETINGS} times yet.</p>}
      >
        <div class='table-wrap'>
          <table class='data'>
            <thead>
              <tr>
                <th>Opponent</th>
                <th>Country</th>
                <th class='num'>Met</th>
                <th class='num'>Record</th>
                <th class='matchups-where'>Where</th>
              </tr>
            </thead>
            <tbody>
              <For each={repeats()}>
                {row => (
                  <tr classList={{ 'is-link': Boolean(row.playerId) }}>
                    <td>
                      <Show when={row.playerId} fallback={<span class='cardname'>{row.name}</span>}>
                        <A href={`/players/${encodeURIComponent(row.playerId!)}`} class='cardname'>
                          {row.name}
                        </A>
                      </Show>
                    </td>
                    <td class='muted-cell'>{row.country ?? '—'}</td>
                    <td class='num'>{row.meetings}</td>
                    <td class='num'>
                      {row.wins}-{row.losses}-{row.ties}
                    </td>
                    <td class='muted-cell matchups-where'>{row.events.map(shortTournamentName).join(', ')}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>
      <p class='profile-note'>
        {opponents().toLocaleString()} different opponents; {repeats().length} met more than once.
      </p>
    </>
  );
}

function formatRate(rate: number | null): string {
  return rate == null ? '—' : `${rate}%`;
}

/** Whole-number win rate beside its deviation gauge. */
function WinRate(props: { rate: number | null }) {
  const down = () => props.rate != null && props.rate < 0.5;
  const fill = () => (props.rate == null ? 0 : Math.round((Math.abs(props.rate - 0.5) / 0.5) * 100));
  return (
    <Show when={props.rate != null} fallback={<span class='muted-cell'>—</span>}>
      <span class='wr-gauge' classList={{ down: down() }} aria-hidden='true'>
        <i style={{ width: `${fill()}%` }} />
      </span>
      <b class='wr-value' classList={{ up: !down(), down: down() }}>
        {Math.round(props.rate! * 100)}%
      </b>
    </Show>
  );
}
