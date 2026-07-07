// Storyline engine for the "Latest event" home-page callout. Each generator is
// a pure function returning null or a `StoryCandidate` (Story + weight 0..100).
// `buildStories` runs every generator, dedupes by subject, sorts by weight, and
// returns the top 3. Pure module — JSON-serializable output so the cron can
// pre-pick stories server-side later.

import type { ArchetypeIndexEntry, TournamentParticipant } from '../types';
import { capitalize, formatRecord as formatRecordBase } from './format';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ArcTag = 'surged' | 'climbed' | 'faded' | 'steady';

/**
 * One archetype's row in the field-vs-cut funnel. Built by the page from
 * `participants` + `archetypes/index.json`; consumed by every generator below.
 */
export interface FieldRow {
  /** Raw deck name as it appears in participants */
  rawName: string;
  /** Preferred display label */
  label: string;
  archetype?: ArchetypeIndexEntry;
  /**
   * Pre-resolved CardStack thumbnails ["SET/NUM", ...] for this archetype.
   * Prefers the online archetype index (which is well-populated) over the
   * per-tournament index (which often ships with `thumbnails: []`), and
   * falls back to `signatureCards` from either source.
   */
  thumbnails: string[];
  /** This event's field share, 0..100 (deck count / total decklists) */
  fieldPct: number;
  /** This event's deck count for this archetype */
  fieldDecks: number;
  /** Players on this deck who made Day 2 */
  day2Count: number;
  /** Day 2 share, 0..100 (day2Count / totalDay2) — null if no D2 data */
  day2Pct: number | null;
  /**
   * Day 2 conversion rate, 0..100 — what % of this deck's pilots survived
   * Swiss. This is the real performance signal: cut is 8-16 people, Day 2 is
   * typically 25-40% of the field, big enough to be statistically meaningful.
   */
  day2Conversion: number | null;
  /** Players on this deck in top cut */
  topCutCount: number;
  /** Top cut share, 0..100 (topCutCount / totalTopCut) — null if no cut */
  cutPct: number | null;
  /** Average wins across all pilots of this archetype */
  avgWins: number | null;
  /** Best (lowest) placement among pilots of this archetype */
  bestPlacement: number | null;
  /** Online-meta share (0..100), or null if not tracked online */
  onlinePct: number | null;
  /** fieldPct - onlinePct (percentage points), or null */
  delta: number | null;
  /** Top-cut deck-survival %: topCutCount / fieldDecks * 100, or null */
  conversionPct: number | null;
}

export interface Story {
  tag: ArcTag;
  row: FieldRow;
  headline: string;
  body: string;
  /** Override the ARC tag label (e.g. "Underdog" instead of "Surged"). */
  tagLabel?: string;
  /** Override the archetype href (e.g. link to a player page). */
  href?: string;
  /** Override the thumbnail set (e.g. show a specific deck's CardStack). */
  thumbnails?: string[];
  /** Optional progress bar shown at the bottom of the card. */
  statBar?: {
    label: string;
    fillPct: number;
    left: string;
    right: string;
  };
}

export interface BuildStoriesInput {
  rows: FieldRow[];
  excludeArchetype: ArchetypeIndexEntry | undefined;
  hasDay2: boolean;
  winner: TournamentParticipant | undefined;
  standings: TournamentParticipant[];
  topCutParticipants: TournamentParticipant[];
  cutLine: number | null;
  totalTopCut: number;
  lookupArchetype: (name: string | null | undefined) => ArchetypeIndexEntry | undefined;
}

export const ARC_TAG_META: Record<ArcTag, { label: string; symbol: string }> = {
  surged: { label: 'Surged', symbol: '★' },
  climbed: { label: 'Climbed', symbol: '▲' },
  faded: { label: 'Faded', symbol: '▼' },
  steady: { label: 'Steady', symbol: '—' }
};

// ---------------------------------------------------------------------------
// Public helpers (also used by callers preparing data)
// ---------------------------------------------------------------------------

/**
 * Classify an archetype's trajectory through the tournament funnel.
 *  - surged: gained ≥1pp at both the Day-2 and Cut steps
 *  - climbed: gained at one step but not both
 *  - faded: ≥5% of the field but 0% of the cut
 *  - steady: anything else
 */
export function classifyArc(row: FieldRow): ArcTag {
  const f = row.fieldPct;
  const d = row.day2Pct;
  const c = row.cutPct;
  if (f >= 5 && c !== null && c === 0) {
    return 'faded';
  }
  if (d !== null && c !== null) {
    const gainedD2 = d - f >= 1;
    const gainedCut = c - d >= 1;
    if (gainedD2 && gainedCut) {
      return 'surged';
    }
    if (gainedD2 || gainedCut) {
      return 'climbed';
    }
  }
  return 'steady';
}

/**
 * Resolve a renderable CardStack thumbnail list ["SET/NUM", ...] for an
 * archetype across two source indexes. Per-tournament reports often ship with
 * `thumbnails: []`, so we prefer the rolling-meta (online) index, which is
 * canonical for art, then fall back to the tournament entry's thumbnails.
 *
 * Returns [] when nothing's available — callers should render an empty
 * thumbnail panel rather than collapsing the slot.
 */
export function resolveArchetypeThumbnails(
  online: ArchetypeIndexEntry | undefined,
  tournament: ArchetypeIndexEntry | undefined
): string[] {
  if (online?.thumbnails?.length) {
    return online.thumbnails;
  }
  if (tournament?.thumbnails?.length) {
    return tournament.thumbnails;
  }
  return [];
}

/**
 * Normalize a country string to a short uppercase code suitable for a text
 * pill. Accepts 2- or 3-letter codes; longer strings are passed through up
 * to 12 chars. Returns null when the input is empty/unusable.
 */
export function countryLabel(code?: string | null): string | null {
  if (!code) {
    return null;
  }
  const trimmed = code.trim();
  if (!trimmed) {
    return null;
  }
  if (/^[A-Za-z]{2,3}$/.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  return trimmed.slice(0, 12);
}

/** Format a participant's record as "W-L" or "W-L-T". Returns null when both wins and losses are missing. */
export function formatRecord(p: TournamentParticipant): string | null {
  return formatRecordBase(p, { compact: true });
}

// ---------------------------------------------------------------------------
// Story engine — picker + generators
// ---------------------------------------------------------------------------

interface StoryCandidate extends Story {
  /** Priority score 0..100. Higher candidates surface first. */
  weight: number;
  /**
   * Dedupe key. Two candidates with the same subjectKey won't both appear in
   * the picked set — the higher-weighted one wins. Prefix with the story
   * domain so player vs. archetype stories don't collide.
   *   "archetype:<name>" for archetype-centered stories
   *   "player:<name>"    for player-centered stories
   *   "event:<slug>"     for event-wide stories
   */
  subjectKey: string;
}

interface StoryContext {
  rows: FieldRow[];
  excludeArchetype: ArchetypeIndexEntry | undefined;
  hasDay2: boolean;
  winner: TournamentParticipant | undefined;
  standings: TournamentParticipant[];
  topCutParticipants: TournamentParticipant[];
  cutLine: number | null;
  totalTopCut: number;
  lookupArchetype: (name: string | null | undefined) => ArchetypeIndexEntry | undefined;
}

type StoryGenerator = (ctx: StoryContext) => StoryCandidate | null;

/**
 * "Other" is the fallback bucket for decks that didn't match any known
 * archetype — usually rogue/jank lists that have nothing meaningful in common.
 * A story about "Other failed to convert to Day 2" is nonsense, so we filter
 * it out of the archetype-centric story pool entirely.
 */
function isOtherArchetype(label: string | null | undefined): boolean {
  if (!label) {
    return false;
  }
  return label.trim().toLowerCase() === 'other';
}

function rowIsOther(row: FieldRow): boolean {
  return isOtherArchetype(row.archetype?.name) || isOtherArchetype(row.label);
}

/** Run all storyline generators, dedupe by subject, return the top N (default 3). */
export function buildStories(input: BuildStoriesInput, limit: number = 3): Story[] {
  const ctx: StoryContext = { ...input, rows: input.rows.filter(r => !rowIsOther(r)) };
  const candidates = STORY_GENERATORS.map(g => g(ctx)).filter((c): c is StoryCandidate => c !== null);
  return pickStories(candidates, limit);
}

/**
 * Archetype a candidate is "about", for cross-domain dedup. Player-centered
 * stories (e.g. "Hiromu Sasaki ran the table") carry their deck's archetype on
 * the stub row, so without this an archetype could surface twice — once via a
 * player story and once via an archetype story (e.g. two Dragapult cards). We
 * collapse to one story per archetype regardless of the subject domain.
 * Returns null when the archetype is unknown so unrelated rogue decks aren't
 * all merged under one placeholder.
 */
function archetypeKeyOf(c: StoryCandidate): string | null {
  const name = c.row.archetype?.name ?? c.row.label;
  if (!name || name === '—' || isOtherArchetype(name)) {
    return null;
  }
  return name.trim().toLowerCase();
}

function pickStories(candidates: StoryCandidate[], limit: number): Story[] {
  const sorted = [...candidates].sort((a, b) => b.weight - a.weight);
  const seenSubject = new Set<string>();
  const seenArchetype = new Set<string>();
  const out: Story[] = [];
  for (const c of sorted) {
    if (seenSubject.has(c.subjectKey)) {
      continue;
    }
    const archKey = archetypeKeyOf(c);
    if (archKey !== null && seenArchetype.has(archKey)) {
      continue;
    }
    seenSubject.add(c.subjectKey);
    if (archKey !== null) {
      seenArchetype.add(archKey);
    }
    out.push(c);
    if (out.length === limit) {
      break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Generators (each returns null if not applicable)
// ---------------------------------------------------------------------------

const MEANINGFUL_FIELD = 5;

/**
 * The element with the greatest `keyFn` value — O(n), no array copy. Ties
 * resolve to the first-occurring element, matching what `[...rows].sort(desc)[0]`
 * yields under a stable sort. For a minimum, negate the key.
 */
function maxBy<T>(rows: readonly T[], keyFn: (row: T) => number): T | undefined {
  let best: T | undefined;
  let bestKey = -Infinity;
  for (const row of rows) {
    const key = keyFn(row);
    if (best === undefined || key > bestKey) {
      best = row;
      bestKey = key;
    }
  }
  return best;
}

/** Top performer — best Day-2 conversion among decks with ≥5 pilots. */
const genTopPerformer: StoryGenerator = ctx => {
  if (!ctx.hasDay2) {
    return null;
  }
  const best = maxBy(
    ctx.rows.filter(r => r.day2Conversion !== null && r.fieldDecks >= MEANINGFUL_FIELD),
    r => r.day2Conversion!
  );
  if (!best || (best.day2Conversion ?? 0) < 25) {
    return null;
  }
  return {
    ...makeConversionStory({
      row: best,
      tag: 'surged',
      headline: `${best.label} converted best`,
      tagLabel: 'Top performer',
      body: buildPerformanceLine(best)
    }),
    weight: Math.min(100, best.day2Conversion!),
    subjectKey: `archetype:${best.archetype?.name ?? best.label}`
  };
};

/**
 * Best-placing player who missed cut.
 *
 * Pokemon tournaments use an asymmetric cut: every player with a winning
 * record makes Day 2, then it's whittled to a Top 8. That means the player
 * one slot below the Top-8 line ("#9 just missed on tiebreaker") is a
 * near-guaranteed story at every event — interesting but rarely surprising.
 * We keep the story available but weight it modestly so genuinely newsworthy
 * stories (off-meta finalists, cut domination, no-shows, meta surprises) can
 * naturally outrank it.
 */
const genUnderdog: StoryGenerator = ctx => {
  if (ctx.cutLine === null) {
    return null;
  }
  const underdog = ctx.standings.find(p => (p.placement ?? 0) > ctx.cutLine!);
  if (!underdog || typeof underdog.placement !== 'number') {
    return null;
  }
  const entry = ctx.lookupArchetype(underdog.deckName);
  const record = formatRecord(underdog);
  const country = countryLabel(underdog.country);
  const parts: string[] = [];
  parts.push(`${underdog.name}${country ? ` (${country})` : ''} finished #${underdog.placement}`);
  if (underdog.deckName) {
    parts.push(`piloting ${underdog.deckName}`);
  }
  if (record) {
    parts.push(`record ${record}`);
  }
  const stubRow: FieldRow = makeStubRow(underdog.deckName ?? '—', entry, underdog.placement);
  const gap = underdog.placement - ctx.cutLine;
  return {
    tag: 'climbed',
    tagLabel: 'Just outside',
    row: stubRow,
    headline: gap <= 1 ? `${underdog.name} just missed top cut` : `${underdog.name} led the players out`,
    body: `${capitalize(parts.join(' · '))}.`,
    href: entry ? `/archetypes/${encodeURIComponent(entry.name)}` : undefined,
    weight: 20 + Math.max(0, 8 - gap),
    subjectKey: `player:${underdog.name}#${underdog.placement}`
  };
};

/** Large field but poor Day-2 conversion. */
const genDisappointment: StoryGenerator = ctx => {
  if (!ctx.hasDay2) {
    return null;
  }
  const worst = maxBy(
    ctx.rows.filter(r => r.day2Conversion !== null && r.fieldDecks >= 10),
    r => -r.day2Conversion!
  );
  if (!worst || (worst.day2Conversion ?? 100) >= 25) {
    return null;
  }
  // The deck's own conversion is near-zero by definition, so a bar of just that
  // reads as empty/broken. Show the field's average conversion as the benchmark
  // — the bar this deck failed to clear — with its own rate alongside.
  const fieldAvgConversion = computeFieldAvgConversion(ctx.rows);
  return {
    ...makeConversionStory({
      row: worst,
      tag: 'faded',
      headline: `${worst.label} couldn't deliver`,
      tagLabel: 'Disappointment',
      body: buildFadeLine(worst)
    }),
    statBar:
      fieldAvgConversion !== null
        ? {
            label: 'Field Day 2 conversion',
            fillPct: fieldAvgConversion,
            left: `${fmtPct(worst.day2Conversion!)} this deck`,
            right: `${fmtPct(fieldAvgConversion)} field avg`
          }
        : undefined,
    // Bigger fields with worse conversion are more newsworthy.
    weight: Math.min(100, (25 - worst.day2Conversion!) * 2 + worst.fieldDecks / 2),
    subjectKey: `archetype:${worst.archetype?.name ?? worst.label}`
  };
};

/** Small field but high Day-2 conversion. */
const genHiddenGem: StoryGenerator = ctx => {
  if (!ctx.hasDay2) {
    return null;
  }
  const gem = maxBy(
    ctx.rows.filter(r => r.day2Conversion !== null && r.fieldDecks >= 3 && r.fieldDecks < MEANINGFUL_FIELD * 3),
    r => r.day2Conversion!
  );
  if (!gem || (gem.day2Conversion ?? 0) < 35) {
    return null;
  }
  return {
    ...makeConversionStory({
      row: gem,
      tag: 'climbed',
      headline: `${gem.label} punched above weight`,
      tagLabel: 'Hidden gem',
      body: buildGemLine(gem)
    }),
    weight: Math.min(100, gem.day2Conversion! - 30),
    subjectKey: `archetype:${gem.archetype?.name ?? gem.label}`
  };
};

/** Biggest divergence from online-meta share — over or underbrought. */
const genMetaSurprise: StoryGenerator = ctx => {
  const surprise = maxBy(
    ctx.rows.filter(r => r.delta !== null && r.archetype !== ctx.excludeArchetype),
    r => Math.abs(r.delta!)
  );
  if (!surprise || Math.abs(surprise.delta ?? 0) < 4) {
    return null;
  }
  const overbrought = (surprise.delta ?? 0) > 0;
  return {
    tag: overbrought ? 'climbed' : 'faded',
    tagLabel: overbrought ? 'Overbrought' : 'Underbrought',
    row: surprise,
    headline: overbrought
      ? `${surprise.label} was the day's most popular pick`
      : `${surprise.label} was conspicuously absent`,
    body: buildSurpriseLine(surprise, overbrought),
    statBar: {
      label: 'vs. online meta',
      fillPct: Math.min(100, Math.abs(surprise.delta!) * 4),
      left: `${fmtPct(surprise.fieldPct)} field · ${fmtPct(surprise.onlinePct ?? 0)} online`,
      right: `${overbrought ? '+' : '−'}${Math.abs(surprise.delta!).toFixed(1)}pp`
    },
    weight: Math.min(100, Math.abs(surprise.delta!) * 6),
    subjectKey: `archetype:${surprise.archetype?.name ?? surprise.label}`
  };
};

/** A single archetype occupies ≥30% of top cut spots — a dominant force. */
const genCutDomination: StoryGenerator = ctx => {
  if (ctx.totalTopCut < 4) {
    return null;
  }
  const dominant = maxBy(
    ctx.rows.filter(r => r.topCutCount >= 2),
    r => r.topCutCount
  );
  if (!dominant) {
    return null;
  }
  const share = (dominant.topCutCount / ctx.totalTopCut) * 100;
  if (share < 30) {
    return null;
  }
  return {
    tag: 'surged',
    tagLabel: 'Cut domination',
    row: dominant,
    headline: `${dominant.label} took over the cut`,
    body: `${dominant.topCutCount} of ${ctx.totalTopCut} top-cut slots — ${fmtPct(share)} of the bracket.`,
    statBar: {
      label: 'Share of top cut',
      fillPct: share,
      left: `${dominant.topCutCount} of ${ctx.totalTopCut} slots`,
      right: fmtPct(share)
    },
    weight: Math.min(100, share + 10),
    subjectKey: `archetype:${dominant.archetype?.name ?? dominant.label}`
  };
};

/** Top-cut player on an archetype that's <2% of online meta — a fringe pick. */
const genOffMetaFinalist: StoryGenerator = ctx => {
  const candidates = ctx.topCutParticipants
    .map(p => {
      const entry = ctx.lookupArchetype(p.deckName);
      const row = ctx.rows.find(r => r.archetype === entry);
      return { p, entry, row };
    })
    .filter(c => c.row && c.row.onlinePct !== null && c.row.onlinePct < 2 && typeof c.p.placement === 'number')
    .sort((a, b) => (a.p.placement ?? 999) - (b.p.placement ?? 999));
  const best = candidates[0];
  if (!best || !best.row) {
    return null;
  }
  const country = countryLabel(best.p.country);
  return {
    tag: 'climbed',
    tagLabel: 'Off-meta',
    row: best.row,
    headline: `${best.p.deckName} made cut against the grain`,
    body: `${best.p.name}${country ? ` (${country})` : ''} finished #${best.p.placement} on an archetype just ${fmtPct(best.row.onlinePct!)} of the online meta.`,
    statBar: {
      label: 'Online meta share',
      fillPct: Math.min(100, best.row.onlinePct! * 20),
      left: `${fmtPct(best.row.onlinePct!)} online`,
      // best.row came from ctx.rows.find(), so it's always a member of ctx.rows.
      right: `${best.row.fieldDecks} pilots`
    },
    weight: 50 + (2 - best.row.onlinePct!) * 15,
    subjectKey: `archetype:${best.row.archetype?.name ?? best.row.label}`
  };
};

/** Major online-meta archetype with no representation here at all. */
const genNoShowMeta: StoryGenerator = ctx => {
  const missing = maxBy(
    ctx.rows.filter(r => r.onlinePct !== null && r.onlinePct >= 5 && r.fieldDecks === 0),
    r => r.onlinePct!
  );
  if (!missing) {
    return null;
  }
  return {
    tag: 'faded',
    tagLabel: 'No-show',
    row: missing,
    headline: `${missing.label} didn't show up`,
    body: `A ${fmtPct(missing.onlinePct!)} share of the online meta — and not a single pilot brought it.`,
    statBar: {
      label: 'Online meta vs. field',
      fillPct: Math.min(100, missing.onlinePct! * 10),
      left: `${fmtPct(missing.onlinePct!)} online`,
      right: '0 pilots'
    },
    weight: Math.min(95, 40 + missing.onlinePct! * 5),
    subjectKey: `archetype:${missing.archetype?.name ?? missing.label}`
  };
};

/** Winner went undefeated through Swiss. */
const genUnbrokenWinner: StoryGenerator = ctx => {
  if (!ctx.winner) {
    return null;
  }
  const w = ctx.winner.wins ?? 0;
  const l = ctx.winner.losses ?? 0;
  if (w < 6 || l !== 0) {
    return null;
  }
  const entry = ctx.lookupArchetype(ctx.winner.deckName);
  // Prefer the real field row (carries Day-2 conversion) over a bare stub.
  const archetypeRow = entry ? ctx.rows.find(r => r.archetype === entry) : undefined;
  const row = archetypeRow ?? makeStubRow(ctx.winner.deckName ?? '—', entry, 1);
  return {
    tag: 'surged',
    tagLabel: 'Unbeaten',
    row,
    headline: `${ctx.winner.name} ran the table`,
    body: `${w}-0${ctx.winner.ties ? `-${ctx.winner.ties}` : ''} through Swiss${ctx.winner.deckName ? ` on ${ctx.winner.deckName}` : ''}.`,
    href: entry ? `/archetypes/${encodeURIComponent(entry.name)}` : undefined,
    statBar: day2ConversionStatBar(row),
    weight: 85,
    subjectKey: `player:${ctx.winner.name}#1`
  };
};

/** Mirror in the cut — same archetype claiming ≥2 of the top-cut spots. */
const genMirrorCut: StoryGenerator = ctx => {
  const cut = ctx.topCutParticipants;
  if (cut.length < 4) {
    return null;
  }
  const counts = new Map<string, { count: number; entry: ArchetypeIndexEntry | undefined; label: string }>();
  for (const p of cut) {
    const entry = ctx.lookupArchetype(p.deckName);
    const key = entry?.name ?? p.deckName ?? '—';
    if (!counts.has(key)) {
      counts.set(key, { count: 0, entry, label: entry?.label ?? p.deckName ?? '—' });
    }
    counts.get(key)!.count++;
  }
  const top = [...counts.entries()].sort((a, b) => b[1].count - a[1].count)[0];
  if (!top || top[1].count < 2) {
    return null;
  }
  const { count, entry, label } = top[1];
  const row = ctx.rows.find(r => r.archetype === entry) ?? makeStubRow(label, entry, null);
  return {
    tag: 'climbed',
    tagLabel: 'Cut mirror',
    row,
    headline: `${label} owned the cut`,
    body: `${count} of the ${cut.length} top-cut spots went to the same archetype.`,
    weight: 60 + count * 8,
    subjectKey: `archetype:${entry?.name ?? label}`
  };
};

const STORY_GENERATORS: StoryGenerator[] = [
  genTopPerformer,
  genUnderdog,
  genDisappointment,
  genHiddenGem,
  genMetaSurprise,
  genCutDomination,
  genOffMetaFinalist,
  genNoShowMeta,
  genUnbrokenWinner,
  genMirrorCut
];

// ---------------------------------------------------------------------------
// Generator helpers (internal)
// ---------------------------------------------------------------------------

/**
 * The "Day 2 conversion" progress bar for a field row — the `day2Count of
 * fieldDecks` fill used by both the conversion stories and the unbeaten-winner
 * story. Returns undefined when the row has no conversion data.
 */
function day2ConversionStatBar(row: FieldRow): Story['statBar'] {
  if (row.day2Conversion === null) {
    return undefined;
  }
  return {
    label: 'Day 2 conversion',
    fillPct: row.day2Conversion,
    left: `${row.day2Count} of ${row.fieldDecks}`,
    right: fmtPct(row.day2Conversion)
  };
}

function makeConversionStory(args: {
  row: FieldRow;
  tag: ArcTag;
  headline: string;
  tagLabel: string;
  body: string;
}): Story {
  const r = args.row;
  return {
    tag: args.tag,
    tagLabel: args.tagLabel,
    row: r,
    headline: args.headline,
    body: args.body,
    statBar: day2ConversionStatBar(r)
  };
}

/**
 * Stub FieldRow for player-centered stories where the archetype isn't a row
 * in the field index (e.g., archetype only had a single pilot). Used for
 * thumbnail resolution and href.
 */
function makeStubRow(
  label: string,
  archetype: ArchetypeIndexEntry | undefined,
  bestPlacement: number | null
): FieldRow {
  return {
    rawName: label,
    label,
    archetype,
    thumbnails: resolveArchetypeThumbnails(archetype, archetype),
    fieldPct: 0,
    fieldDecks: 0,
    day2Count: 0,
    day2Pct: null,
    day2Conversion: null,
    topCutCount: 0,
    cutPct: null,
    avgWins: null,
    bestPlacement,
    onlinePct: null,
    delta: null,
    conversionPct: null
  };
}

function buildSurpriseLine(r: FieldRow, overbrought: boolean): string {
  if (overbrought) {
    return `${fmtPct(r.fieldPct)} of the field showed up on this archetype — well above its ${fmtPct(r.onlinePct ?? 0)} online share.`;
  }
  return `Just ${fmtPct(r.fieldPct)} of the field brought this, compared with ${fmtPct(r.onlinePct ?? 0)} online.`;
}

function buildPerformanceLine(r: FieldRow): string {
  const parts: string[] = [];
  parts.push(`${r.day2Count} of ${r.fieldDecks} survived Day 2 (${fmtPct(r.day2Conversion!)})`);
  if (r.avgWins !== null) {
    parts.push(`avg record ${r.avgWins.toFixed(1)} wins`);
  }
  if (r.bestPlacement !== null) {
    parts.push(`best finish #${r.bestPlacement}`);
  }
  return `${capitalize(parts.join(' · '))}.`;
}

/**
 * Field-wide Day-2 conversion (%, 0..100): total pilots who reached Day 2
 * divided by total pilots, across every archetype with conversion data. This
 * is the benchmark a single deck's conversion is measured against. Returns
 * null when no row carries conversion data.
 */
function computeFieldAvgConversion(rows: FieldRow[]): number | null {
  let day2 = 0;
  let total = 0;
  for (const r of rows) {
    if (r.day2Conversion !== null && r.fieldDecks > 0) {
      day2 += r.day2Count;
      total += r.fieldDecks;
    }
  }
  return total > 0 ? (day2 / total) * 100 : null;
}

function buildFadeLine(r: FieldRow): string {
  const parts: string[] = [];
  parts.push(
    r.day2Count === 0
      ? `${r.fieldDecks} brought it, not one made Day 2`
      : `${r.fieldDecks} brought it, only ${r.day2Count} made Day 2 (${fmtPct(r.day2Conversion!)} conversion)`
  );
  if (r.bestPlacement !== null) {
    parts.push(`best finish #${r.bestPlacement}`);
  }
  return `${capitalize(parts.join(' · '))}.`;
}

function buildGemLine(r: FieldRow): string {
  const parts: string[] = [];
  parts.push(`only ${r.fieldDecks} pilots, ${r.day2Count} cleared Day 2`);
  parts.push(`${fmtPct(r.day2Conversion!)} conversion`);
  if (r.bestPlacement !== null) {
    parts.push(`best finish #${r.bestPlacement}`);
  }
  return `${capitalize(parts.join(' · '))}.`;
}

function fmtPct(p: number): string {
  if (p < 10) {
    return `${p.toFixed(1)}%`;
  }
  return `${p.toFixed(0)}%`;
}
