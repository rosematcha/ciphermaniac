/**
 * Canonical card-page URL resolution — the ONE resolver for `/cards/:set/:number`.
 *
 * Three distinct identity concepts exist in this codebase and must not be
 * conflated:
 *
 * - **Global canonical UID** — `Name::SET::NUMBER`, stable cross-event card
 *   identity. Produced by {@link getCanonicalCardFromData}. Aggregation joins
 *   on this.
 * - **Rolling canonical UID** — the printing a *historical event* presents,
 *   re-chosen per event date ({@link module:shared/data/canonicalPrint}). Still
 *   a member of the same global cluster.
 * - **Card route** — the `(set, number)` pair in the browser URL. This module.
 *   It is the global canonical's set/number, name-erased.
 *
 * The route layer erases the card NAME, so it is a projection of the UID graph
 * and can degrade independently of it: a UID graph that is perfectly acyclic
 * can still project onto a cyclic route graph if two clusters' variant/canonical
 * pairs collide on `(set, number)`.
 *
 * The invariant this module owns:
 *
 * > Resolving any card printing to its canonical card-page URL must terminate
 * > at one stable representative. Resolving the representative again must
 * > produce the same representative.
 *
 * Two halves enforce it:
 *
 * 1. {@link buildCanonicalRouteIndex} collapses chains and drops cycle edges,
 *    so runtime resolution is terminal and idempotent BY CONSTRUCTION even if
 *    the synonym DB is malformed. A broken cluster degrades to "no redirect"
 *    (a 200 on a variant URL), never to a 301 loop.
 * 2. {@link findCanonicalRouteViolations} reports the same defects so the
 *    synonym-DB generator and CI can FAIL rather than ship a repaired-in-the-
 *    reader graph. Silent repair is what let the cycle live in production.
 *
 * Isomorphic: browser, Node, and Cloudflare Workers all import this. No
 * environment-specific dependencies.
 * @module shared/data/canonicalCardRoute
 */

import { cardNumberIndexKey, parseCardUid, type SynonymDatabase } from './cardIdentity';

/**
 * A resolved canonical card route.
 *
 * `key` is the internal comparison key; `set`/`number` are the raw canonical
 * UID's fields, which is what belongs in a URL (the canonical UID's own
 * spelling, e.g. `PRE`/`073`, not the zero-stripped key form).
 */
export interface CanonicalCardRoute {
  /** Internal comparison key, `SET::NUMBERKEY`. */
  key: string;
  /** Set code as spelled in the canonical UID. */
  set: string;
  /** Card number as spelled in the canonical UID. */
  number: string;
}

/** Variant route key → the canonical route it redirects to. Never self-mapping. */
export type CanonicalRouteIndex = ReadonlyMap<string, CanonicalCardRoute>;

/**
 * Build the internal comparison key for a `(set, number)` pair.
 *
 * Uses the zero-STRIPPED form ({@link cardNumberIndexKey}) so `TWM/130`,
 * `TWM/0130`, and `TWM/00130` are one key, and `18a`/`018A` agree. Both sides
 * of every comparison go through here, so the padded-vs-stripped choice is
 * internal — it never reaches a URL.
 * @param set - Set code, any casing
 * @param number - Card number, any zero padding or suffix casing
 * @returns The route key, or empty string when either half is missing
 */
export function cardRouteKey(set: string | null | undefined, number: string | number | null | undefined): string {
  const s = (set ?? '').toString().trim().toUpperCase();
  if (!s) {
    return '';
  }
  const n = number === null || number === undefined ? '' : cardNumberIndexKey(number);
  if (!n) {
    return '';
  }
  return `${s}::${n}`;
}

/** One `variant route key → canonical route key` edge, with its source UIDs. */
interface RouteEdge {
  from: string;
  to: string;
  toSet: string;
  toNumber: string;
  variantUid: string;
  canonicalUid: string;
}

function collectRouteEdges(db: Pick<SynonymDatabase, 'synonyms'> | null | undefined): RouteEdge[] {
  const synonyms = db?.synonyms;
  if (!synonyms) {
    return [];
  }
  const edges: RouteEdge[] = [];
  for (const [variantUid, canonicalUid] of Object.entries(synonyms)) {
    if (typeof canonicalUid !== 'string') {
      continue;
    }
    const variant = parseCardUid(variantUid);
    const canonical = parseCardUid(canonicalUid);
    if (!variant || !canonical) {
      continue;
    }
    const from = cardRouteKey(variant.set, variant.number);
    const to = cardRouteKey(canonical.set, canonical.number);
    if (!from || !to) {
      continue;
    }
    edges.push({
      from,
      to,
      toSet: canonical.set,
      toNumber: canonical.number,
      variantUid,
      canonicalUid
    });
  }
  // Deterministic order: the index and the violation report must not depend on
  // `Object.entries` insertion order of a JSON parse.
  edges.sort((a, b) =>
    a.from === b.from
      ? a.to === b.to
        ? a.variantUid < b.variantUid
          ? -1
          : a.variantUid > b.variantUid
            ? 1
            : 0
        : a.to < b.to
          ? -1
          : 1
      : a.from < b.from
        ? -1
        : 1
  );
  return edges;
}

/**
 * Reduce the route edges to one outgoing edge per variant key.
 *
 * When several synonym entries project onto the same variant key with different
 * canonical routes (an {@link CanonicalRouteViolations.ambiguous} defect), the
 * lexicographically smallest canonical key wins. Any deterministic rule works;
 * what matters is that the edge function and the SPA pick the SAME one, or one
 * 301s to a target the other immediately wants to leave.
 */
function reduceToSingleEdges(edges: RouteEdge[]): Map<string, RouteEdge> {
  const chosen = new Map<string, RouteEdge>();
  for (const edge of edges) {
    if (edge.from === edge.to) {
      // The variant IS the canonical print (different name, same set/number, or
      // a self-mapping). No redirect; recording it would be a 301 to self.
      continue;
    }
    const existing = chosen.get(edge.from);
    if (!existing || edge.to < existing.to) {
      chosen.set(edge.from, edge);
    }
  }
  return chosen;
}

/**
 * Walk `start` to its terminal route, or report the cycle it falls into.
 * @returns The terminal edge, or `null` when the walk revisits a node
 */
function walkToTerminal(
  start: string,
  edges: Map<string, RouteEdge>
): { edge: RouteEdge | null; cycle: string[] | null } {
  const seen = new Set<string>([start]);
  const path = [start];
  let current = start;
  let edge = edges.get(current);
  if (!edge) {
    return { edge: null, cycle: null };
  }
  while (edge) {
    const next = edge.to;
    if (seen.has(next)) {
      // Trim the lead-in so the reported cycle is the loop itself.
      const loopStart = path.indexOf(next);
      return { edge: null, cycle: [...path.slice(loopStart), next] };
    }
    seen.add(next);
    path.push(next);
    current = next;
    const nextEdge = edges.get(current);
    if (!nextEdge) {
      return { edge, cycle: null };
    }
    edge = nextEdge;
  }
  return { edge: null, cycle: null };
}

/**
 * Build the variant-route → canonical-route index used by both the edge
 * redirect (`functions/cards/[set]/[number].ts`) and the SPA
 * (`src/lib/data.ts:resolveCanonicalSetNumber`).
 *
 * Guarantees, regardless of how malformed the input DB is:
 * - No entry maps a key to itself, so a hit always means "redirect needed".
 * - No entry's target is itself a key, so one lookup is terminal — resolution
 *   is idempotent and the 301 graph has depth 1.
 * - Keys whose cluster contains a route cycle are OMITTED, degrading to "serve
 *   the variant URL" instead of looping. {@link findCanonicalRouteViolations}
 *   is what makes that loud.
 * @param db - Synonym database (only `synonyms` is read)
 * @returns Variant route key → terminal canonical route
 */
export function buildCanonicalRouteIndex(
  db: Pick<SynonymDatabase, 'synonyms'> | null | undefined
): CanonicalRouteIndex {
  const edges = reduceToSingleEdges(collectRouteEdges(db));
  const index = new Map<string, CanonicalCardRoute>();
  for (const from of edges.keys()) {
    const { edge } = walkToTerminal(from, edges);
    if (!edge || edge.to === from) {
      continue;
    }
    index.set(from, { key: edge.to, set: edge.toSet, number: edge.toNumber });
  }
  return index;
}

/**
 * Resolve a requested `(set, number)` to its canonical route.
 * @param index - Index from {@link buildCanonicalRouteIndex}
 * @param set - Requested set code
 * @param number - Requested card number
 * @returns The canonical route, or `null` when the request is already canonical
 * or unknown (both mean "do not redirect")
 */
export function resolveCanonicalRoute(
  index: CanonicalRouteIndex,
  set: string | null | undefined,
  number: string | number | null | undefined
): CanonicalCardRoute | null {
  const key = cardRouteKey(set, number);
  if (!key) {
    return null;
  }
  return index.get(key) ?? null;
}

/**
 * Resolve a `(set, number)` to the comparison key of its cluster representative.
 *
 * Unlike {@link resolveCanonicalRoute} this is total: an already-canonical or
 * unknown pair maps to its own key. Lets callers compare two printings of one
 * cluster — e.g. a rolling-canonical master item against a global-canonical
 * URL — without importing any date logic.
 * @param index - Index from {@link buildCanonicalRouteIndex}
 * @param set - Set code
 * @param number - Card number
 * @returns The representative route key (own key when already canonical)
 */
export function canonicalRouteKey(
  index: CanonicalRouteIndex,
  set: string | null | undefined,
  number: string | number | null | undefined
): string {
  const key = cardRouteKey(set, number);
  return index.get(key)?.key ?? key;
}

/** A route-graph defect found by {@link findCanonicalRouteViolations}. */
export interface CanonicalRouteViolations {
  /**
   * Route cycles, each listed as the loop's keys with the entry key repeated at
   * the end (`['TWM::130', 'PRE::73', 'TWM::130']`). A cycle 301-loops the
   * browser; this is the defect the invariant exists to prevent.
   */
  cycles: string[][];
  /**
   * Edges whose target is itself a variant key — a multi-hop redirect. Not a
   * loop, but resolution is not idempotent: the first 301 lands somewhere that
   * immediately 301s again.
   */
  nonTerminal: Array<{ from: string; to: string; then: string }>;
  /**
   * Variant keys reached by synonym entries that disagree about the canonical
   * route. Only possible when two card NAMES share a `(set, number)`; the index
   * breaks the tie deterministically, but the underlying data is wrong.
   */
  ambiguous: Array<{ from: string; targets: string[] }>;
}

/**
 * Audit a synonym DB's card-route projection for the defects
 * {@link buildCanonicalRouteIndex} silently repairs at read time.
 *
 * Call this at PRODUCTION time — synonym-DB generation and CI — and fail on any
 * non-empty result. Repairing in the reader keeps users out of redirect loops;
 * failing here is what keeps the repair from becoming permanent.
 * @param db - Synonym database (only `synonyms` is read)
 * @returns The defects found; all three arrays empty means the graph is sound
 */
export function findCanonicalRouteViolations(
  db: Pick<SynonymDatabase, 'synonyms'> | null | undefined
): CanonicalRouteViolations {
  const allEdges = collectRouteEdges(db);

  // A self-edge (`from === to`) is a real claim: "this route IS its own
  // canonical". Skipping it here — as an earlier version did — hid the case
  // where one synonym entry makes that claim while another redirects the same
  // route elsewhere, so the conflict went unreported AND the reader silently
  // redirected a card away from its own page. Record the self-target so it can
  // contradict a redirect.
  const targetsByFrom = new Map<string, Set<string>>();
  for (const edge of allEdges) {
    let targets = targetsByFrom.get(edge.from);
    if (!targets) {
      targets = new Set<string>();
      targetsByFrom.set(edge.from, targets);
    }
    targets.add(edge.to);
  }
  const ambiguous: CanonicalRouteViolations['ambiguous'] = [];
  for (const [from, targets] of targetsByFrom) {
    if (targets.size > 1) {
      ambiguous.push({ from, targets: [...targets].sort() });
    }
  }
  ambiguous.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));

  const edges = reduceToSingleEdges(allEdges);

  const cycles: string[][] = [];
  const seenCycle = new Set<string>();
  const inCycle = new Set<string>();
  for (const from of edges.keys()) {
    const { cycle } = walkToTerminal(from, edges);
    if (!cycle) {
      continue;
    }
    for (const node of cycle) {
      inCycle.add(node);
    }
    // Canonicalize the loop by its smallest member so each cycle is reported
    // once no matter which node the walk entered from.
    const loop = cycle.slice(0, -1);
    const fingerprint = [...loop].sort().join('|');
    if (seenCycle.has(fingerprint)) {
      continue;
    }
    seenCycle.add(fingerprint);
    const pivot = loop.indexOf([...loop].sort()[0]);
    const rotated = [...loop.slice(pivot), ...loop.slice(0, pivot)];
    cycles.push([...rotated, rotated[0]]);
  }
  cycles.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  // Categories are disjoint: every edge in a cycle is trivially non-terminal
  // too, and reporting it twice buries the loop in chain noise.
  const nonTerminal: CanonicalRouteViolations['nonTerminal'] = [];
  for (const [from, edge] of edges) {
    if (inCycle.has(from)) {
      continue;
    }
    const next = edges.get(edge.to);
    if (next) {
      nonTerminal.push({ from, to: edge.to, then: next.to });
    }
  }
  nonTerminal.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));

  return { cycles, nonTerminal, ambiguous };
}

/**
 * Throw a human-readable error if the DB's card-route projection is unsound.
 *
 * Intended for artifact generation and CI: shipping a synonym DB whose route
 * graph loops is worse than shipping no update.
 * @param db - Synonym database (only `synonyms` is read)
 * @param context - Label used in the thrown message (e.g. the artifact key)
 * @throws {Error} When any cycle, non-terminal redirect, or ambiguous route exists
 */
export function assertCanonicalRoutesSound(
  db: Pick<SynonymDatabase, 'synonyms'> | null | undefined,
  context = 'card synonym database'
): void {
  const { cycles, nonTerminal, ambiguous } = findCanonicalRouteViolations(db);
  if (!cycles.length && !nonTerminal.length && !ambiguous.length) {
    return;
  }
  const lines: string[] = [`${context}: canonical card-route graph is unsound.`];
  if (cycles.length) {
    lines.push(`  ${cycles.length} redirect cycle(s):`);
    for (const cycle of cycles.slice(0, 10)) {
      lines.push(`    ${cycle.join(' -> ')}`);
    }
  }
  if (nonTerminal.length) {
    lines.push(`  ${nonTerminal.length} non-terminal redirect(s):`);
    for (const hop of nonTerminal.slice(0, 10)) {
      lines.push(`    ${hop.from} -> ${hop.to} -> ${hop.then}`);
    }
  }
  if (ambiguous.length) {
    lines.push(`  ${ambiguous.length} ambiguous route(s):`);
    for (const entry of ambiguous.slice(0, 10)) {
      lines.push(`    ${entry.from} -> {${entry.targets.join(', ')}}`);
    }
  }
  throw new Error(lines.join('\n'));
}
