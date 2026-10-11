import type { SeatTag } from './present';

const ownMarks: Record<string, string> = { Won: 'W', Lost: 'L', Tie: 'T', 'Double loss': 'L' };
const oppositeMarks: Record<string, string> = { Won: 'L', Lost: 'W', Tie: 'T', 'Double loss': 'L' };

export type SeatState = {
  mark: string;
  unconfirmed: boolean;
  tag: SeatTag | null;
  opponentTag: SeatTag | null;
};

export function awaitingMark(state: SeatState) {
  if (state.mark) {
    return { mark: state.mark, pending: state.unconfirmed, problem: false };
  }
  const mark = state.tag
    ? (ownMarks[state.tag.text] ?? '')
    : (state.opponentTag && !state.opponentTag.problem && oppositeMarks[state.opponentTag.text]) || '';
  return { mark, pending: Boolean(mark), problem: Boolean(mark && state.tag?.problem) };
}
