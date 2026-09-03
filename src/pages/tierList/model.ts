/**
 * Tier List Maker state, kept free of Solid so it unit-tests under plain
 * `node:test`.
 *
 * Three ideas carry the whole model:
 *
 * - **Placement keys off a tier's id, never its index.** Moving a tier has to
 *   carry its contents with it; keying by position swaps two rows' worth of
 *   items instead.
 * - **Placement is an ordered list per zone**, not a lookup from item to tier.
 *   Where an item sits inside its tier is part of the ranking — dropping a card
 *   at the front of S means something — and a plain item→tier map throws that
 *   away.
 * - **State is the only authority.** The drag layer moves real DOM for
 *   smoothness but puts it back before committing, because the board is
 *   rendered by a framework that owns those nodes: leaving a node reparented
 *   makes the next render produce a duplicate.
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

/** Zone key for the unranked tray. Tiers use their own ids. */
export const TRAY = 'tray';

/** Zone key → the item ids it holds, in the order the user put them in. */
export type Placement = ReadonlyMap<string, readonly string[]>;

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
  placement: Placement,
  id: string
): { tiers: Tier[]; placement: Map<string, string[]> } {
  const next = clone(placement);
  if (tiers.length <= 1) {
    return { tiers: [...tiers], placement: next };
  }
  next.delete(id);
  return { tiers: tiers.filter(t => t.id !== id), placement: next };
}

const clone = (placement: Placement): Map<string, string[]> =>
  new Map([...placement].map(([zone, ids]) => [zone, [...ids]]));

/**
 * Moves an item to `zone` at `index`, removing it from wherever it was.
 *
 * The removal runs across every zone rather than only the one the item came
 * from: a shared link or a stale render can leave the same id listed twice, and
 * a drop is the natural place to make that impossible.
 */
export function withDroppedItem(
  placement: Placement,
  itemId: string,
  zone: string,
  index: number
): Map<string, string[]> {
  const next = clone(placement);
  for (const [key, ids] of next) {
    const at = ids.indexOf(itemId);
    if (at >= 0) {
      ids.splice(at, 1);
      if (ids.length === 0 && key !== zone) {
        next.delete(key);
      }
    }
  }
  const list = next.get(zone) ?? [];
  list.splice(Math.max(0, Math.min(index, list.length)), 0, itemId);
  next.set(zone, list);
  return next;
}

/**
 * Writes the tray's rendered order into `placement`.
 *
 * The tray renders as its stored list followed by every item that has never
 * been placed, so the stored list is normally far shorter than what the user is
 * looking at — empty, on a board nobody has touched. A drop index counted off
 * the screen means nothing against it: {@link withDroppedItem} clamps to the
 * list it is handed, so a tile released at position eight of a thirty-nine
 * item tray landed at position zero. That is why the tray would let you move
 * something up but never down.
 *
 * Pinning the visible order first makes the two the same list, after which an
 * index means what it says. Called only when the tray is the destination; a
 * tier's stored list is already everything it renders.
 */
export function withPinnedTray(placement: Placement, order: readonly string[]): Map<string, string[]> {
  const next = clone(placement);
  next.set(TRAY, [...order]);
  return next;
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
  placement: Placement
): { buckets: Map<string, TierItem[]>; tray: TierItem[] } {
  const byId = new Map(items.map(item => [item.id, item]));
  const buckets = new Map<string, TierItem[]>();
  const spoken = new Set<string>();

  const take = (zone: string): TierItem[] => {
    const list: TierItem[] = [];
    for (const id of placement.get(zone) ?? []) {
      const item = byId.get(id);
      // An id with no item is a tier holding something the current view does
      // not show — a shared archetype list opened on the card-arts tab, say.
      if (item && !spoken.has(id)) {
        spoken.add(id);
        list.push(item);
      }
    }
    return list;
  };

  for (const tier of tiers) {
    buckets.set(tier.id, take(tier.id));
  }
  // Anything never placed joins the tray in the order the view supplies, after
  // whatever the user has explicitly arranged there.
  const tray = take(TRAY);
  for (const item of items) {
    if (!spoken.has(item.id)) {
      tray.push(item);
    }
  }
  return { buckets, tray };
}

/**
 * Renaming a custom archetype changes its item id, so its placement has to be
 * carried across or the archetype drops back to the tray on the next render.
 */
export function withRenamedPlacement(placement: Placement, from: string, to: string): Map<string, string[]> {
  const next = clone(placement);
  for (const ids of next.values()) {
    const at = ids.indexOf(from);
    if (at >= 0) {
      ids.splice(at, 1, to);
    }
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
  /** Zone key → ordered item ids. Absence from every zone means unranked. */
  placement: Map<string, string[]>;
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
export function encodeShare(state: Omit<ShareState, 'placement'> & { placement: Placement }): string {
  const wire: WireState = {
    v: 1,
    m: state.mode,
    s: state.subject,
    t: state.title,
    r: state.tiers.map(t => [t.name, t.swatch, ...(state.placement.get(t.id) ?? [])]),
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
  const placement = new Map<string, string[]>();
  for (const row of wire.r) {
    const [name, swatchId, ...ids] = row;
    const tier = makeTier(name ?? '', swatchId ?? 'neutral-stone');
    tiers.push(tier);
    if (ids.length > 0) {
      placement.set(tier.id, ids);
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
