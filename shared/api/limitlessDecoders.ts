/**
 * Decoders for the Limitless API responses the pipeline turns into artifacts.
 *
 * A generic type parameter is not validation: `fetchLimitless<T>()` returns
 * whatever the API sent, wearing `T` as a costume. That is tolerable for a
 * read-through proxy and not tolerable here, because these responses become
 * immutable published artifacts — a shape change upstream would be baked into a
 * release before anyone noticed.
 *
 * Each decoder answers two questions separately, which is the point:
 *
 * - Is this the right SHAPE? A list endpoint returning an object, or an object
 *   endpoint returning a string, means the API moved. That throws.
 * - Are the ROWS usable? An individual row missing an id is a bad row. Those are
 *   dropped and COUNTED, so "we skipped 2 of 60" and "we skipped 60 of 60" are
 *   distinguishable — the second is structural breakage wearing the costume of
 *   a quiet day, the same failure mode the upcoming-tournaments scraper guards
 *   against.
 *
 * Isomorphic: no environment-specific dependencies.
 * @module shared/api/limitlessDecoders
 */

/** A decoded batch plus what it had to discard. */
export interface DecodeResult<T> {
  rows: T[];
  /** Rows present in the response that could not be used. */
  skipped: number;
  /** Rows present in the response, usable or not. */
  seen: number;
}

/** Thrown when a response is the wrong shape entirely — the API moved. */
export class LimitlessShapeError extends Error {
  constructor(what: string, got: unknown) {
    super(`Limitless ${what}: expected ${what.includes('list') ? 'an array' : 'an object'}, got ${describe(got)}`);
    this.name = 'LimitlessShapeError';
  }
}

function describe(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return `an array of ${value.length}`;
  }
  return typeof value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function num(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// /tournaments
// ---------------------------------------------------------------------------

export interface TournamentListEntry {
  id: string;
  name: string;
  date: string;
  format?: string;
  game?: string;
  players?: number;
}

/**
 * Decode the tournament list.
 *
 * A row needs an id, a name, and a PARSEABLE date. The date matters because the
 * caller windows on it and treats an unparseable one as "older than the
 * window", which would silently truncate the crawl at the first malformed row.
 * @param raw - The response body
 * @returns Usable rows plus discard counts
 * @throws {LimitlessShapeError} When the response is not an array
 */
export function decodeTournamentList(raw: unknown): DecodeResult<TournamentListEntry> {
  if (!Array.isArray(raw)) {
    throw new LimitlessShapeError('tournament list', raw);
  }
  const rows: TournamentListEntry[] = [];
  let skipped = 0;
  for (const entry of raw) {
    if (!isRecord(entry)) {
      skipped += 1;
      continue;
    }
    const id = str(entry.id);
    const name = str(entry.name);
    const date = str(entry.date);
    if (!id || !name || !date || !Number.isFinite(Date.parse(date))) {
      skipped += 1;
      continue;
    }
    rows.push({
      id,
      name,
      date,
      format: str(entry.format) ?? undefined,
      game: str(entry.game) ?? undefined,
      players: num(entry.players) ?? undefined
    });
  }
  return { rows, skipped, seen: raw.length };
}

// ---------------------------------------------------------------------------
// /tournaments/{id}/details
// ---------------------------------------------------------------------------

export interface TournamentDetails {
  decklists?: boolean;
  isOnline?: boolean;
  format?: string;
  platform?: string;
  players?: number;
  organizer?: { name?: string };
}

/**
 * Decode a tournament's details.
 *
 * Every field is optional upstream and the caller's filters are written as
 * `=== false` rather than falsy checks, so a missing field means "unknown, do
 * not exclude". Absent booleans stay absent rather than defaulting, to preserve
 * that distinction.
 * @param raw - The response body
 * @returns The details
 * @throws {LimitlessShapeError} When the response is not an object
 */
export function decodeTournamentDetails(raw: unknown): TournamentDetails {
  if (!isRecord(raw)) {
    throw new LimitlessShapeError('tournament details', raw);
  }
  const organizer = isRecord(raw.organizer) ? { name: str(raw.organizer.name) ?? undefined } : undefined;
  return {
    decklists: typeof raw.decklists === 'boolean' ? raw.decklists : undefined,
    isOnline: typeof raw.isOnline === 'boolean' ? raw.isOnline : undefined,
    format: str(raw.format) ?? undefined,
    platform: str(raw.platform) ?? undefined,
    players: num(raw.players) ?? undefined,
    organizer
  };
}

// ---------------------------------------------------------------------------
// /tournaments/{id}/standings
// ---------------------------------------------------------------------------

export interface StandingsRow {
  name?: string;
  player?: string;
  country?: string | null;
  placing?: number;
  deck?: { id?: string | null; name?: string | null };
  decklist?: Record<string, Array<{ name?: string; [key: string]: unknown }>>;
}

/**
 * Decode a standings response.
 *
 * A row is usable if it identifies a player at all; everything else is
 * decoration the downstream adapter already treats as optional. The decklist is
 * passed through structurally unchecked on purpose — `toCardEntries` is the one
 * place that interprets it, and duplicating its tolerance here would mean two
 * places to keep in sync.
 * @param raw - The response body
 * @returns Usable rows plus discard counts
 * @throws {LimitlessShapeError} When the response is not an array
 */
export function decodeStandings(raw: unknown): DecodeResult<StandingsRow> {
  if (!Array.isArray(raw)) {
    throw new LimitlessShapeError('standings list', raw);
  }
  const rows: StandingsRow[] = [];
  let skipped = 0;
  for (const entry of raw) {
    if (!isRecord(entry)) {
      skipped += 1;
      continue;
    }
    const player = str(entry.player);
    const name = str(entry.name);
    if (!player && !name) {
      skipped += 1;
      continue;
    }
    rows.push({
      name: name ?? undefined,
      player: player ?? undefined,
      country: str(entry.country),
      placing: num(entry.placing) ?? undefined,
      deck: isRecord(entry.deck) ? { id: str(entry.deck.id), name: str(entry.deck.name) } : undefined,
      decklist: isRecord(entry.decklist) ? (entry.decklist as Record<string, Array<{ name?: string }>>) : undefined
    });
  }
  return { rows, skipped, seen: raw.length };
}

// ---------------------------------------------------------------------------
// Breakage detection
// ---------------------------------------------------------------------------

/**
 * Whether a decode result looks like the API changed rather than one bad row.
 *
 * Losing every row of a non-empty response is the signal worth acting on: it
 * renders identically to a genuinely empty response, so without this the
 * pipeline would publish an artifact built from nothing and report success.
 * @param result - A decode result
 * @param what - Label for the message
 * @returns A warning string, or undefined when the decode looks healthy
 */
export function detectDecodeBreakage<T>(result: DecodeResult<T>, what: string): string | undefined {
  if (result.seen === 0 || result.skipped === 0) {
    return undefined;
  }
  if (result.rows.length === 0) {
    return `Limitless ${what}: discarded all ${result.seen} rows — the response shape has probably changed.`;
  }
  // A minority of bad rows is normal upstream noise; a majority is not.
  if (result.skipped * 2 > result.seen) {
    return `Limitless ${what}: discarded ${result.skipped} of ${result.seen} rows.`;
  }
  return undefined;
}
