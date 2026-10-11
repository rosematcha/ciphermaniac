import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { awaitingMark, type SeatState } from '../../src/lib/tournament/awaitingMarks';
import type { SeatTag } from '../../src/lib/tournament/present';

const tag = (text: string, problem = false): SeatTag => ({ text, problem, title: text });
const state = (patch: Partial<SeatState> = {}): SeatState => ({
  mark: '',
  unconfirmed: false,
  tag: null,
  opponentTag: null,
  ...patch
});

describe('pending seat marks', () => {
  it('leaves an unreported seat empty', () => {
    assert.deepEqual(awaitingMark(state()), { mark: '', pending: false, problem: false });
  });
  it('uses each reported outcome and its opposite for the other seat', () => {
    for (const [text, own, opposite] of [
      ['Won', 'W', 'L'],
      ['Lost', 'L', 'W'],
      ['Tie', 'T', 'T'],
      ['Double loss', 'L', 'L']
    ]) {
      assert.deepEqual(awaitingMark(state({ tag: tag(text ?? '') })), { mark: own, pending: true, problem: false });
      assert.deepEqual(awaitingMark(state({ opponentTag: tag(text ?? '') })), {
        mark: opposite,
        pending: true,
        problem: false
      });
    }
  });
  it('marks a disputed report without inferring a disputed opponent’s result', () => {
    assert.deepEqual(awaitingMark(state({ tag: tag('Won', true) })), { mark: 'W', pending: true, problem: true });
    assert.deepEqual(awaitingMark(state({ opponentTag: tag('Won', true) })), {
      mark: '',
      pending: false,
      problem: false
    });
  });
  it('gives the recorded or optimistic result precedence over reports', () => {
    assert.deepEqual(awaitingMark(state({ mark: 'L', tag: tag('Won', true) })), {
      mark: 'L',
      pending: false,
      problem: false
    });
    assert.deepEqual(awaitingMark(state({ mark: 'W', unconfirmed: true })), {
      mark: 'W',
      pending: true,
      problem: false
    });
  });
  it('ignores unfamiliar report labels', () => {
    assert.equal(awaitingMark(state({ tag: tag('Unknown') })).pending, false);
    assert.equal(awaitingMark(state({ opponentTag: tag('Unknown') })).mark, '');
  });
});
