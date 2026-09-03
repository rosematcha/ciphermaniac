/**
 * Hand-maintained exclusions for the online tournament windows.
 *
 * Limitless reports a restricted-format event ("NO Dragapult Tournament!",
 * "Oops! ALL DRAGAPULT", "Trainer Pokemon Only") as plain STANDARD, so the
 * format filter alone lets gimmick fields into the meta and its matchups. The
 * config lives at `config/online-exclusions.json`; runners import it and pass
 * it through `FetchTournamentsOptions.exclusions`. Every exclusion is recorded
 * on the diagnostics collector and in the published meta so it is auditable
 * rather than a silent hole in the field.
 *
 * Isomorphic: no I/O, no environment-specific dependencies.
 * @module shared/onlineMeta/exclusions
 */

export interface OnlineExclusionConfig {
  /** Limitless organizer ids whose events are always excluded. */
  organizerIds?: string[];
  /** Organizer display names (case-insensitive exact match). */
  organizerNames?: string[];
  /** Case-insensitive regular expressions tested against the event name. */
  namePatterns?: string[];
}

export interface ExclusionMatch {
  reason: 'organizer-id' | 'organizer-name' | 'name-pattern';
  /** The id, name, or pattern source that matched. */
  matched: string;
}

interface ExcludableTournament {
  name?: string | null;
  organizer?: string | null;
  organizerId?: string | null;
}

/** Compiled form of {@link OnlineExclusionConfig}; build once per run. */
export interface CompiledExclusions {
  organizerIds: Set<string>;
  organizerNames: Set<string>;
  namePatterns: Array<{ source: string; regex: RegExp }>;
}

const EMPTY: CompiledExclusions = { organizerIds: new Set(), organizerNames: new Set(), namePatterns: [] };

function normalizeName(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Compile a config into sets and regexes. Invalid patterns throw so a typo in
 * the config fails the run instead of silently matching nothing.
 * @param config - The parsed config, or null for no exclusions
 * @returns Compiled exclusions
 */
export function compileExclusions(config: OnlineExclusionConfig | null | undefined): CompiledExclusions {
  if (!config) {
    return EMPTY;
  }
  return {
    organizerIds: new Set((config.organizerIds ?? []).map(id => id.trim()).filter(Boolean)),
    organizerNames: new Set((config.organizerNames ?? []).map(normalizeName).filter(Boolean)),
    namePatterns: (config.namePatterns ?? []).map(source => ({ source, regex: new RegExp(source, 'iu') }))
  };
}

/**
 * Why a tournament is excluded, or null when it is not.
 * @param tournament - Name and organizer of the event
 * @param exclusions - Compiled exclusions
 * @returns The first matching rule, or null
 */
export function matchExclusion(
  tournament: ExcludableTournament,
  exclusions: CompiledExclusions | null | undefined
): ExclusionMatch | null {
  if (!exclusions) {
    return null;
  }
  const organizerId = tournament.organizerId?.trim();
  if (organizerId && exclusions.organizerIds.has(organizerId)) {
    return { reason: 'organizer-id', matched: organizerId };
  }
  const organizer = normalizeName(tournament.organizer);
  if (organizer && exclusions.organizerNames.has(organizer)) {
    return { reason: 'organizer-name', matched: organizer };
  }
  const name = String(tournament.name ?? '');
  const pattern = exclusions.namePatterns.find(entry => entry.regex.test(name));
  return pattern ? { reason: 'name-pattern', matched: pattern.source } : null;
}
