/**
 * Play! Pokémon's recommended structure for an event: how many Swiss rounds
 * and how big a top cut its attendance calls for. Its own module, since the
 * console's settings ask for it without the rest of what the pages derive.
 */

/** The recommended Swiss rounds and top cut for a division's attendance (Handbook §5.5.6.1, League Cup). */
export function recommendedStructure(players: number): { rounds: number; cut: number } {
  const table: [number, number, number][] = [
    [8, 3, 0],
    [12, 4, 4],
    [20, 5, 4],
    [32, 5, 8],
    [64, 6, 8],
    [128, 7, 8],
    [226, 8, 8],
    [409, 9, 8]
  ];
  const row = table.find(([max]) => players <= max);
  return row ? { rounds: row[1], cut: row[2] } : { rounds: 10, cut: 8 };
}
