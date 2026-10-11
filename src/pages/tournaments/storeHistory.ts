/** A count of players, e.g. "22 players". */
export function playersWord(count: number): string {
  return `${count} ${count === 1 ? 'player' : 'players'}`;
}

/** Ended events under their month, e.g. "October 2026", in the order given. */
export function byMonth<T extends { date: string }>(events: readonly T[]): { label: string; events: T[] }[] {
  const months: { key: string; label: string; events: T[] }[] = [];
  for (const event of events) {
    const key = event.date.slice(0, 7);
    const last = months.at(-1);
    if (last?.key === key) {
      last.events.push(event);
    } else {
      months.push({ key, label: monthLabel(key), events: [event] });
    }
  }
  return months.map(({ label, events: list }) => ({ label, events: list }));
}

function monthLabel(key: string): string {
  return new Date(`${key}-01T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  });
}
