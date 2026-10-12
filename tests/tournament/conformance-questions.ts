import { existsSync, readFileSync } from 'node:fs';

import { lifecycleDocument } from '../../shared/tournament/lifecycleImport.ts';
import { parseTdf } from '../../shared/tournament/tdf.ts';
import type { Tournament } from '../../shared/tournament/types.ts';

export const REPLAY_QUESTIONS: Readonly<Record<string, { entry: string; fields: readonly string[] }>> = {};

const questionsPath = 'tests/fixtures/tom-conformance/QUESTIONS.md';
export const questionText = existsSync(questionsPath) ? readFileSync(questionsPath, 'utf8') : '';

/**
 * Compare every answered field before starting an independent suffix from a documented unknown transition. A
 * withheld element is left out wherever it appears, so neither its value nor which player holds it is compared; a
 * seat such as `<player2 userid="…"/>` keeps its place and loses only its player ID.
 */
export function answeredCheckpoint(xml: string, fields: readonly string[]): string {
  return fields.reduce(
    (text, tag) =>
      text
        .replace(new RegExp(`[ \\t]*<${tag}>[^<]*</${tag}>\\n?`, 'g'), '')
        .replace(new RegExp(`<${tag} userid="[^"]*"`, 'g'), `<${tag} userid="unresolved"`),
    xml
  );
}

/** A fixture seeds only the independent suffix after a withheld transition; it never replaces a computed checkpoint. */
export function questionSuffix(prior: Tournament, checkpoint: string): Tournament {
  const imported = lifecycleDocument(parseTdf(checkpoint));
  const preferences = new Map(prior.players.map(p => [p.id, p]));
  return {
    ...imported,
    startedAt: prior.startedAt,
    players: imported.players.map(player => {
      const priorPlayer = preferences.get(player.id);
      return {
        ...player,
        tiebreaker: priorPlayer?.tiebreaker,
        scheduledSwissRounds: priorPlayer?.scheduledSwissRounds
      };
    })
  };
}
