/** An archetype a report can name, by label, with the index's own icons when it has an entry there. */
export interface ReportedDeck {
  label: string;
  icons?: string[];
  /** Share of the online meta, 0 to 100, for the decks that have one. */
  percent?: number | null;
  /**
   * Whether anyone is on this deck now: it is in the online meta, or someone
   * at this event has been reported on it. The rest of the icon map is every
   * archetype of the last two years, so without this the box offers a decade
   * of dead decks on the same footing as the twelve in the room.
   */
  played?: boolean;
  /** Typed in by hand: a name the list did not have. */
  custom?: boolean;
  /** Two Pokémon put together in the box: the label the pair is saved under, which may run in the other order. */
  pair?: string;
}
