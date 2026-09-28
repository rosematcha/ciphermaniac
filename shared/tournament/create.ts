/** A new Swiss event with no players yet. */

import type { Tournament, TournamentInfo } from './types.js';

export const DEFAULT_ROUND_MINUTES = 50;
export const DEFAULT_FINALS_MINUTES = 75;

export function emptyTournament(info: Partial<TournamentInfo> & { name: string }, combined: boolean): Tournament {
  return {
    info: {
      sanctionId: '',
      city: '',
      state: '',
      country: '',
      roundTime: DEFAULT_ROUND_MINUTES,
      finalsRoundTime: DEFAULT_FINALS_MINUTES,
      organizerPopId: '',
      organizerName: '',
      startDate: '',
      ...info
    },
    players: [],
    pods: [],
    combined
  };
}
