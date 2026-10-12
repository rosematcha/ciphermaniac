import assert from 'node:assert/strict';

import type { FixtureScenario } from './conformance-fixtures.ts';

/** Retain every scenario; unsupported event generation is an explicit test skip. */
export const REPLAY_SKIPS: Readonly<Record<string, string>> = {
  'v17-wizard-third-place-championship': 'TCG Championship configuration is outside the requested TCG scope',
  'v17-wizard-third-place-two-day': 'Two-day events are outside the requested scope',
  'v17-wizard-third-place-vgc-premier': 'Video Game events are outside the requested scope',
  'v16-empty-finish-go': 'GO events are outside the requested scope',
  'v14a-go-cut-four': 'GO events are outside the requested scope',
  'v14a-go-cut-four-third-place': 'GO events are outside the requested scope',
  'v14a-go-cut-four-third-place-reloaded': 'GO events are outside the requested scope',
  'v14a-go-elimination-third-place': 'GO events are outside the requested scope',
  'v14a-random-go-cut-reloads': 'GO events are outside the requested scope',
  'v14a-random-go-elimination-reloads': 'GO events are outside the requested scope',
  'v14a-random-opponent-later-round': 'Video Game events are outside the requested scope',
  'v14a-random-vg-cut-entries': 'Video Game events are outside the requested scope',
  'v14a-rounds-go-thirteen-cut': 'GO events are outside the requested scope',
  'v15-wizard-cut-championship-choice-overridden': 'TCG Championship configuration is outside the requested TCG scope',
  'v15-wizard-cut-go-unavailable-eight': 'GO events are outside the requested scope',
  'v15-wizard-cut-video-game-unavailable-eight': 'Video Game events are outside the requested scope',
  'championship-count-1025': 'TCG Championship round-count rules are outside the requested TCG scope',
  'championship-count-2049': 'TCG Championship round-count rules are outside the requested TCG scope',
  'championship-count-4097': 'TCG Championship round-count rules are outside the requested TCG scope',
  'championship-cut-2': 'TCG Championship asymmetric cuts are outside the requested TCG scope',
  'championship-cut-4': 'TCG Championship asymmetric cuts are outside the requested TCG scope',
  'championship-cut-6': 'TCG Championship asymmetric cuts are outside the requested TCG scope',
  'championship-cut-8': 'TCG Championship asymmetric cuts are outside the requested TCG scope',
  'tcg-championship-defaults': 'TCG Championship configuration is outside the requested TCG scope',
  'day-two-no-qualifiers': 'Two-day events are outside the requested scope',
  'day-two-single-qualifier': 'Two-day events are outside the requested scope',
  'two-day-swiss': 'Two-day events are outside the requested scope',
  'v10-rounds-go-two-flights': 'GO events are outside the requested scope',
  'go-cut-16': 'GO events are outside the requested scope',
  'go-cut-2': 'GO events are outside the requested scope',
  'go-cut-32': 'GO events are outside the requested scope',
  'go-cut-4': 'GO events are outside the requested scope',
  'go-cut-8': 'GO events are outside the requested scope',
  'go-premier-defaults': 'GO events are outside the requested scope',
  'v12a-rounds-vg-thirteen-cut': 'Video Game events are outside the requested scope',
  'vgc-championship': 'Video Game events are outside the requested scope',
  'vgc-premier-defaults': 'Video Game events are outside the requested scope',
  'video_game-cut-16': 'Video Game events are outside the requested scope',
  'video_game-cut-2': 'Video Game events are outside the requested scope',
  'video_game-cut-32': 'Video Game events are outside the requested scope',
  'video_game-cut-4': 'Video Game events are outside the requested scope',
  'video_game-cut-8': 'Video Game events are outside the requested scope'
};

/** Why a scenario's event lies outside the requested TCG scope, or undefined when it is replayed. */
export function outOfScope(scenario: FixtureScenario): string | undefined {
  const first = scenario.operations[0]!;
  if (first.game !== 'TRADING_CARD_GAME') {
    return `${first.game} events are outside the requested scope`;
  }
  if (first.type === 4 || first.mode === 'TCG2DAY') {
    return 'Two-day events are outside the requested scope';
  }
  return first.mode === 'TCGCHAMPIONSHIP' ? 'TCG Championship events are outside the requested TCG scope' : undefined;
}

export function assertReplayScope(scenarios: FixtureScenario[]): void {
  const ids = new Set(scenarios.map(s => s.id));
  for (const id of Object.keys(REPLAY_SKIPS)) {
    assert.ok(ids.has(id), `Skip list references a missing scenario: ${id}`);
  }
  for (const scenario of scenarios) {
    const unsupported = outOfScope(scenario) !== undefined;
    assert.equal(Boolean(REPLAY_SKIPS[scenario.id]), unsupported, `Unexpected replay scope: ${scenario.id}`);
  }
}
