// Selects the archetype to display for an event given candidate stats per archetype.
// Inputs:
// - candidates: Array of { base: string, pct?: number|null, found?: number|null, total?: number|null }
//   where:
//   - pct = percent of decks in the archetype that played the card (any copies)
//   - found = number of decks in the archetype that played the card
//   - total = total decks in the archetype for the event
// - top8Bases: Optional array of base strings that made Top 8
// Output: The chosen candidate object or null if none

export interface ArchetypeCandidate {
  base: string;
  pct?: number | null;
  found?: number | null;
  total?: number | null;
}

export interface PickArchetypeOptions {
  minTotal?: number;
}

/**
 * Pick the best archetype from candidates
 * @param candidates
 * @param top8Bases
 * @param opts
 */
export function pickArchetype(
  candidates: ArchetypeCandidate[],
  top8Bases?: string[] | null,
  opts?: PickArchetypeOptions
): ArchetypeCandidate | null {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }
  const valid = candidates.filter(candidate => candidate && typeof candidate.base === 'string');
  if (valid.length === 0) {
    return null;
  }
  const minTotal = Math.max(0, Number(opts?.minTotal) || 3); // minimum decks in archetype to consider by default
  // Score primarily by number of decks that played the card (found),
  // falling back to pct when found is unknown or ties; this favors larger samples.
  const score = (candidate: ArchetypeCandidate) => {
    if (Number.isFinite(candidate?.found)) {
      return candidate.found!;
    }
    // Approximate from pct*total when available; else 0
    if (Number.isFinite(candidate?.pct) && Number.isFinite(candidate?.total)) {
      return Math.round((candidate.pct! * candidate.total!) / 100);
    }
    return 0;
  };
  const byFoundThenPctDesc = (first: ArchetypeCandidate, second: ArchetypeCandidate) =>
    score(second) - score(first) || (second.pct ?? -1) - (first.pct ?? -1) || first.base.localeCompare(second.base);
  const poolFromTop8 = (() => {
    if (Array.isArray(top8Bases) && top8Bases.length) {
      const set = new Set(top8Bases);
      const sub = valid.filter(candidate => set.has(candidate.base));
      if (sub.length) {
        return sub;
      }
    }
    return valid;
  })();

  // Apply minTotal threshold; if all filtered out, fall back to original pool
  const filtered = poolFromTop8.filter(candidate => {
    const total = Number.isFinite(candidate.total) ? candidate.total! : 0;
    return total >= minTotal;
  });
  const pool = filtered.length ? filtered : poolFromTop8;
  return pool.sort(byFoundThenPctDesc)[0];
}

/**
 * Convert base string to label
 * @param base
 */
export function baseToLabel(base: string | null | undefined): string {
  return String(base || '').replace(/_/g, ' ');
}
