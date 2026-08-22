/**
 * Canonical card-route invariants (DB-MASTER-PLAN Phase 1 correctness work).
 *
 * The property under test, stated once:
 *
 *   Resolving any card printing to its canonical card-page URL must terminate
 *   at one stable representative. Resolving the representative again must
 *   produce the same representative.
 *
 * These are graph properties, so they are tested as graph properties over the
 * whole synonym DB rather than as a handful of example URLs — the TWM/130 <->
 * PRE/073 loop that motivated this module was one instance of a class.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertCanonicalRoutesSound,
  buildCanonicalRouteIndex,
  canonicalRouteKey,
  cardRouteKey,
  findCanonicalRouteViolations,
  resolveCanonicalRoute
} from '../../shared/data/canonicalCardRoute.ts';
import { normalizeSynonymDatabase, type SynonymDatabase } from '../../shared/data/cardIdentity.ts';

function db(synonyms: Record<string, string>, canonicals: Record<string, string> = {}): SynonymDatabase {
  return { synonyms, canonicals };
}

/** Every printing the DB knows about, as `(set, number)` route inputs. */
function allRouteInputs(database: SynonymDatabase): Array<{ set: string; number: string }> {
  const seen = new Set<string>();
  const out: Array<{ set: string; number: string }> = [];
  for (const [variant, canonical] of Object.entries(database.synonyms)) {
    for (const uid of [variant, canonical]) {
      const parts = uid.split('::');
      if (parts.length < 3) {
        continue;
      }
      const set = parts[parts.length - 2];
      const number = parts[parts.length - 1];
      const key = cardRouteKey(set, number);
      if (key && !seen.has(key)) {
        seen.add(key);
        out.push({ set, number });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Key normalization
// ---------------------------------------------------------------------------

test('cardRouteKey collapses casing and zero padding but not promo suffixes', () => {
  assert.equal(cardRouteKey('twm', '130'), 'TWM::130');
  assert.equal(cardRouteKey('TWM', '0130'), 'TWM::130');
  assert.equal(cardRouteKey('TWM', 130), 'TWM::130');
  assert.equal(cardRouteKey('pal', '018a'), 'PAL::18A');
  assert.equal(cardRouteKey('PAL', '18A'), 'PAL::18A');
  assert.notEqual(cardRouteKey('PAL', '185'), cardRouteKey('PAL', '185a'));
  assert.equal(cardRouteKey('CRZ', 'GG05'), 'CRZ::GG05');
});

test('cardRouteKey rejects half-specified routes', () => {
  assert.equal(cardRouteKey('', '130'), '');
  assert.equal(cardRouteKey('TWM', ''), '');
  assert.equal(cardRouteKey(null, null), '');
  assert.equal(cardRouteKey(undefined, '130'), '');
});

// ---------------------------------------------------------------------------
// The core invariant, on hand-built graphs
// ---------------------------------------------------------------------------

test('a single-hop variant resolves to its canonical', () => {
  const index = buildCanonicalRouteIndex(db({ 'Dragapult ex::TWM::130': 'Dragapult ex::PRE::073' }));
  assert.deepEqual(resolveCanonicalRoute(index, 'TWM', '130'), { key: 'PRE::73', set: 'PRE', number: '073' });
});

test('resolution is idempotent: the representative does not redirect', () => {
  const index = buildCanonicalRouteIndex(db({ 'Dragapult ex::TWM::130': 'Dragapult ex::PRE::073' }));
  const first = resolveCanonicalRoute(index, 'TWM', '130');
  assert.ok(first);
  assert.equal(resolveCanonicalRoute(index, first.set, first.number), null);
});

test('a reciprocal route pair resolves to a stable representative, never a loop', () => {
  // The production defect, minimized: two names colliding on each other's
  // (set, number). A single-hop reader 301s TWM/130 -> PRE/073 -> TWM/130.
  const index = buildCanonicalRouteIndex(
    db({
      'Dragapult ex::TWM::130': 'Dragapult ex::PRE::073',
      'Dragapult ex::PRE::073': 'Dragapult ex::TWM::130'
    })
  );
  const a = resolveCanonicalRoute(index, 'TWM', '130');
  const b = resolveCanonicalRoute(index, 'PRE', '073');
  // Neither may redirect into something that redirects back.
  for (const hop of [a, b]) {
    if (hop) {
      assert.equal(resolveCanonicalRoute(index, hop.set, hop.number), null, `${hop.set}/${hop.number} redirects again`);
    }
  }
});

test('a cycle degrades to no-redirect rather than a 301 loop', () => {
  const index = buildCanonicalRouteIndex(
    db({
      'A::S1::001': 'A::S2::002',
      'B::S2::002': 'B::S1::001'
    })
  );
  assert.equal(resolveCanonicalRoute(index, 'S1', '001'), null);
  assert.equal(resolveCanonicalRoute(index, 'S2', '002'), null);
});

test('a multi-hop chain collapses to one terminal hop', () => {
  const index = buildCanonicalRouteIndex(
    db({
      'A::S1::001': 'A::S2::002',
      'A::S2::002': 'A::S3::003'
    })
  );
  assert.deepEqual(resolveCanonicalRoute(index, 'S1', '001'), { key: 'S3::3', set: 'S3', number: '003' });
  assert.deepEqual(resolveCanonicalRoute(index, 'S2', '002'), { key: 'S3::3', set: 'S3', number: '003' });
  assert.equal(resolveCanonicalRoute(index, 'S3', '003'), null);
});

test('a variant whose canonical shares its route emits no self-redirect', () => {
  // Different names, same (set, number) — the route layer cannot distinguish
  // them, and a 301 to self is an infinite loop.
  const index = buildCanonicalRouteIndex(db({ 'Old Name::SVI::181': 'New Name::SVI::0181' }));
  assert.equal(resolveCanonicalRoute(index, 'SVI', '181'), null);
});

test('ambiguous routes resolve deterministically regardless of DB key order', () => {
  const forward = buildCanonicalRouteIndex(db({ 'A::S1::001': 'A::S9::009', 'B::S1::001': 'B::S2::002' }));
  const reverse = buildCanonicalRouteIndex(db({ 'B::S1::001': 'B::S2::002', 'A::S1::001': 'A::S9::009' }));
  assert.deepEqual(resolveCanonicalRoute(forward, 'S1', '001'), resolveCanonicalRoute(reverse, 'S1', '001'));
});

test('canonicalRouteKey is total and agrees with resolveCanonicalRoute', () => {
  const index = buildCanonicalRouteIndex(db({ 'A::S1::001': 'A::S2::002' }));
  assert.equal(canonicalRouteKey(index, 'S1', '001'), 'S2::2');
  assert.equal(canonicalRouteKey(index, 'S2', '002'), 'S2::2');
  assert.equal(canonicalRouteKey(index, 'S9', '999'), 'S9::999');
});

test('an empty or absent database yields an empty index', () => {
  assert.equal(buildCanonicalRouteIndex(null).size, 0);
  assert.equal(buildCanonicalRouteIndex(undefined).size, 0);
  assert.equal(buildCanonicalRouteIndex(db({})).size, 0);
});

test('malformed UIDs are skipped, not thrown on', () => {
  const index = buildCanonicalRouteIndex(
    db({
      'no-separators': 'A::S1::001',
      'A::S2::002': 'also-bad',
      'A::S3::003': 'A::S4::004'
    } as Record<string, string>)
  );
  assert.equal(index.size, 1);
  assert.deepEqual(resolveCanonicalRoute(index, 'S3', '003'), { key: 'S4::4', set: 'S4', number: '004' });
});

// ---------------------------------------------------------------------------
// Violation reporting — the production gate
// ---------------------------------------------------------------------------

test('findCanonicalRouteViolations reports a route cycle once, canonically ordered', () => {
  const { cycles, nonTerminal, ambiguous } = findCanonicalRouteViolations(
    db({ 'A::TWM::130': 'A::PRE::073', 'B::PRE::073': 'B::TWM::130' })
  );
  assert.deepEqual(cycles, [['PRE::73', 'TWM::130', 'PRE::73']]);
  assert.equal(nonTerminal.length, 0);
  assert.equal(ambiguous.length, 0);
});

test('findCanonicalRouteViolations reports multi-hop redirects', () => {
  const { cycles, nonTerminal } = findCanonicalRouteViolations(
    db({ 'A::S1::001': 'A::S2::002', 'A::S2::002': 'A::S3::003' })
  );
  assert.equal(cycles.length, 0);
  assert.deepEqual(nonTerminal, [{ from: 'S1::1', to: 'S2::2', then: 'S3::3' }]);
});

test('findCanonicalRouteViolations reports contested route keys', () => {
  const { ambiguous } = findCanonicalRouteViolations(db({ 'A::S1::001': 'A::S9::009', 'B::S1::001': 'B::S2::002' }));
  assert.deepEqual(ambiguous, [{ from: 'S1::1', targets: ['S2::2', 'S9::9'] }]);
});

test('a sound graph reports nothing', () => {
  const violations = findCanonicalRouteViolations(db({ 'A::S1::001': 'A::S3::003', 'A::S2::002': 'A::S3::003' }));
  assert.deepEqual(violations, { cycles: [], nonTerminal: [], ambiguous: [] });
});

test('assertCanonicalRoutesSound throws with the offending routes named', () => {
  assert.throws(
    () => assertCanonicalRoutesSound(db({ 'A::TWM::130': 'A::PRE::073', 'B::PRE::073': 'B::TWM::130' }), 'test DB'),
    (err: Error) => {
      assert.match(err.message, /test DB/);
      assert.match(err.message, /TWM::130/);
      assert.match(err.message, /PRE::73/);
      return true;
    }
  );
  assert.doesNotThrow(() => assertCanonicalRoutesSound(db({ 'A::S1::001': 'A::S2::002' })));
  assert.doesNotThrow(() => assertCanonicalRoutesSound(null));
});

// ---------------------------------------------------------------------------
// Exhaustive cluster properties over a realistic DB shape
// ---------------------------------------------------------------------------

/**
 * A synonym DB shaped like production: several multi-print clusters (including
 * the real Dragapult ex cluster that produced the reported loop), single-print
 * cards, promo suffixes, and a rotated set.
 */
const REALISTIC = normalizeSynonymDatabase(
  db(
    {
      'Dragapult ex::TWM::130': 'Dragapult ex::PRE::073',
      'Dragapult ex::TWM::200': 'Dragapult ex::PRE::073',
      'Dragapult ex::PRE::165': 'Dragapult ex::PRE::073',
      'Dragapult ex::ASC::160': 'Dragapult ex::PRE::073',
      "Boss's Orders::BRS::132": "Boss's Orders::MEG::114",
      "Boss's Orders::PAL::172": "Boss's Orders::MEG::114",
      "Boss's Orders::PAL::248": "Boss's Orders::MEG::114",
      'Nest Ball::SUM::123': 'Nest Ball::SVI::181',
      'Nest Ball::SVI::255': 'Nest Ball::SVI::181',
      'Ultra Ball::BRS::150': 'Ultra Ball::SVI::196',
      'Ultra Ball::SVI::0196A': 'Ultra Ball::SVI::196'
    },
    {
      'Dragapult ex': 'Dragapult ex::PRE::073',
      "Boss's Orders": "Boss's Orders::MEG::114",
      'Nest Ball': 'Nest Ball::SVI::181',
      'Ultra Ball': 'Ultra Ball::SVI::196'
    }
  )
);

test('the realistic DB has a sound route graph', () => {
  assert.deepEqual(findCanonicalRouteViolations(REALISTIC), { cycles: [], nonTerminal: [], ambiguous: [] });
});

test('every known printing resolves in at most one hop (redirect graph has depth 1)', () => {
  const index = buildCanonicalRouteIndex(REALISTIC);
  for (const { set, number } of allRouteInputs(REALISTIC)) {
    const first = resolveCanonicalRoute(index, set, number);
    if (!first) {
      continue;
    }
    const second = resolveCanonicalRoute(index, first.set, first.number);
    assert.equal(second, null, `${set}/${number} -> ${first.set}/${first.number} -> ${second?.set}/${second?.number}`);
  }
});

test('every cluster collapses to exactly one route representative', () => {
  const index = buildCanonicalRouteIndex(REALISTIC);
  const representativesByCluster = new Map<string, Set<string>>();
  for (const [variant, canonical] of Object.entries(REALISTIC.synonyms)) {
    const parts = variant.split('::');
    const rep = canonicalRouteKey(index, parts[parts.length - 2], parts[parts.length - 1]);
    const cluster = canonical;
    const set = representativesByCluster.get(cluster) ?? new Set<string>();
    set.add(rep);
    representativesByCluster.set(cluster, set);
  }
  for (const [cluster, reps] of representativesByCluster) {
    assert.equal(reps.size, 1, `cluster ${cluster} has ${reps.size} route representatives: ${[...reps].join(', ')}`);
  }
});

test('resolving with lowercase and zero-padded input matches the canonical form', () => {
  const index = buildCanonicalRouteIndex(REALISTIC);
  const canonical = resolveCanonicalRoute(index, 'TWM', '130');
  assert.deepEqual(resolveCanonicalRoute(index, 'twm', '0130'), canonical);
  assert.deepEqual(resolveCanonicalRoute(index, 'TwM', '00130'), canonical);
});

test('TWM/130 and PRE/073 do not redirect at each other (regression)', () => {
  const index = buildCanonicalRouteIndex(REALISTIC);
  const twm = resolveCanonicalRoute(index, 'TWM', '130');
  assert.deepEqual(twm, { key: 'PRE::73', set: 'PRE', number: '073' });
  assert.equal(resolveCanonicalRoute(index, 'PRE', '073'), null);
});

test('normalizeSynonymDatabase output always projects onto a sound route graph', () => {
  // Chains, cycles, and a canonical flip-flop — the generator's incremental
  // merge produces all three. The flattened DB must be route-sound too.
  const messy = db({
    'A::S1::001': 'A::S2::002',
    'A::S2::002': 'A::S1::001',
    'A::S3::003': 'A::S2::002',
    'C::S5::005': 'C::S6::006',
    'C::S6::006': 'C::S7::007'
  });
  const flat = normalizeSynonymDatabase(messy);
  assert.deepEqual(findCanonicalRouteViolations(flat), { cycles: [], nonTerminal: [], ambiguous: [] });
});
