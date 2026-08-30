/**
 * Manual player identity corrections applied during aggregation.
 *
 * Two things upstream data cannot express on its own:
 *   - a player holding more than one Limitless `playerId` (a second account,
 *     a re-registration), which the aggregator would otherwise publish as two
 *     unrelated careers;
 *   - the name a player wants shown, when the most recent registration is not
 *     it. `pickPrimaryName` takes the latest observed name, which is the right
 *     default and the wrong answer whenever the newer registration carries a
 *     name the player no longer uses.
 *
 * Entries are keyed by canonical `playerId`. `aliasIds` fold into it (their
 * events, decks and profile all move under the canonical id); `displayName`
 * overrides the observed name outright. Old names are never published — the
 * profile carries the display name only.
 * @module shared/onlineMeta/playerIdentity
 */

export interface PlayerIdentityOverride {
  /** Limitless `playerId` that owns the merged career. */
  canonicalId: string;
  /** Other ids belonging to the same player; folded into `canonicalId`. */
  aliasIds?: readonly string[];
  /** Name to publish, regardless of what the latest registration says. */
  displayName?: string;
}

/**
 * The corrections themselves. Keep this list short and sourced — each entry is
 * a claim about a real person that the data cannot verify.
 */
export const PLAYER_IDENTITY_OVERRIDES: readonly PlayerIdentityOverride[] = [
  // Two Limitless accounts, one player; Caitlin is the name she goes by, and
  // the busier account (16920) registers under the other one.
  { canonicalId: '9397', aliasIds: ['16920'], displayName: 'Caitlin White' },
  // Re-registered under a new account (45677) from Houston 2026 onward; the
  // older account (17712) holds her events through NAIC 2025.
  { canonicalId: '45677', aliasIds: ['17712'], displayName: 'Reese Lundquist' }
];

const CANONICAL_BY_ALIAS = new Map<string, string>();
const DISPLAY_NAME_BY_CANONICAL = new Map<string, string>();

for (const override of PLAYER_IDENTITY_OVERRIDES) {
  for (const alias of override.aliasIds ?? []) {
    CANONICAL_BY_ALIAS.set(alias, override.canonicalId);
  }
  if (override.displayName) {
    DISPLAY_NAME_BY_CANONICAL.set(override.canonicalId, override.displayName);
  }
}

/**
 * Resolve a raw Limitless player id to the id its career is published under.
 * @param playerId - Raw id from a participant row
 * @returns The canonical id, or `playerId` unchanged when it is not an alias
 */
export function canonicalPlayerId(playerId: string): string {
  return CANONICAL_BY_ALIAS.get(playerId) ?? playerId;
}

/**
 * The name to publish for a canonical player id, when one is pinned.
 * @param canonicalId - Canonical player id
 * @returns The override name, or null to use the observed name
 */
export function overriddenPlayerName(canonicalId: string): string | null {
  return DISPLAY_NAME_BY_CANONICAL.get(canonicalId) ?? null;
}
