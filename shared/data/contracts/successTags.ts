export interface PlacementTagRule {
  tag: string;
  maxPlacing: number;
  minPlayers: number;
}

export interface PercentTagRule {
  tag: string;
  fraction: number;
  minPlayers: number;
}

export interface SuccessTagPolicy {
  version: number;
  placementRules: PlacementTagRule[];
  percentRules: PercentTagRule[];
}

export const SUCCESS_TAG_POLICY: SuccessTagPolicy = {
  version: 1,
  placementRules: [
    { tag: 'winner', maxPlacing: 1, minPlayers: 2 },
    { tag: 'top2', maxPlacing: 2, minPlayers: 4 },
    { tag: 'top4', maxPlacing: 4, minPlayers: 8 },
    { tag: 'top8', maxPlacing: 8, minPlayers: 16 },
    { tag: 'top16', maxPlacing: 16, minPlayers: 32 }
  ],
  percentRules: [
    { tag: 'top10', fraction: 0.1, minPlayers: 20 },
    { tag: 'top25', fraction: 0.25, minPlayers: 12 },
    { tag: 'top50', fraction: 0.5, minPlayers: 8 }
  ]
};

function placementTags(place: number, field: number, policy: SuccessTagPolicy): string[] {
  return policy.placementRules
    .filter(rule => field >= rule.minPlayers && place <= rule.maxPlacing)
    .map(rule => rule.tag);
}

function percentTags(place: number, field: number, policy: SuccessTagPolicy): string[] {
  return policy.percentRules
    .filter(rule => field >= rule.minPlayers && place <= Math.max(1, Math.ceil(field * rule.fraction)))
    .map(rule => rule.tag);
}

function phaseTags(options: { madePhase2?: boolean; madeTopCut?: boolean; appendPhaseTags?: boolean }): string[] {
  if (!options.appendPhaseTags) {
    return [];
  }
  return [options.madePhase2 ? 'phase2' : null, options.madeTopCut ? 'topcut' : null].filter(
    (tag): tag is string => tag !== null
  );
}

export function computeSuccessTags(
  placement: number | null | undefined,
  fieldSize: number | null | undefined,
  options: { madePhase2?: boolean; madeTopCut?: boolean; appendPhaseTags?: boolean } = {},
  policy: SuccessTagPolicy = SUCCESS_TAG_POLICY
): string[] {
  const place = Number.isFinite(placement) ? Number(placement) : null;
  const field = Number.isFinite(fieldSize) ? Number(fieldSize) : null;
  const rankingTags =
    place !== null && field !== null && place > 0 && field > 1
      ? [...placementTags(place, field, policy), ...percentTags(place, field, policy)]
      : [];
  return [...rankingTags, ...phaseTags(options)];
}

export const SUCCESS_TAG_NAMES = ['winner', 'top2', 'top4', 'top8', 'top16', 'top10', 'top25', 'top50'] as const;
