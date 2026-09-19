/**
 * Where a live seat leads. A seat whose career the site knows goes to that
 * career; everyone else gets the event-scoped page for their seat.
 * @module src/pages/live/links
 */

import { type SeatProfile, type SeatRef, seatSlug } from '../../../shared/live/view';

export function seatHref(slug: string, seat: SeatRef, profile: SeatProfile | null): string {
  return profile ? `/players/${encodeURIComponent(profile.playerId)}` : `/live/${slug}/player/${seatSlug(seat)}`;
}

/** The name to print for a seat: the career's, when the seat resolves to one. */
export function seatName(seat: SeatRef, profile: SeatProfile | null): string {
  return profile?.name ?? seat.name;
}
