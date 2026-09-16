import type { LocatorEvent } from './types';

/** Registration and a tournament start commonly differ; unnamed weekly records can describe either. */
const SESSION_MINUTES = 120;

function minutes(time: string): number {
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  return hour * 60 + minute;
}

function shopKey(shop: string): string {
  return shop.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

function sameVenue(a: LocatorEvent, b: LocatorEvent): boolean {
  if (a.leagueId && b.leagueId) {
    return a.leagueId === b.leagueId;
  }
  // Older artifacts have no league ID. Names matter: two shops can share mall coordinates.
  return (
    Boolean(shopKey(a.shop)) &&
    shopKey(a.shop) === shopKey(b.shop) &&
    a.cc === b.cc &&
    Math.abs(a.lat - b.lat) < 0.001 &&
    Math.abs(a.lon - b.lon) < 0.001
  );
}

function overlaps(local: LocatorEvent, scheduled: LocatorEvent): boolean {
  const times = local.reportedTimes ?? (local.time ? [local.time] : []);
  if (!scheduled.time || times.length === 0) {
    return true;
  }
  return times.some(time => Math.abs(minutes(time) - minutes(scheduled.time)) <= SESSION_MINUTES);
}

/** Apply before kind filters: hiding a Challenge must not resurrect its displaced weekly session. */
export function withoutOverlappingLocals(events: readonly LocatorEvent[]): LocatorEvent[] {
  const scheduled = new Map<string, LocatorEvent[]>();
  for (const event of events) {
    if (event.kind !== 'local') {
      scheduled.set(event.date, [...(scheduled.get(event.date) ?? []), event]);
    }
  }
  return events.filter(
    event =>
      event.kind !== 'local' ||
      !(scheduled.get(event.date) ?? []).some(other => sameVenue(event, other) && overlaps(event, other))
  );
}
