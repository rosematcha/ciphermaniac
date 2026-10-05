/**
 * Stores on Ciphermaniac over what Pokedata lists (./stores): a store that
 * runs its events on the site says its own league nights, so the locals
 * Pokedata lists for its league give way to them. A night does not run on a
 * date the store marked off or moved, nor on a date its league holds a
 * League Cup or League Challenge. Every event of such a league carries the
 * store's id, for the page to mark it.
 *
 * Pure: the page passes in what it loaded.
 * @module shared/events/storeNights
 */

import type { LeagueNight, NightException } from '../accounts/stores';
import { addDays, weekdayOf } from './locals';
import type { LocatorStore, StoresIndex } from './stores';
import type { LocatorEvent } from './types';

/** The kinds a league night yields its date to. */
const YIELDS_TO = new Set(['cup', 'challenge']);

/** How the night runs on `date`: at its own time, at another, or not at all (null). */
function timeOn(night: LeagueNight, date: string, exceptions: readonly NightException[]): string | null {
  const exception =
    exceptions.find(item => item.date === date && item.nightId === night.id) ??
    exceptions.find(item => item.date === date && item.nightId === null);
  if (!exception) {
    return night.time;
  }
  return exception.time;
}

function nightEvent(store: LocatorStore, night: LeagueNight, date: string, time: string): LocatorEvent | null {
  if (store.lat === null || store.lon === null) {
    return null;
  }
  return {
    id: `${store.leagueId}-${date}-${time.replace(':', '')}-${night.id}`,
    leagueId: store.leagueId,
    storeId: store.id,
    kind: 'local',
    name: night.name || store.name,
    date,
    time,
    shop: store.name,
    address: store.address,
    city: store.city,
    region: store.region,
    cc: store.cc,
    lat: store.lat,
    lon: store.lon,
    ...(night.fee ? { fee: night.fee } : {})
  };
}

/** Each of the store's nights from `today` through `horizon`, as dated locals. */
function storeLocals(store: LocatorStore, busy: ReadonlySet<string>, today: string, horizon: string): LocatorEvent[] {
  const events: LocatorEvent[] = [];
  for (let date = today; date <= horizon; date = addDays(date, 1)) {
    if (busy.has(`${store.leagueId} ${date}`)) {
      continue;
    }
    for (const night of store.nights.filter(item => item.weekday === weekdayOf(date))) {
      const time = timeOn(night, date, store.exceptions);
      const event = time === null ? null : nightEvent(store, night, date, time);
      if (event) {
        events.push(event);
      }
    }
  }
  return events;
}

/**
 * The listings with every Ciphermaniac store's own league nights in place of
 * the locals Pokedata lists for its league, and each of its league's events
 * marked with its id.
 * @param listed - The sanctioned listings loaded (Cups, Challenges, Prereleases)
 * @param locals - The locals loaded, or none while they are off
 * @param stores - The stores index, or null when none is published
 * @param range - The visitor's date and the last date locals are shown through
 * @param range.today - YYYY-MM-DD
 * @param range.horizon - YYYY-MM-DD
 */
export function withStoreNights(
  listed: readonly LocatorEvent[],
  locals: readonly LocatorEvent[] | null,
  stores: StoresIndex | null,
  range: { today: string; horizon: string }
): { listed: LocatorEvent[]; locals: LocatorEvent[] } {
  // A store with no place on the map shows no nights, so it leaves Pokedata's locals for its league standing.
  const placed = (stores?.stores ?? []).filter(store => store.lat !== null && store.lon !== null);
  const byLeague = new Map(placed.map(store => [store.leagueId, store]));
  const mark = (event: LocatorEvent): LocatorEvent => {
    const store = event.leagueId ? byLeague.get(event.leagueId) : undefined;
    return store ? { ...event, storeId: store.id } : event;
  };
  const markedListed = listed.map(mark);
  if (!locals) {
    return { listed: markedListed, locals: [] };
  }
  const busy = new Set(
    markedListed
      .filter(event => event.storeId && YIELDS_TO.has(event.kind))
      .map(event => `${event.leagueId} ${event.date}`)
  );
  const others = locals.filter(event => !(event.leagueId && byLeague.has(event.leagueId)));
  const own = [...byLeague.values()].flatMap(store => storeLocals(store, busy, range.today, range.horizon));
  return { listed: markedListed, locals: [...others, ...own] };
}
