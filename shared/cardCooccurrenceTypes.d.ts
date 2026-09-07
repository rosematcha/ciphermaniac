export interface CardRef {
  cardId: string;
  name: string;
  set?: string;
  number?: string | number;
  category?: string;
}

export interface CardPresence {
  ref: CardRef;
  deckIds: Set<string>;
  count: number;
}

export interface CooccurrenceContext {
  totalDecks: number;
  presence: Map<string, CardPresence>;
}
