// Ambient types for the ESM online-meta producer. Only the exports consumed by
// parity tests are declared (success tags for
// tests/data/online-meta-success-tags-parity.test.ts; buildCardUsageIndex for
// tests/data/card-usage-conversion-parity.test.ts); the rest of the script is
// orchestration that is not imported anywhere.

export declare const PLACEMENT_TAG_RULES: Array<{
  tag: string;
  maxPlacing: number;
  minPlayers: number;
}>;

export declare const PERCENT_TAG_RULES: Array<{
  tag: string;
  fraction: number;
  minPlayers: number;
}>;

export declare function determinePlacementTags(
  placing: number | null | undefined,
  players: number | null | undefined
): string[];

/** One per-archetype card report fed to {@link buildCardUsageIndex}. */
export interface ArchetypeUsageFile {
  base: string;
  data?: {
    items?: ReadonlyArray<{
      uid?: string;
      name?: string;
      found?: number;
      pct?: number;
      dist?: ReadonlyArray<{ copies: number; players: number; percent: number }> | null;
    }> | null;
  } | null;
}

/** The legacy `cardUsage.json` payload this producer publishes. */
export interface LegacyCardUsageIndex {
  usage: Record<
    string,
    Array<{ slug: string; found: number; pct: number; dist: Array<{ copies: number; players: number; percent: number }> }>
  >;
}

export declare function buildCardUsageIndex(archetypeFiles: readonly ArchetypeUsageFile[]): LegacyCardUsageIndex;

// --- Archetype presentation/build exports (DB-MASTER-PLAN Phase 2, slice 5;
// consumed by tests/data/archetype-presentation-parity.test.ts). Deliberately
// loose: the .mjs is untyped JS and the parity tests cast at the boundary.

export declare function buildCardMetaLookup(
  cardTypesDb: unknown
): Map<string, { abilities: string[]; attacks: string[] }>;

export declare function resolveArchetypeThumbnails(
  baseName: string,
  displayName: string,
  reportData: unknown,
  cardMetaLookup?: Map<string, { abilities: string[]; attacks: string[] }> | null,
  metaUsage?: Map<string, number> | null
): string[];

export declare function generateSignatureCards(
  displayName: string,
  archetypeReport: unknown,
  masterReport: unknown,
  thumbnails: string[]
): Array<{ name: string; set: string | null; number: string | number | null; pct: number }>;

export declare function buildArchetypeReports(
  decks: unknown[],
  synonymDb: unknown,
  masterReport?: unknown,
  cardTypesDb?: unknown
): {
  minDecks: number;
  files: Array<{ filename: string; base: string; displayName: string; deckCount: number; data: unknown }>;
  index: Array<Record<string, unknown>>;
  decksByArchetype: Map<string, unknown[]>;
};
