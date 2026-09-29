/**
 * The top cut the home page draws, played out from the site's own data: the
 * current meta's top eight decks seeded 1–8 by share, each match going to the
 * deck its matchup record favours. Pure, so the picture is testable and never
 * invented: change the data and the bracket follows.
 */

/** A deck's win rate against another, 0–100, or null when the data has no record of the pair. */
export type WinRate = (deck: string, opponent: string) => number | null;

export interface MetaBracket {
  /** Seeded 1v8, 4v5, 2v7, 3v6, top to bottom as a bracket draws them. */
  quarterfinals: [string, string][];
  semifinals: [string, string][];
  final: [string, string];
  champion: string;
}

/**
 * The deck a match goes to: the one whose record against the other is better;
 * with no record either way (or a dead heat), the higher seed.
 */
export function favoured(higherSeed: string, lowerSeed: string, winRate: WinRate): string {
  const ahead = winRate(higherSeed, lowerSeed) ?? 50;
  const behind = winRate(lowerSeed, higherSeed) ?? 50;
  return behind > ahead ? lowerSeed : higherSeed;
}

const SEEDING: [number, number][] = [
  [1, 8],
  [4, 5],
  [2, 7],
  [3, 6]
];

/** The bracket from eight decks best-first; null with fewer than eight. */
export function playOutBracket(seeds: readonly string[], winRate: WinRate): MetaBracket | null {
  if (seeds.length < 8) {
    return null;
  }
  const seed = (n: number) => seeds[n - 1] as string;
  const quarterfinals = SEEDING.map(([a, b]) => [seed(a), seed(b)] as [string, string]);
  const won = quarterfinals.map(([a, b]) => favoured(a, b, winRate));
  const semifinals: [string, string][] = [
    [won[0] as string, won[1] as string],
    [won[2] as string, won[3] as string]
  ];
  const final: [string, string] = [
    favoured(semifinals[0][0], semifinals[0][1], winRate),
    favoured(semifinals[1][0], semifinals[1][1], winRate)
  ];
  return { quarterfinals, semifinals, final, champion: favoured(final[0], final[1], winRate) };
}
