const TOURNAMENT_DATE_PREFIX_RE = /^(\d{4}-\d{2}-\d{2}),\s+/;

export function extractTournamentDatePrefix(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const match = TOURNAMENT_DATE_PREFIX_RE.exec(trimmed);
  return match ? match[1] : null;
}

/**
 * Defensive client-side ordering:
 * - Date-prefixed tournaments first, newest to oldest
 * - Undated entries after dated entries, sorted by name
 */
export function sortTournamentNamesByRecency(tournaments: string[]): string[] {
  if (!Array.isArray(tournaments) || tournaments.length === 0) {
    return [];
  }

  const decorated = tournaments.map((name, index) => ({
    name,
    datePrefix: extractTournamentDatePrefix(name),
    index
  }));

  decorated.sort((left, right) => {
    const leftHasDate = Boolean(left.datePrefix);
    const rightHasDate = Boolean(right.datePrefix);

    if (leftHasDate !== rightHasDate) {
      return leftHasDate ? -1 : 1;
    }

    if (left.datePrefix && right.datePrefix && left.datePrefix !== right.datePrefix) {
      return right.datePrefix.localeCompare(left.datePrefix);
    }

    const byName = left.name.localeCompare(right.name);
    if (byName !== 0) {
      return byName;
    }

    return left.index - right.index;
  });

  return decorated.map(entry => entry.name);
}
