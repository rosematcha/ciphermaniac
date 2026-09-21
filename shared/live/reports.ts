/**
 * Crowd-sourced deck reports for a live event. Lists are not public until an
 * event ends, so viewers say what a player is on; an archetype is shown for a
 * seat once more than half of that seat's reports agree on it, which a single
 * report does. Archetypes are picked from the site's own lists, never typed:
 * the online meta's index, and the archetype icon map, which is far longer and
 * names the decks a regional sees that the online meta does not.
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
  /** Archetype display label, e.g. `Rocket's Honchkrow`; null takes this device's report back. */
  archetype: string | null;
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
  // Membership in the site's lists is the real check; this only keeps junk out early.
  archetype: /^[^<>"\n]{1,60}$/,
  voter: /^[0-9a-f-]{16,40}$/
};

/** The report in a request body, or null for anything that is not one. */
function parseDeckReport(body: unknown): DeckReport | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }
  const fields = body as Record<string, unknown>;
  const report: Record<string, string | null> = {};
  for (const [field, pattern] of Object.entries(FIELD_PATTERNS)) {
    const value = fields[field];
    const retraction = field === 'archetype' && value === null;
    if (!retraction && (typeof value !== 'string' || !pattern.test(value))) {
      return null;
    }
    report[field] = retraction ? null : (value as string);
  }
  return report as unknown as DeckReport;
}

/**
 * Reports one request may carry. A run is swiss plus a cut and the player's own
 * deck; well past that is not a run being filled in.
 */
export const MAX_REPORTS_PER_REQUEST = 24;

function batchedReports(body: unknown): unknown[] | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }
  const { reports } = body as { reports?: unknown };
  return Array.isArray(reports) ? reports : null;
}

/**
 * The reports in a request body: one on its own, or a batch under `reports`,
 * which is how a whole run is filled in at once. A batch is one device's word
 * on one event, so every report in it carries the same slug and voter and names
 * a seat once; anything else is refused whole rather than half applied.
 */
export function parseDeckReports(body: unknown): DeckReport[] | null {
  const raw = batchedReports(body) ?? [body];
  if (raw.length === 0 || raw.length > MAX_REPORTS_PER_REQUEST) {
    return null;
  }
  const reports: DeckReport[] = [];
  const seats = new Set<string>();
  for (const entry of raw) {
    const report = parseDeckReport(entry);
    if (!report || seats.has(report.seat) || !sameSender(report, reports[0])) {
      return null;
    }
    seats.add(report.seat);
    reports.push(report);
  }
  return reports;
}

function sameSender(report: DeckReport, first: DeckReport | undefined): boolean {
  return !first || (report.slug === first.slug && report.voter === first.voter);
}

/** The archetype more than half the reports name, if any. */
export function leadingArchetype(tallies: readonly ArchetypeTally[]): string | null {
  const total = tallies.reduce((sum, tally) => sum + tally.votes, 0);
  return tallies.find(tally => tally.votes * 2 > total)?.archetype ?? null;
}

/** Labels a report may name: the online index's, then the rest of the icon map's, without repeats. */
export function reportableArchetypes(indexLabels: readonly string[], iconMapLabels: readonly string[]): string[] {
  const seen = new Set<string>();
  return [...indexLabels, ...[...iconMapLabels].sort((a, b) => a.localeCompare(b))].filter(label => {
    const key = label.toLowerCase();
    return !seen.has(key) && Boolean(seen.add(key));
  });
}
