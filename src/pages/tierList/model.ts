/**
 * Tier List Maker state, kept free of Solid so it unit-tests under plain
 * `node:test`.
 *
 * Two ideas carry the whole model:
 *
 * - **Placement keys off a tier's id, never its index.** Moving a tier has to
 *   carry its contents with it; keying by position swaps two rows' worth of
 *   items instead.
 * - **The board is rebuilt from state on every render.** The drag layer mutates
 *   the DOM directly for smoothness, and the result is read back into
 *   `placement` on drop, so adding an archetype or flipping a toggle never
 *   throws away the arranging already done.
 * @module pages/tierList/model
 */

import { DEFAULT_RAMP, DEFAULT_TIER_NAMES, nextSwatchId } from './palette';

/** Which subject is being ranked. */
export type TierMode = 'icons' | 'previews' | 'arts';

export interface Tier {
  /** Stable across renames, reorders and recolours. Placement keys off this. */
  id: string;
  name: string;
  /** A {@link Swatch} id. */
  swatch: string;
}

/** A tile on the board, whatever the current mode renders. */
export interface TierItem {
  /** Unique within the current mode: an archetype name, or a `SET::NUMBER`. */
  id: string;
  label: string;
  kind: 'icon' | 'preview' | 'art';
  /** Pokémon sprite slugs, at most two. Icon mode. */
  icons?: string[];
  /** `SET/NUMBER` thumbnails, at most three. Preview mode. */
  thumbs?: string[];
  set?: string;
  number?: string;
  /** Present only on archetypes the user invented. */
  customId?: number;
}

/** An archetype the user added by hand, carrying both views' artwork. */
export interface CustomArchetype {
  id: number;
  name: string;
  /** Sprite slugs, at most two. */
  icons: string[];
  /** `SET/NUMBER` refs, at most two. */
  cards: string[];
}

/** Where the tray sits in a placement map. */
export const TRAY = 'tray';

let tierSeq = 0;

/** A tier with a fresh id. Ids only need to be unique within one session. */
export function makeTier(name: string, swatchId: string): Tier {
  tierSeq += 1;
  return { id: `t${tierSeq}`, name, swatch: swatchId };
}

export function defaultTiers(): Tier[] {
  return DEFAULT_RAMP.map((sw, i) => makeTier(DEFAULT_TIER_NAMES[i] ?? `T${i + 1}`, sw));
}

/** Appends a tier in the first colour no existing tier is using. */
export function withAddedTier(tiers: readonly Tier[]): Tier[] {
  return [...tiers, makeTier('New', nextSwatchId(tiers.map(t => t.swatch)))];
}

/** Moves a tier by `step` positions. Out-of-range moves are no-ops, not wraps. */
export function withMovedTier(tiers: readonly Tier[], id: string, step: number): Tier[] {
  const from = tiers.findIndex(t => t.id === id);
  const to = from + step;
  if (from < 0 || to < 0 || to >= tiers.length) {
    return [...tiers];
  }
  const next = [...tiers];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

/** Reorders to match `ids`; anything absent from `ids` keeps its relative place at the end. */
export function withTierOrder(tiers: readonly Tier[], ids: readonly string[]): Tier[] {
  const rank = new Map(ids.map((id, i) => [id, i]));
  return [...tiers].sort((a, b) => (rank.get(a.id) ?? ids.length) - (rank.get(b.id) ?? ids.length));
}

/**
 * Removes a tier and returns its contents to the tray. The last tier cannot be
 * removed — a board with no tiers has nothing to drop onto.
 */
export function withDeletedTier(
  tiers: readonly Tier[],
  placement: ReadonlyMap<string, string>,
  id: string
): { tiers: Tier[]; placement: Map<string, string> } {
  if (tiers.length <= 1) {
    return { tiers: [...tiers], placement: new Map(placement) };
  }
  const next = new Map(placement);
  for (const [item, at] of next) {
    if (at === id) {
      next.delete(item);
    }
  }
  return { tiers: tiers.filter(t => t.id !== id), placement: next };
}

/** Applies an edit to one tier, leaving the rest untouched. */
export function withEditedTier(tiers: readonly Tier[], id: string, patch: Partial<Omit<Tier, 'id'>>): Tier[] {
  return tiers.map(t => (t.id === id ? { ...t, ...patch } : t));
}

/**
 * Splits items into per-tier buckets plus the tray, in the order the items
 * arrive. An item placed in a tier that no longer exists falls back to the
 * tray rather than vanishing.
 */
export function distribute(
  items: readonly TierItem[],
  tiers: readonly Tier[],
  placement: ReadonlyMap<string, string>
): { buckets: Map<string, TierItem[]>; tray: TierItem[] } {
  const buckets = new Map(tiers.map(t => [t.id, [] as TierItem[]]));
  const tray: TierItem[] = [];
  for (const item of items) {
    const at = placement.get(item.id);
    const bucket = at ? buckets.get(at) : undefined;
    if (bucket) {
      bucket.push(item);
    } else {
      tray.push(item);
    }
  }
  return { buckets, tray };
}

/**
 * Renaming a custom archetype changes its item id, so its placement has to be
 * carried across or the archetype drops back to the tray on the next render.
 */
export function withRenamedPlacement(
  placement: ReadonlyMap<string, string>,
  from: string,
  to: string
): Map<string, string> {
  const next = new Map(placement);
  const at = next.get(from);
  next.delete(from);
  if (at !== undefined && from !== to) {
    next.set(to, at);
  }
  return next;
}

// ---------------------------------------------------------------------------
// Sharing
// ---------------------------------------------------------------------------

/** Everything a shared link has to carry. */
export interface ShareState {
  mode: TierMode;
  /** Tournament name, or the card name in `arts` mode. */
  subject: string;
  title: string;
  tiers: Tier[];
  /** Item id → tier id. Tray entries are omitted; absence means unranked. */
  placement: Map<string, string>;
  custom: CustomArchetype[];
}

interface WireState {
  v: 1;
  m: TierMode;
  s: string;
  t: string;
  /** `[name, swatch, ...itemIds]` per tier, in board order. */
  r: string[][];
  c: [number, string, string[], string[]][];
}

/**
 * Encodes to a URL-hash-safe string.
 *
 * Base64url of compact JSON. With at most sixty items and ten tiers this lands
 * in a few hundred characters, so the whole list rides in the fragment and
 * never reaches a server — which is the only way a tool with no backend can
 * offer sharing at all.
 */
export function encodeShare(state: ShareState): string {
  const byTier = new Map<string, string[]>(state.tiers.map(t => [t.id, []]));
  for (const [item, at] of state.placement) {
    byTier.get(at)?.push(item);
  }
  const wire: WireState = {
    v: 1,
    m: state.mode,
    s: state.subject,
    t: state.title,
    r: state.tiers.map(t => [t.name, t.swatch, ...(byTier.get(t.id) ?? [])]),
    c: state.custom.map(c => [c.id, c.name, c.icons, c.cards])
  };
  return toBase64Url(JSON.stringify(wire));
}

/** Returns null for anything that is not a payload this version wrote. */
export function decodeShare(encoded: string): ShareState | null {
  const wire = parseWire(encoded);
  if (!wire) {
    return null;
  }
  const tiers: Tier[] = [];
  const placement = new Map<string, string>();
  for (const row of wire.r) {
    const [name, swatchId, ...ids] = row;
    const tier = makeTier(name ?? '', swatchId ?? 'neutral-stone');
    tiers.push(tier);
    for (const id of ids) {
      placement.set(id, tier.id);
    }
  }
  return {
    mode: wire.m,
    subject: wire.s,
    title: wire.t,
    tiers: tiers.length > 0 ? tiers : defaultTiers(),
    placement,
    custom: wire.c.map(([id, name, icons, cards]) => ({ id, name, icons, cards }))
  };
}

function parseWire(encoded: string): WireState | null {
  try {
    const parsed = JSON.parse(fromBase64Url(encoded)) as Partial<WireState>;
    if (parsed?.v !== 1 || !Array.isArray(parsed.r)) {
      return null;
    }
    return {
      v: 1,
      m: parsed.m ?? 'icons',
      s: parsed.s ?? '',
      t: parsed.t ?? '',
      r: parsed.r,
      c: Array.isArray(parsed.c) ? parsed.c : []
    };
  } catch {
    return null;
  }
}

/** Base64url over UTF-8, so card names with accents survive the round trip. */
function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/[=]+$/, '');
}

function fromBase64Url(encoded: string): string {
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/** How many suggestions a typeahead offers at once. */
export const SUGGESTION_LIMIT = 8;

/**
 * Ranks a list against a query: a prefix match outranks a match anywhere else,
 * and within each group the heavier entry comes first. That is what makes "r"
 * offer Rare Candy (14 arts) before Riolu (3) — the card you actually meant.
 */
export function rankByQuery<T>(
  list: readonly T[],
  query: string,
  name: (item: T) => string,
  weight: (item: T) => number = () => 0,
  limit: number = SUGGESTION_LIMIT
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return list.slice(0, limit);
  }
  return list
    .map(item => ({ item, at: name(item).toLowerCase().indexOf(q) }))
    .filter(hit => hit.at >= 0)
    .sort(
      (a, b) =>
        (a.at === 0 ? 0 : 1) - (b.at === 0 ? 0 : 1) ||
        weight(b.item) - weight(a.item) ||
        name(a.item).localeCompare(name(b.item))
    )
    .slice(0, limit)
    .map(hit => hit.item);
}
