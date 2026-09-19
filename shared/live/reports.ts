/**
 * Crowd-sourced deck reports for a live event. Lists are not public until an
 * event ends, so viewers say what a player is on; an archetype is shown for a
 * seat once more than half of that seat's reports agree on it, which a single
 * report does. Archetypes are picked from the site's own index, never typed.
 * @module shared/live/reports
 */

/** `live/v1/{slug}/reports.json`: the archetype shown for each seat key. */
export interface LiveReports {
  updatedAt: string;
  decks: Record<string, string>;
}

export interface DeckReport {
  slug: string;
  /** Seat key, `foldedname|CC` (`shared/live/view.ts`). */
  seat: string;
  /** Archetype index `name`. */
  archetype: string;
  /** Random ID minted on the reporter's device; nothing about the person. */
  voter: string;
}

export interface ArchetypeTally {
  archetype: string;
  votes: number;
}

export const liveReportsKey = (slug: string): string => `live/v1/${slug}/reports.json`;

const FIELD_PATTERNS: Record<keyof DeckReport, RegExp> = {
  slug: /^[a-z0-9-]{3,40}$/,
  seat: /^[^|\n]{1,80}\|[A-Z]{0,3}$/,
  // Index names are slugs, but not plain ones: `Rocket's_Honchkrow`. Membership
  // in the index is the real check; this only keeps the junk out early.
  archetype: /^[^\s<>"]{1,60}$/,
  voter: /^[0-9a-f-]{16,40}$/
};

/** The report in a request body, or null for anything that is not one. */
export function parseDeckReport(body: unknown): DeckReport | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }
  const fields = body as Record<string, unknown>;
  const report = {} as DeckReport;
  for (const [field, pattern] of Object.entries(FIELD_PATTERNS) as [keyof DeckReport, RegExp][]) {
    const value = fields[field];
    if (typeof value !== 'string' || !pattern.test(value)) {
      return null;
    }
    report[field] = value;
  }
  return report;
}

/** The archetype more than half the reports name, if any. */
export function leadingArchetype(tallies: readonly ArchetypeTally[]): string | null {
  const total = tallies.reduce((sum, tally) => sum + tally.votes, 0);
  return tallies.find(tally => tally.votes * 2 > total)?.archetype ?? null;
}
