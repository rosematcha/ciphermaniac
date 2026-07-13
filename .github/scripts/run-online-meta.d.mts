// Ambient types for the ESM online-meta producer. Only the success-tag exports
// consumed by tests/data/online-meta-success-tags-parity.test.ts are declared;
// the rest of the script is orchestration that is not imported anywhere.

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
