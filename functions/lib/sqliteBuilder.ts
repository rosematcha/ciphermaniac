/**
 * SQLite Database Builder for Ciphermaniac
 *
 * Generates SQLite databases from deck data using sql.js (SQLite to WASM).
 * Schema matches frontend TournamentDatabase (src/lib/database.ts).
 * @module functions/lib/sqliteBuilder
 */

import initSqlJs, { Database, Statement } from 'sql.js';
import { calculatePercentage, composeCategoryPath, createDistributionFromCounts } from '../../shared/reportUtils.js';
import { canonicalizeVariant, sanitizeForPath } from './cardUtils.js';
import { getCanonicalCard } from './cardSynonyms.js';
import { SynonymDatabase } from '../../shared/synonyms.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface DeckCard {
  name?: string;
  set?: string;
  number?: string | number;
  count?: number;
  category?: string;
  trainerType?: string;
  energyType?: string;
  aceSpec?: boolean;
  regulationMark?: string;
}

export interface Deck {
  id?: string;
  player?: string;
  playerId?: string;
  country?: string;
  placement?: number;
  archetype?: string;
  archetypeId?: string;
  cards?: DeckCard[];
}

export interface BuildOptions {
  synonymDb?: SynonymDatabase | null;
  tournamentId?: string;
  generatedAt?: string;
}

interface CardDataEntry {
  name: string;
  set: string | null;
  number: string | null;
  category: string | null;
  trainerType: string | null;
  energyType: string | null;
  aceSpec: boolean;
  countsList: number[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────────────────────

const SCHEMA = `
  CREATE TABLE decks (
    id TEXT PRIMARY KEY,
    player TEXT,
    player_id TEXT,
    country TEXT,
    placement INTEGER,
    archetype TEXT,
    archetype_id TEXT,
    tournament_id TEXT
  );

  CREATE TABLE deck_cards (
    deck_id TEXT NOT NULL,
    card_uid TEXT NOT NULL,
    card_name TEXT NOT NULL,
    card_set TEXT,
    card_number TEXT,
    count INTEGER NOT NULL,
    category TEXT,
    trainer_type TEXT,
    energy_type TEXT,
    ace_spec INTEGER DEFAULT 0,
    regulation_mark TEXT,
    FOREIGN KEY (deck_id) REFERENCES decks(id)
  );

  CREATE TABLE card_stats (
    card_uid TEXT PRIMARY KEY,
    card_name TEXT NOT NULL,
    card_set TEXT,
    card_number TEXT,
    category TEXT,
    trainer_type TEXT,
    energy_type TEXT,
    ace_spec INTEGER DEFAULT 0,
    rank INTEGER NOT NULL,
    found INTEGER NOT NULL,
    total INTEGER NOT NULL,
    pct REAL NOT NULL
  );

  CREATE TABLE card_distributions (
    card_uid TEXT NOT NULL,
    copies INTEGER NOT NULL,
    players INTEGER NOT NULL,
    percent REAL NOT NULL,
    FOREIGN KEY (card_uid) REFERENCES card_stats(card_uid)
  );

  CREATE TABLE success_tags (
    deck_id TEXT NOT NULL,
    tag TEXT NOT NULL,
    FOREIGN KEY (deck_id) REFERENCES decks(id)
  );

  CREATE TABLE db_metadata (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE INDEX idx_decks_archetype ON decks(archetype);
  CREATE INDEX idx_decks_placement ON decks(placement);
  CREATE INDEX idx_deck_cards_deck_id ON deck_cards(deck_id);
  CREATE INDEX idx_deck_cards_card_uid ON deck_cards(card_uid);
  CREATE INDEX idx_card_distributions_uid ON card_distributions(card_uid);
  CREATE INDEX idx_success_tags_deck_id ON success_tags(deck_id);
  CREATE INDEX idx_success_tags_tag ON success_tags(tag);
`;

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

function getSuccessTags(placement: number, totalDecks: number): string[] {
  const tags: string[] = [];
  if (placement === 1) {
    tags.push('winner');
  }
  if (placement <= 2) {
    tags.push('finalist');
  }
  if (placement <= 4) {
    tags.push('top4');
  }
  if (placement <= 8) {
    tags.push('top8');
  }
  if (placement <= 16) {
    tags.push('top16');
  }
  if (placement <= 32) {
    tags.push('top32');
  }
  if (placement <= 64) {
    tags.push('top64');
  }
  if (placement <= Math.ceil(totalDecks * 0.1)) {
    tags.push('top10pct');
  }
  if (placement <= Math.ceil(totalDecks * 0.25)) {
    tags.push('top25pct');
  }
  return tags;
}

function buildCardUid(card: DeckCard, synonymDb: SynonymDatabase | null): string {
  const name = card?.name || 'Unknown Card';
  const [canonSet, canonNumber] = canonicalizeVariant(card?.set, card?.number);
  let uid = canonSet && canonNumber ? `${name}::${canonSet}::${canonNumber}` : name;

  if (synonymDb) {
    uid = getCanonicalCard(synonymDb, uid);
  }

  return uid;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a SQLite database from deck data.
 * @param decks - Array of deck objects from decks.json
 * @param options - Build options
 * @returns Promise<Uint8Array> - SQLite database as binary data
 */
export async function buildTournamentDatabase(decks: Deck[], options: BuildOptions = {}): Promise<Uint8Array> {
  const { synonymDb = null, tournamentId = 'unknown', generatedAt = new Date().toISOString() } = options;

  const SQL = await initSqlJs();
  const db: Database = new SQL.Database();

  db.run(SCHEMA);

  const insertDeck: Statement = db.prepare(`
    INSERT INTO decks (id, player, player_id, country, placement, archetype, archetype_id, tournament_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertCard: Statement = db.prepare(`
    INSERT INTO deck_cards (deck_id, card_uid, card_name, card_set, card_number, count, category, trainer_type, energy_type, ace_spec, regulation_mark)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertTag: Statement = db.prepare(`
    INSERT INTO success_tags (deck_id, tag)
    VALUES (?, ?)
  `);

  const cardData = new Map<string, CardDataEntry>();
  const seenDeckIds = new Set<string>();
  const totalDecks = decks.length;

  db.run('BEGIN TRANSACTION');

  for (let i = 0; i < decks.length; i++) {
    const deck = decks[i];
    let deckId = deck.id || `deck-${i}`;
    if (seenDeckIds.has(deckId)) {
      deckId = `${deckId}-${i}`;
    }
    seenDeckIds.add(deckId);

    insertDeck.run([
      deckId,
      deck.player || null,
      deck.playerId || null,
      deck.country || null,
      deck.placement || null,
      deck.archetype || null,
      deck.archetypeId || null,
      tournamentId
    ]);

    const tags = getSuccessTags(deck.placement || Infinity, totalDecks);
    for (const tag of tags) {
      insertTag.run([deckId, tag]);
    }

    const perDeckCounts = new Map<string, number>();
    const cards: DeckCard[] = Array.isArray(deck.cards) ? deck.cards : [];

    for (const card of cards) {
      const count = Number(card?.count) || 0;
      if (!count) {
        continue;
      }

      const uid = buildCardUid(card, synonymDb);
      const safeName = sanitizeForPath(card?.name || 'Unknown Card');
      const [canonSet, canonNumber] = canonicalizeVariant(card?.set, card?.number);

      const category = card?.category || null;
      const trainerType = card?.trainerType || null;
      const energyType = card?.energyType || null;
      const aceSpec = card?.aceSpec ? 1 : 0;
      const regulationMark = card?.regulationMark || null;

      insertCard.run([
        deckId,
        uid,
        safeName,
        canonSet || null,
        canonNumber || null,
        count,
        category,
        trainerType,
        energyType,
        aceSpec,
        regulationMark
      ]);

      perDeckCounts.set(uid, (perDeckCounts.get(uid) || 0) + count);

      if (!cardData.has(uid)) {
        cardData.set(uid, {
          name: safeName,
          set: canonSet || null,
          number: canonNumber || null,
          category,
          trainerType,
          energyType,
          aceSpec: Boolean(card?.aceSpec),
          countsList: []
        });
      }
    }

    for (const [uid, count] of perDeckCounts) {
      cardData.get(uid)!.countsList.push(count);
    }
  }

  insertDeck.free();
  insertCard.free();
  insertTag.free();

  const insertStat: Statement = db.prepare(`
    INSERT INTO card_stats (card_uid, card_name, card_set, card_number, category, trainer_type, energy_type, ace_spec, rank, found, total, pct)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertDist: Statement = db.prepare(`
    INSERT INTO card_distributions (card_uid, copies, players, percent)
    VALUES (?, ?, ?, ?)
  `);

  const sortedCards = Array.from(cardData.entries()).sort((a, b) => b[1].countsList.length - a[1].countsList.length);

  let rank = 1;
  for (const [uid, data] of sortedCards) {
    const found = data.countsList.length;
    const pct = calculatePercentage(found, totalDecks);

    let categoryPath: string | null = null;
    if (data.category || data.trainerType || data.energyType || data.aceSpec) {
      categoryPath =
        composeCategoryPath(data.category, data.trainerType, data.energyType, { aceSpec: data.aceSpec }) ||
        data.category;
    }

    insertStat.run([
      uid,
      data.name,
      data.set,
      data.number,
      categoryPath,
      data.trainerType,
      data.energyType,
      data.aceSpec ? 1 : 0,
      rank,
      found,
      totalDecks,
      pct
    ]);

    const dist = createDistributionFromCounts(data.countsList, found);
    for (const d of dist) {
      insertDist.run([uid, d.copies, d.players, d.percent]);
    }

    rank++;
  }

  insertStat.free();
  insertDist.free();

  const insertMeta: Statement = db.prepare('INSERT INTO db_metadata (key, value) VALUES (?, ?)');
  insertMeta.run(['tournament_id', tournamentId]);
  insertMeta.run(['generated_at', generatedAt]);
  insertMeta.run(['total_decks', String(totalDecks)]);
  insertMeta.run(['total_cards', String(cardData.size)]);
  insertMeta.run(['schema_version', '1.0']);
  insertMeta.free();

  db.run('COMMIT');

  const data = db.export();
  db.close();

  return data;
}

/**
 * Build a SQLite database and return as Node.js Buffer.
 * @param decks - Array of deck objects
 * @param options - Build options
 * @returns Promise<Buffer> - SQLite database as Buffer
 */
export async function buildTournamentDatabaseBuffer(decks: Deck[], options: BuildOptions = {}): Promise<Buffer> {
  const data = await buildTournamentDatabase(decks, options);
  return Buffer.from(data);
}
