/**
 * An event whose divisions played Swiss together and cut apart (§5.2.1):
 * four Juniors and four Masters in one pod, then a Juniors top 4 played to
 * its final, and the Masters with no cut.
 */

import { applyCommand, type Command } from '../../shared/tournament/commands.ts';
import { emptyTournament } from '../../shared/tournament/create.ts';
import { seededRandom } from '../../shared/tournament/random.ts';
import { latestRound } from '../../shared/tournament/rounds.ts';
import type { PodCategory, Tournament } from '../../shared/tournament/types.ts';

function run(tournament: Tournament, ...commands: Command[]): Tournament {
  return commands.reduce((current, command) => {
    const result = applyCommand(current, command, {
      now: 0,
      localTime: '10/10/2026 10:00:00',
      season: 2027,
      random: seededRandom(5)
    });
    if (!result.ok) {
      throw new Error(`${command.type}: ${result.error}`);
    }
    return result.tournament;
  }, tournament);
}

/** Every open match in the pod's current round, won by the first seat. */
function reportAll(t: Tournament, category: PodCategory): Tournament {
  const round = latestRound(t.pods.find(pod => pod.category === category));
  const reports = (round?.matches ?? [])
    .filter(m => m.p2 !== null && m.outcome === 'pending')
    .map(m => ({ type: 'reportResult', pod: category, round: round?.number ?? 0, ...m, outcome: 'p1' }) as Command);
  return run(t, ...reports);
}

export function juniorsCutApart(): Tournament {
  const years = ['2016', '2016', '2016', '2016', '1990', '1990', '1990', '1990'];
  const adds = years.map(
    (year, i) =>
      ({
        type: 'addPlayer',
        player: { firstName: 'P', lastName: `${i}`, id: `${500 + i}`, birthDate: `02/27/${year}` }
      }) as Command
  );
  let t = run(emptyTournament({ name: 'Apart', startDate: '10/10/2026' }), ...adds, {
    type: 'pairRound',
    pod: 'mixed'
  });
  t = run(reportAll(t, 'mixed'), { type: 'startTopCut', pod: 'mixed', size: 4, division: 'junior' });
  t = run(reportAll(t, 'mixed'), { type: 'pairRound', pod: 'mixed' });
  return reportAll(t, 'mixed');
}
