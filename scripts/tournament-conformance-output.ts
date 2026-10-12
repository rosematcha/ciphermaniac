import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadScenarios } from '../tests/tournament/conformance-fixtures.ts';
import { replayScenario } from '../tests/tournament/conformance-replayer.ts';
import { assertReplayScope, REPLAY_SKIPS } from '../tests/tournament/conformance-scope.ts';

const output = resolve(process.argv[2] ?? '.scratch/tom-conformance-output');
const scenarios = loadScenarios();
assertReplayScope(scenarios);
mkdirSync(output, { recursive: true });
let checkpoints = 0;
for (const scenario of scenarios) {
  if (REPLAY_SKIPS[scenario.id]) {
    continue;
  }
  assert.deepEqual(replayScenario(scenario, { outputDirectory: output }), [], scenario.id);
  checkpoints += scenario.operations.length;
}
writeFileSync(
  resolve(output, 'scope.json'),
  `${JSON.stringify(
    {
      checkpoints,
      skipped: REPLAY_SKIPS
    },
    null,
    2
  )}\n`
);
process.stdout.write(`Wrote ${checkpoints} checkpoints to ${output}\n`);
