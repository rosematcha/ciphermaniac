type SqlJsDatabase = {
  prepare(sql: string): SqlJsStatement;
  close(): void;
};

type SqlJsStatement = {
  bind(params?: unknown[]): boolean;
  step(): boolean;
  getAsObject(): Record<string, unknown>;
  free(): void;
};

type SqlJsStatic = {
  Database: new (data?: ArrayLike<number>) => SqlJsDatabase;
};

type InitSqlJsOptions = {
  locateFile?: (file: string) => string;
};

declare global {
  interface Window {
    initSqlJs?: (options?: InitSqlJsOptions) => Promise<SqlJsStatic>;
  }
}

interface CardFilter {
  cardUid: string;
  minCount?: number;
}

interface DeckFilters {
  archetype?: string;
  successTags?: string[];
  includeCards?: CardFilter[];
  excludeCards?: string[];
}

interface DeckRow {
  id: string;
  player?: string;
  player_id?: string;
  country?: string;
  placement?: number;
  archetype?: string;
  archetype_id?: string;
  tournament_id?: string;
}

interface CardStatRow {
  card_uid: string;
  card_name: string;
  card_set?: string;
  card_number?: string;
  category?: string;
  trainer_type?: string;
  energy_type?: string;
  ace_spec: number;
  rank: number;
  found: number;
  total: number;
  pct: number;
  dist?: { copies: number; players: number; percent: number }[];
}

let sqlPromise: Promise<SqlJsStatic> | null = null;

function loadSqlJsScript(): Promise<(options?: InitSqlJsOptions) => Promise<SqlJsStatic>> {
  return new Promise((resolve, reject) => {
    if (window.initSqlJs) {
      resolve(window.initSqlJs);
      return;
    }
    const script = document.createElement('script');
    script.src = '/assets/sql.js/sql-wasm.js';
    script.onload = () => resolve(window.initSqlJs!);
    script.onerror = () => reject(new Error('Failed to load sql.js'));
    document.head.appendChild(script);
  });
}

async function initSqlJs(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    sqlPromise = (async () => {
      const initFn = await loadSqlJsScript();
      return initFn({
        locateFile: (file: string) => `/assets/sql.js/${file}`
      });
    })();
  }
  return sqlPromise;
}

export class TournamentDatabase {
  private db: SqlJsDatabase;
  private tournamentPath: string;

  constructor(db: SqlJsDatabase, tournamentPath: string) {
    this.db = db;
    this.tournamentPath = tournamentPath;
  }

  static async load(tournamentPath: string): Promise<TournamentDatabase> {
    const SQL = await initSqlJs();
    const url = `/reports/${encodeURIComponent(tournamentPath)}/tournament.db`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load database: ${response.status} ${response.statusText}`);
    }
    const buffer = await response.arrayBuffer();
    const db = new SQL.Database(new Uint8Array(buffer));
    return new TournamentDatabase(db, tournamentPath);
  }

  close(): void {
    this.db.close();
  }

  getDecks(archetype?: string): DeckRow[] {
    let sql = 'SELECT * FROM decks';
    const params: unknown[] = [];
    if (archetype) {
      sql += ' WHERE archetype = ?';
      params.push(archetype);
    }
    sql += ' ORDER BY placement ASC';
    return this.queryAll<DeckRow>(sql, params);
  }

  getDecksWithCard(cardUid: string, minCount = 1): DeckRow[] {
    const sql = `
      SELECT DISTINCT d.* FROM decks d
      JOIN deck_cards dc ON d.id = dc.deck_id
      WHERE dc.card_uid = ? AND dc.count >= ?
      ORDER BY d.placement ASC
    `;
    return this.queryAll<DeckRow>(sql, [cardUid, minCount]);
  }

  getDecksBySuccessTag(tag: string): DeckRow[] {
    const sql = `
      SELECT d.* FROM decks d
      JOIN success_tags st ON d.id = st.deck_id
      WHERE st.tag = ?
      ORDER BY d.placement ASC
    `;
    return this.queryAll<DeckRow>(sql, [tag]);
  }

  getArchetypeCounts(): { archetype: string; count: number; percent: number }[] {
    const sql = `
      SELECT 
        archetype,
        COUNT(*) as count,
        ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM decks), 2) as percent
      FROM decks
      GROUP BY archetype
      ORDER BY count DESC
    `;
    return this.queryAll(sql);
  }

  getCardStats(archetype?: string): CardStatRow[] {
    if (!archetype) {
      const sql = `
        SELECT cs.*, 
               json_group_array(json_object('copies', cd.copies, 'players', cd.players, 'percent', cd.percent)) as dist_json
        FROM card_stats cs
        LEFT JOIN card_distributions cd ON cs.card_uid = cd.card_uid
        GROUP BY cs.card_uid
        ORDER BY cs.rank
      `;
      return this.queryAll<{ dist_json: string } & Omit<CardStatRow, 'dist'>>(sql).map(row => {
        const { dist_json: distJson, ...rest } = row;
        return {
          ...rest,
          dist: JSON.parse(distJson)
        };
      });
    }

    const sql = `
      WITH archetype_decks AS (
        SELECT id FROM decks WHERE archetype = ?
      ),
      archetype_total AS (
        SELECT COUNT(*) as total FROM archetype_decks
      ),
      card_counts AS (
        SELECT 
          dc.card_uid,
          dc.card_name,
          dc.card_set,
          dc.card_number,
          dc.category,
          dc.trainer_type,
          dc.energy_type,
          MAX(dc.ace_spec) as ace_spec,
          COUNT(DISTINCT dc.deck_id) as found
        FROM deck_cards dc
        WHERE dc.deck_id IN (SELECT id FROM archetype_decks)
        GROUP BY dc.card_uid
      )
      SELECT 
        cc.*,
        at.total,
        ROUND(cc.found * 100.0 / at.total, 2) as pct,
        ROW_NUMBER() OVER (ORDER BY cc.found DESC) as rank
      FROM card_counts cc, archetype_total at
      ORDER BY cc.found DESC
    `;
    return this.queryAll<CardStatRow>(sql, [archetype]);
  }

  getDeckCards(deckId: string): Record<string, unknown>[] {
    const sql = 'SELECT * FROM deck_cards WHERE deck_id = ? ORDER BY category, card_name';
    return this.queryAll(sql, [deckId]);
  }

  getCardDistribution(cardUid: string, archetype?: string): { copies: number; players: number; percent: number }[] {
    if (!archetype) {
      const sql = 'SELECT copies, players, percent FROM card_distributions WHERE card_uid = ? ORDER BY copies';
      return this.queryAll(sql, [cardUid]);
    }

    const sql = `
      WITH archetype_decks AS (
        SELECT id FROM decks WHERE archetype = ?
      ),
      card_in_archetype AS (
        SELECT dc.deck_id, dc.count
        FROM deck_cards dc
        WHERE dc.card_uid = ? AND dc.deck_id IN (SELECT id FROM archetype_decks)
      ),
      archetype_with_card AS (
        SELECT COUNT(DISTINCT deck_id) as total FROM card_in_archetype
      )
      SELECT 
        cia.count as copies,
        COUNT(DISTINCT cia.deck_id) as players,
        ROUND(COUNT(DISTINCT cia.deck_id) * 100.0 / awc.total, 2) as percent
      FROM card_in_archetype cia, archetype_with_card awc
      GROUP BY cia.count
      ORDER BY cia.count
    `;
    return this.queryAll(sql, [archetype, cardUid]);
  }

  filterDecks(filters: DeckFilters): DeckRow[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.archetype) {
      conditions.push('d.archetype = ?');
      params.push(filters.archetype);
    }

    if (filters.successTags && filters.successTags.length > 0) {
      const placeholders = filters.successTags.map(() => '?').join(', ');
      conditions.push(`EXISTS (
        SELECT 1 FROM success_tags st 
        WHERE st.deck_id = d.id AND st.tag IN (${placeholders})
      )`);
      params.push(...filters.successTags);
    }

    if (filters.includeCards && filters.includeCards.length > 0) {
      for (const card of filters.includeCards) {
        if (card.minCount) {
          conditions.push(`EXISTS (
            SELECT 1 FROM deck_cards dc 
            WHERE dc.deck_id = d.id AND dc.card_uid = ? AND dc.count >= ?
          )`);
          params.push(card.cardUid, card.minCount);
        } else {
          conditions.push(`EXISTS (
            SELECT 1 FROM deck_cards dc 
            WHERE dc.deck_id = d.id AND dc.card_uid = ?
          )`);
          params.push(card.cardUid);
        }
      }
    }

    if (filters.excludeCards && filters.excludeCards.length > 0) {
      for (const cardUid of filters.excludeCards) {
        conditions.push(`NOT EXISTS (
          SELECT 1 FROM deck_cards dc 
          WHERE dc.deck_id = d.id AND dc.card_uid = ?
        )`);
        params.push(cardUid);
      }
    }

    let sql = 'SELECT d.* FROM decks d';
    if (conditions.length > 0) {
      sql = `${sql} WHERE ${conditions.join(' AND ')}`;
    }
    sql = `${sql} ORDER BY d.placement ASC`;
    return this.queryAll<DeckRow>(sql, params);
  }

  getFilteredCardStats(filters: DeckFilters): CardStatRow[] {
    const filteredDecks = this.filterDecks(filters);
    if (filteredDecks.length === 0) {
      return [];
    }

    const deckIds = filteredDecks.map(deck => deck.id);
    const placeholders = deckIds.map(() => '?').join(', ');
    const total = deckIds.length;

    const sql = `
      WITH card_counts AS (
        SELECT 
          dc.card_uid,
          dc.card_name,
          dc.card_set,
          dc.card_number,
          dc.category,
          dc.trainer_type,
          dc.energy_type,
          MAX(dc.ace_spec) as ace_spec,
          COUNT(DISTINCT dc.deck_id) as found
        FROM deck_cards dc
        WHERE dc.deck_id IN (${placeholders})
        GROUP BY dc.card_uid
      )
      SELECT 
        cc.*,
        ${total} as total,
        ROUND(cc.found * 100.0 / ${total}, 2) as pct,
        ROW_NUMBER() OVER (ORDER BY cc.found DESC) as rank
      FROM card_counts cc
      ORDER BY cc.found DESC
    `;
    return this.queryAll<CardStatRow>(sql, deckIds);
  }

  getMetadata(): Record<string, string> {
    const sql = 'SELECT key, value FROM db_metadata';
    const rows = this.queryAll<{ key: string; value: string }>(sql);
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  }

  getTotalDecks(): number {
    const result = this.queryOne<{ count: number }>('SELECT COUNT(*) as count FROM decks');
    return result?.count ?? 0;
  }

  private queryAll<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[] {
    const stmt = this.db.prepare(sql);
    if (params) {
      stmt.bind(params);
    }
    const results: T[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject() as T);
    }
    stmt.free();
    return results;
  }

  private queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): T | null {
    const results = this.queryAll<T>(sql, params);
    return results.length > 0 ? results[0] : null;
  }
}

const dbCache = new Map<string, TournamentDatabase>();

export async function loadDatabase(tournamentPath: string): Promise<TournamentDatabase> {
  if (dbCache.has(tournamentPath)) {
    return dbCache.get(tournamentPath)!;
  }
  const db = await TournamentDatabase.load(tournamentPath);
  dbCache.set(tournamentPath, db);
  return db;
}

export function clearDatabaseCache(): void {
  for (const db of dbCache.values()) {
    db.close();
  }
  dbCache.clear();
}
