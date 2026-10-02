import type { LiveMatch, LiveSeat } from './types';

function sameSeat(before: LiveSeat, after: LiveSeat): boolean {
  return (
    before.name === after.name &&
    before.country === after.country &&
    before.wins === after.wins &&
    before.losses === after.losses &&
    before.ties === after.ties &&
    before.points === after.points &&
    before.result === after.result &&
    before.dropped === after.dropped
  );
}

function sameMatch(before: LiveMatch, after: LiveMatch): boolean {
  return (
    before.table === after.table &&
    before.complete === after.complete &&
    before.submitted === after.submitted &&
    before.seats.length === after.seats.length &&
    before.seats.every((seat, i) => sameSeat(seat, after.seats[i]))
  );
}

/** Compare the published fields without serializing or allocating a second round. */
export function sameMatches(before: readonly LiveMatch[], after: readonly LiveMatch[]): boolean {
  return before.length === after.length && before.every((match, i) => sameMatch(match, after[i]));
}
