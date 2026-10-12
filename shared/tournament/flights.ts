import { type Random, shuffled } from './random.js';
import type { Pod } from './types.js';

type Flight = NonNullable<Pod['flights']>[number];

export function validFlightCount(players: number, count: number): boolean {
  return [1, 2, 4, 8, 16].includes(count) && (count === 1 || players >= count * 32);
}

/** Keep an odd flight together first, then randomly choose among the smallest. */
export function joiningFlight(flights: readonly Flight[], random: Random): number {
  const odd = flights.findIndex(f => f.playerIds.length % 2 === 1);
  if (odd >= 0) {
    return odd;
  }
  const minimum = Math.min(...flights.map(f => f.playerIds.length));
  const choices = flights.flatMap((f, index) => (f.playerIds.length === minimum ? [index] : []));
  return choices[Math.floor(random() * choices.length)] ?? 0;
}

export function dealFlights(ids: readonly string[], count: number, random: Random): Flight[] {
  const flights = Array.from({ length: count }, (_, index) => ({ number: index + 1, playerIds: [] as string[] }));
  for (const id of shuffled(shuffled(ids, random), random)) {
    flights[joiningFlight(flights, random)]!.playerIds.push(id);
  }
  return flights;
}

export function addToFlight(pod: Pod, id: string, random: Random, recorded?: readonly Flight[]): Pod {
  const flights = pod.flights ?? [{ number: 1, playerIds: pod.playerIds }];
  const index = recorded?.findIndex(f => f.playerIds.includes(id)) ?? joiningFlight(flights, random);
  if (index < 0 || !flights[index]) {
    throw new Error('The recorded late entrant has no flight');
  }
  const next = flights.map((f, i) => (i === index ? { ...f, playerIds: [...f.playerIds, id] } : f));
  return { ...pod, flights: next, playerIds: next.flatMap(f => f.playerIds) };
}
