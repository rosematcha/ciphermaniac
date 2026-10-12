import assert from 'node:assert/strict';
import test from 'node:test';

import { loadScenarios } from './conformance-fixtures.ts';
import { replayScenario } from './conformance-replayer.ts';
import { assertReplayScope, REPLAY_SKIPS } from './conformance-scope.ts';

import { questionText, REPLAY_QUESTIONS } from './conformance-questions.ts';

const scenarios = loadScenarios();
assertReplayScope(scenarios);
for (const scenario of scenarios) {
  test(`TOM replay: ${scenario.id}`, { skip: REPLAY_SKIPS[scenario.id] }, () => {
    assert.deepEqual(replayScenario(scenario), []);
  });
}

for (const [checkpoint, question] of Object.entries(REPLAY_QUESTIONS)) {
  assert.ok(questionText.includes(`## ${question.entry}:`));
  assert.ok(scenarios.some(s => s.operations.some(op => `${s.id}/${op.fixture}` === checkpoint)));
  test(
    `TOM unanswered assertion: ${checkpoint}`,
    { skip: `tests/fixtures/tom-conformance/QUESTIONS.md#${question.entry}` },
    () => {
      assert.fail('Resolve the referenced question before enabling this transition assertion');
    }
  );
}
