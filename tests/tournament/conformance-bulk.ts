/**
 * Replays an extracted bulk TOM corpus and writes a machine-readable divergence report. It is not part
 * of the unit suite: `npm run test:conformance-bulk -- <corpus directory> [--report <file>]`, or set
 * TOM_BULK_DIR and TOM_BULK_REPORT. Every scenario is replayed; a divergent checkpoint is recorded and the
 * replay resumes from TOM's checkpoint, so later checkpoints are compared independently.
 */
// The fixtures' wall clock is UTC; resuming from a TOM checkpoint reads its times in the host's zone.
process.env.TZ = 'UTC';

import { writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import { BULK_QUESTIONS } from './conformance-bulk-questions.ts';
import { readScenario, scenarioIds } from './conformance-fixtures.ts';
import { type ReplayDifference, replayScenario } from './conformance-replayer.ts';
import { questionText } from './conformance-questions.ts';
import { outOfScope } from './conformance-scope.ts';

interface BulkDivergence extends ReplayDifference {
  scenario: string;
  checkpoint: string;
  /** The scenario's first divergence; later ones resume from TOM's checkpoint. */
  first: boolean;
  operations: number;
  players: number;
}

/** A signature groups the first differing field or refusal for one operation; root-cause review can split it further. */
function signature(difference: ReplayDifference): string {
  return [difference.kind, difference.operation, difference.path ?? difference.message?.split('\n')[0]].join(':');
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : undefined;
}

const positional = process.argv.slice(2).find((arg, i, all) => !arg.startsWith('--') && all[i - 1] !== '--report');
const root = resolve(positional ?? process.env.TOM_BULK_DIR ?? '');
if (!positional && !process.env.TOM_BULK_DIR) {
  throw new Error('Pass the extracted corpus directory as an argument or in TOM_BULK_DIR');
}
const report = resolve(
  argument('--report') ?? process.env.TOM_BULK_REPORT ?? join(dirname(root), `${basename(root)}-report.json`)
);

function playerCount(scenario: ReturnType<typeof readScenario>): number {
  return scenario.operations.reduce(
    (count, op) => count + (op.players?.length ?? 0) + (op.op === 'late-entry' ? 1 : 0),
    0
  );
}

function replayed(id: string): { divergences: BulkDivergence[]; scope?: string; checkpoints: number } {
  let scenario: ReturnType<typeof readScenario>;
  try {
    scenario = readScenario(root, id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const divergence = { step: id, expectedLine: '', actualLine: '', kind: 'error' as const, message };
    return {
      divergences: [{ ...divergence, scenario: id, checkpoint: '', first: true, operations: 0, players: 0 }],
      checkpoints: 0
    };
  }
  const scope = outOfScope(scenario);
  if (scope) {
    return { divergences: [], scope, checkpoints: scenario.operations.length };
  }
  const size = { operations: scenario.operations.length, players: playerCount(scenario) };
  let differences: ReplayDifference[];
  try {
    differences = replayScenario(scenario, { tolerant: true, questions: BULK_QUESTIONS });
  } catch (error) {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    differences = [{ step: `${id}/`, expectedLine: '', actualLine: '', kind: 'error', operation: 'replay', message }];
  }
  const divergences = differences.map((difference, i) => ({
    ...difference,
    scenario: id,
    checkpoint: difference.step.slice(id.length + 1),
    first: i === 0,
    ...size
  }));
  return { divergences, checkpoints: scenario.operations.length };
}

for (const [checkpoint, question] of Object.entries(BULK_QUESTIONS)) {
  if (!questionText.includes(`## ${question.entry}:`)) {
    throw new Error(`${checkpoint} names a missing question ${question.entry}`);
  }
}
const ids = scenarioIds(root);
const divergences: BulkDivergence[] = [];
const scopeSkipped: { scenario: string; reason: string }[] = [];
let checkpoints = 0;
const started = Date.now();
for (const [i, id] of ids.entries()) {
  const result = replayed(id);
  divergences.push(...result.divergences);
  checkpoints += result.scope ? 0 : result.checkpoints;
  if (result.scope) {
    scopeSkipped.push({ scenario: id, reason: result.scope });
  }
  if ((i + 1) % 250 === 0) {
    process.stderr.write(
      `${i + 1}/${ids.length} scenarios, ${divergences.length} divergences, ${Math.round((Date.now() - started) / 1000)}s\n`
    );
  }
}
const summary = {
  corpus: basename(root),
  scenarios: ids.length,
  replayed: ids.length - scopeSkipped.length,
  scopeSkipped: scopeSkipped.length,
  checkpoints,
  divergingScenarios: new Set(divergences.map(d => d.scenario)).size,
  divergingCheckpoints: divergences.length,
  signatureClusters: new Set(divergences.map(signature)).size,
  withheld: Object.keys(BULK_QUESTIONS).filter(key => ids.includes(key.split('/')[0]!)).length
};
writeFileSync(report, `${JSON.stringify({ ...summary, scopeSkippedScenarios: scopeSkipped, divergences }, null, 1)}\n`);
process.stdout.write(`${JSON.stringify(summary)}\nReport: ${report}\n`);
