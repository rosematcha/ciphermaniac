/**
 * tests/data/contracts.test.ts
 * Golden-fixture and invariant tests for the normalized-layer data contract.
 * Proves representability of both sources, that every invariant violation is
 * caught, deterministic/permutation-invariant serialization, archetype identity
 * derivation, and stable content-addressed IDs (with snapshotted hashes).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  archetypeKey,
  archetypeSlug,
  cardUid,
  computeSuccessTags,
  deckId,
  eventId,
  labsParticipantId,
  makeArchetypeIdentity,
  matchId,
  type NormalizedEvent,
  onlineParticipantId,
  parseCardUid,
  validateNormalizedEvent
} from '../../shared/data/contracts.ts';
import { canonicalStringify } from '../../shared/data/canonicalJson.ts';
import { sha256Hex } from '../../shared/data/hash.ts';
import { normalizeCardNumber } from '../../shared/cardUtils.ts';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'data-pipeline');

function loadFixture(name: string): NormalizedEvent {
  return JSON.parse(readFileSync(join(fixturesDir, name), 'utf8')) as NormalizedEvent;
}

const labs = loadFixture('labs-event.json');
const online = loadFixture('online-window.json');

/** Deep clone that works for our JSON-shaped fixtures. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ============================================================================
// Representability
// ============================================================================

test('labs-event fixture validates', () => {
  const result = validateNormalizedEvent(labs);
  assert.deepStrictEqual(result.ok ? [] : result.errors, []);
  assert.strictEqual(result.ok, true);
});

test('online-window fixture validates', () => {
  const result = validateNormalizedEvent(online);
  assert.deepStrictEqual(result.ok ? [] : result.errors, []);
  assert.strictEqual(result.ok, true);
});

test('online-window carries no match data (structural asymmetry)', () => {
  assert.deepStrictEqual(online.matches, []);
});

test('a canonical rewrite may differ from its source printing set/number', () => {
  const richDeck = labs.decks.find(deck => deck.participantId === 'labs:0001:103');
  assert.ok(richDeck);
  const rareCandy = richDeck.cards.find(card => card.canonical.name === 'Rare Candy');
  assert.ok(rareCandy);
  assert.strictEqual(rareCandy.canonical.number, '256');
  assert.strictEqual(rareCandy.printings[0].number, '191');
  assert.notStrictEqual(rareCandy.canonical.number, rareCandy.printings[0].number);
});

test('two synonym printings of one card collapse into a single deck card', () => {
  const richDeck = labs.decks.find(deck => deck.participantId === 'labs:0001:103');
  assert.ok(richDeck);
  const pidgeot = richDeck.cards.find(card => card.canonical.name === 'Pidgeot ex');
  assert.ok(pidgeot);
  assert.strictEqual(pidgeot.printings.length, 2);
  assert.strictEqual(pidgeot.count, 2);
});

// ============================================================================
// Invariant violations — every mutation must be rejected
// ============================================================================

/** Assert a pre-mutated event fails validation with an error matching `needle`. */
function assertRejects(mutated: NormalizedEvent, needle: string): void {
  const result = validateNormalizedEvent(mutated);
  assert.strictEqual(result.ok, false, `expected validation failure containing "${needle}"`);
  if (!result.ok) {
    assert.ok(
      result.errors.some(error => error.includes(needle)),
      `expected an error containing "${needle}", got:\n${result.errors.join('\n')}`
    );
  }
}

test('rejects duplicate deckId', () => {
  const event = clone(labs);
  event.decks[1].deckId = event.decks[0].deckId;
  assertRejects(event, 'duplicate stable id');
});

test('rejects duplicate participantId', () => {
  const event = clone(labs);
  event.participants[1].participantId = event.participants[0].participantId;
  assertRejects(event, 'duplicate stable id');
});

test('rejects dangling deck.participantId reference', () => {
  const event = clone(labs);
  event.decks[0].participantId = 'labs:0001:999';
  assertRejects(event, 'unresolved participant');
});

test('rejects dangling participant.deckId reference', () => {
  const event = clone(labs);
  event.participants[0].deckId = 'sha256:deadbeef';
  assertRejects(event, 'unresolved deck');
});

test('rejects placement below 1', () => {
  const event = clone(labs);
  event.participants[0].placement = 0;
  assertRejects(event, 'placement');
});

test('rejects canonical set/number disagreeing with UID', () => {
  const event = clone(labs);
  event.decks[0].cards[0].canonical.set = 'XXX';
  assertRejects(event, 'does not match UID set');
});

test('rejects an unparseable canonical UID', () => {
  const event = clone(labs);
  event.decks[0].cards[0].canonical.uid = 'Name::ONLYTWO';
  assertRejects(event, 'unparseable UID');
});

test('rejects a non-canonical (unpadded) card number', () => {
  const event = clone(labs);
  const card = event.decks[0].cards[0];
  card.canonical.uid = 'Gardevoir ex::SVI::86';
  card.canonical.number = '86';
  assertRejects(event, 'not canonical padded form');
});

test('rejects the same canonical card counted twice in one deck', () => {
  const event = clone(labs);
  event.decks[0].cards.push(clone(event.decks[0].cards[0]));
  assertRejects(event, 'counted more than once');
});

test('rejects a card count below 1', () => {
  const event = clone(labs);
  event.decks[0].cards[0].count = 0;
  assertRejects(event, 'count');
});

test('rejects an invalid match outcome', () => {
  const event = clone(labs);
  event.matches[0].outcome = 'victory' as NormalizedEvent['matches'][number]['outcome'];
  assertRejects(event, 'invalid outcome');
});

test('rejects an unresolved match participant', () => {
  const event = clone(labs);
  event.matches[0].participantIds[0] = 'labs:0001:999';
  assertRejects(event, 'unresolved participant');
});

test('rejects a decided match with no winner', () => {
  const event = clone(labs);
  event.matches[0].winnerParticipantId = null;
  assertRejects(event, 'required for a decided match');
});

test('rejects an archetype slug not derived from the key', () => {
  const event = clone(labs);
  event.decks[0].archetype.slug = 'wrong-slug';
  assertRejects(event, 'does not match derived slug');
});

test('rejects a wrong top-level schemaVersion', () => {
  const event = clone(labs);
  event.schemaVersion = 2;
  assertRejects(event, 'schemaVersion');
});

test('rejects match data on an online window', () => {
  const mutated = clone(online);
  mutated.matches = [
    {
      schemaVersion: 1,
      matchId: matchId(1, 1, [online.participants[0].participantId, online.participants[1].participantId]),
      round: 1,
      phase: 1,
      table: 1,
      participantIds: [online.participants[0].participantId, online.participants[1].participantId],
      outcome: 'tie',
      winnerParticipantId: null,
      completed: true
    }
  ];
  const result = validateNormalizedEvent(mutated);
  assert.strictEqual(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.some(error => error.includes('online windows must have an empty matches array')));
  }
});

test('collects all errors rather than stopping at the first', () => {
  const mutated = clone(labs);
  mutated.participants[0].placement = 0;
  mutated.decks[0].cards[0].canonical.set = 'XXX';
  mutated.matches[0].outcome = 'victory' as NormalizedEvent['matches'][number]['outcome'];
  const result = validateNormalizedEvent(mutated);
  assert.strictEqual(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.length >= 3, `expected >=3 errors, got ${result.errors.length}`);
  }
});

// ============================================================================
// Determinism and permutation behavior
// ============================================================================

test('canonicalStringify is byte-identical regardless of key insertion order', () => {
  const first = { b: 1, a: { d: 4, c: 3 }, e: [1, 2, 3] };
  const second = { e: [1, 2, 3], a: { c: 3, d: 4 }, b: 1 };
  assert.strictEqual(canonicalStringify(first), canonicalStringify(second));
  assert.strictEqual(sha256Hex(first), sha256Hex(second));
});

test('deckId ignores card order (unordered collection)', () => {
  const deck = labs.decks[2];
  const shuffled = [...deck.cards].reverse();
  assert.strictEqual(
    deckId(deck.participantId, shuffled, sha256Hex),
    deckId(deck.participantId, deck.cards, sha256Hex)
  );
});

test('matchId ignores participant order but honors round/phase', () => {
  const a = 'labs:0001:101';
  const b = 'labs:0001:102';
  assert.strictEqual(matchId(1, 1, [a, b]), matchId(1, 1, [b, a]));
  assert.notStrictEqual(matchId(1, 1, [a, b]), matchId(2, 1, [a, b]));
});

test('meaningful array order changes the serialization', () => {
  const swapped = clone(labs);
  const [first, second] = [swapped.participants[0], swapped.participants[1]];
  swapped.participants[0] = second;
  swapped.participants[1] = first;
  assert.notStrictEqual(canonicalStringify(swapped), canonicalStringify(labs));
});

test('reserializing a fixture is byte-identical', () => {
  const rebuilt = clone(labs);
  assert.strictEqual(canonicalStringify(rebuilt), canonicalStringify(labs));
});

// ============================================================================
// Archetype identity
// ============================================================================

test('casing variants share key and slug, preserve display name', () => {
  const a = makeArchetypeIdentity('Gardevoir ex');
  const b = makeArchetypeIdentity('gardevoir EX');
  assert.strictEqual(a.key, 'gardevoir ex');
  assert.strictEqual(b.key, 'gardevoir ex');
  assert.strictEqual(a.slug, 'gardevoir-ex');
  assert.strictEqual(b.slug, 'gardevoir-ex');
  assert.strictEqual(a.displayName, 'Gardevoir ex');
  assert.strictEqual(b.displayName, 'gardevoir EX');
});

test('punctuation and whitespace variants share key and slug', () => {
  const variants = ['Charizard Pidgeot', 'charizard_PIDGEOT', 'Charizard  Pidgeot'];
  const identities = variants.map(name => makeArchetypeIdentity(name));
  for (const identity of identities) {
    assert.strictEqual(identity.key, 'charizard pidgeot');
    assert.strictEqual(identity.slug, 'charizard-pidgeot');
  }
  assert.deepStrictEqual(
    identities.map(identity => identity.displayName),
    variants
  );
});

test('archetypeSlug derives from the key, empties fall back to unknown', () => {
  assert.strictEqual(archetypeSlug(archetypeKey('')), 'unknown');
  assert.strictEqual(archetypeSlug(archetypeKey('Raging Bolt ex')), 'raging-bolt-ex');
});

// ============================================================================
// Card identity normalization (SVI/1 vs svi/001, 18a, TG15)
// ============================================================================

test('card numbers normalize to canonical padded form', () => {
  assert.strictEqual(normalizeCardNumber('1'), '001');
  assert.strictEqual(normalizeCardNumber('18a'), '018A');
  assert.strictEqual(normalizeCardNumber('TG15'), 'TG15');
});

test('SVI/1 and svi/001 resolve to the same canonical UID', () => {
  assert.strictEqual(cardUid('Pikachu ex', 'SVI', '1'), cardUid('Pikachu ex', 'svi', '001'));
  assert.strictEqual(cardUid('Pikachu ex', 'SVI', '1'), 'Pikachu ex::SVI::001');
});

test('parseCardUid round-trips canonical and bare-name UIDs', () => {
  assert.deepStrictEqual(parseCardUid('Comfey::SIT::TG15'), { name: 'Comfey', set: 'SIT', number: 'TG15' });
  assert.deepStrictEqual(parseCardUid('Basic Fire Energy'), { name: 'Basic Fire Energy', set: null, number: null });
  assert.strictEqual(parseCardUid('Bad::Two'), null);
});

// ============================================================================
// Success tags
// ============================================================================

test('computeSuccessTags matches the frozen policy (Labs event appends phase tags)', () => {
  const tags = computeSuccessTags(1, 24, { madePhase2: true, madeTopCut: true, appendPhaseTags: true });
  assert.deepStrictEqual(tags, ['winner', 'top2', 'top4', 'top8', 'top10', 'top25', 'top50', 'phase2', 'topcut']);
});

test('computeSuccessTags omits phase tags for online windows', () => {
  const tags = computeSuccessTags(1, 24, { madePhase2: true, madeTopCut: true, appendPhaseTags: false });
  assert.ok(!tags.includes('phase2'));
  assert.ok(!tags.includes('topcut'));
});

// ============================================================================
// ID stability — snapshot exact hashes so algorithm drift fails loudly
// ============================================================================

test('deckId hashes are stable and match the fixtures', () => {
  const expected: Record<string, string> = {
    'labs:0001:101': 'sha256:a96f81c1516231d3a715f619b5ba8b889bafc0d7e7527d6da084d054213a8040',
    'labs:0001:102': 'sha256:30fa59238bb2ff819cc74eded0649a191ba55dfae3b964f93880704506e76d2f',
    'labs:0001:103': 'sha256:d02c08aee3cae463bd67d2ead6506fe3957024e60fba87fa498a59fd87dccc35',
    'labs:0001:104': 'sha256:fb1923168e6e551c90134ea316d36d982588e2b16b1557c9e65f9a0642b3892c'
  };
  for (const deck of labs.decks) {
    const computed = deckId(deck.participantId, deck.cards, sha256Hex);
    assert.strictEqual(computed, deck.deckId);
    assert.strictEqual(computed, expected[deck.participantId]);
  }
});

test('matchId keys are stable and match the fixtures', () => {
  const expected = [
    'r1:p1:labs:0001:101|labs:0001:102',
    'r1:p1:labs:0001:103|labs:0001:104',
    'r2:p2:labs:0001:101|labs:0001:102',
    'r2:p2:solo:labs:0001:103',
    'r2:p2:solo:labs:0001:105'
  ];
  assert.deepStrictEqual(
    labs.matches.map(match => match.matchId),
    expected
  );
  for (const match of labs.matches) {
    assert.strictEqual(matchId(match.round, match.phase, match.participantIds), match.matchId);
  }
});

// ============================================================================
// Validator strictness — checks added by the contracts review
// ============================================================================

test('rejects a solo outcome carrying two participants', () => {
  const event = clone(labs);
  event.matches[0].outcome = 'bye';
  event.matches[0].winnerParticipantId = null;
  assertRejects(event, 'requires exactly 1 participant');
});

test('rejects a pair outcome carrying one participant', () => {
  const event = clone(labs);
  const solo = event.matches.find(match => match.outcome === 'bye' || match.outcome === 'unpaired');
  assert.ok(solo);
  solo.outcome = 'tie';
  assertRejects(event, 'requires exactly 2 participants');
});

test('rejects a winner named on a non-decided outcome', () => {
  const event = clone(labs);
  event.matches[0].outcome = 'tie';
  assertRejects(event, 'forbidden for outcome');
});

test('rejects a winner who is not a match participant', () => {
  const event = clone(labs);
  event.matches[0].winnerParticipantId = event.matches[1].participantIds[0];
  assertRejects(event, 'not a match participant');
});

test('rejects non-integer or below-1 round/phase/table', () => {
  const roundZero = clone(labs);
  roundZero.matches[0].round = 0;
  assertRejects(roundZero, 'round: expected integer >= 1');

  const stringPhase = clone(labs);
  (stringPhase.matches[0] as unknown as Record<string, unknown>).phase = '2';
  assertRejects(stringPhase, 'phase: expected integer >= 1');

  const badTable = clone(labs);
  (badTable.matches[0] as unknown as Record<string, unknown>).table = 'foo';
  assertRejects(badTable, 'table: expected integer >= 1 or null');
});

test('rejects negative or non-integer win/loss/tie counts', () => {
  const event = clone(labs);
  event.participants[0].record.wins = -1;
  assertRejects(event, 'record.wins: expected a non-negative integer');
});

test('rejects non-boolean participant flags', () => {
  const event = clone(labs);
  (event.participants[0].flags as unknown as Record<string, unknown>).madePhase2 = 'true';
  assertRejects(event, 'flags.madePhase2: expected boolean');
});

test('rejects out-of-range opponent win percentages', () => {
  const event = clone(labs);
  event.participants[0].opwPct = 240;
  assertRejects(event, 'opwPct: expected a finite number in [0, 100] or null');
});

test('rejects an unpadded number on a printing (not just the canonical)', () => {
  const event = clone(labs);
  const withPrinting = event.decks
    .flatMap(deck => deck.cards)
    .find(card => card.printings.length > 0 && card.printings[0].number.startsWith('0'));
  assert.ok(withPrinting);
  const printing = withPrinting.printings[0];
  const stripped = printing.number.replace(/^0+/, '');
  printing.uid = `${printing.name}::${printing.set}::${stripped}`;
  printing.number = stripped;
  assertRejects(event, 'not canonical padded form');
});

test('rejects a printing whose name disagrees with its UID', () => {
  const event = clone(labs);
  const card = event.decks.flatMap(deck => deck.cards).find(candidate => candidate.printings.length > 0);
  assert.ok(card);
  card.printings[0].name = `${card.printings[0].name}X`;
  assertRejects(event, 'does not match UID name');
});

test('rejects a broken deck<->participant back-reference', () => {
  const event = clone(labs);
  const [a, b] = event.participants.filter(participant => participant.deckId);
  assert.ok(a && b);
  a.deckId = b.deckId;
  assertRejects(event, 'back-references participant');
});

test('rejects two decks claiming the same participant', () => {
  const event = clone(labs);
  event.decks[1].participantId = event.decks[0].participantId;
  assertRejects(event, 'claimed by more than one deck');
});

test('rejects successTags that disagree with the frozen policy', () => {
  const event = clone(online);
  event.decks[0].successTags = [...event.decks[0].successTags, 'phase2'];
  assertRejects(event, 'does not match policy recomputation');
});

test('rejects decks stored out of canonical ascending order', () => {
  const event = clone(labs);
  const sorted = [...event.decks].sort((a, b) => (a.deckId < b.deckId ? -1 : 1));
  event.decks = [sorted[sorted.length - 1], ...sorted.slice(0, -1)];
  // Re-point participants at their decks unchanged; only storage order moved.
  assertRejects(event, 'not in canonical ascending order');
});

test('rejects trainer/energy subtype fields on the wrong category', () => {
  const event = clone(labs);
  const pokemon = event.decks.flatMap(deck => deck.cards).find(card => card.category === 'pokemon');
  assert.ok(pokemon);
  (pokemon as unknown as Record<string, unknown>).trainerType = 'supporter';
  assertRejects(event, 'only allowed when category is "trainer"');
});

test('rejects an invalid regulation mark', () => {
  const event = clone(labs);
  (event.decks[0].cards[0] as unknown as Record<string, unknown>).regulationMark = 'h';
  assertRejects(event, 'single uppercase letter');
});

test('ID constructors reject degenerate and delimiter-bearing inputs', () => {
  assert.throws(() => eventId('labs-event', ''), TypeError);
  assert.throws(() => eventId('labs-event', '   '), TypeError);
  assert.throws(() => labsParticipantId('labs:0001', Number.NaN), TypeError);
  assert.throws(() => onlineParticipantId('online:w1', 'a|b'), TypeError);
  assert.throws(() => matchId(Number.NaN, 1, ['labs:0001:101']), TypeError);
  assert.throws(() => matchId(1, 1, ['a|b', 'c']), TypeError);
});

// ============================================================================
// Labs source fields — points / icons / dropRound / labsDeckId / deckName / meta
// ============================================================================

test('labs fixture carries the new Labs source fields', () => {
  const alice = labs.participants.find(participant => participant.participantId === 'labs:0001:101');
  assert.ok(alice);
  assert.strictEqual(alice.points, 18);
  assert.deepStrictEqual(alice.icons, ['gardevoir']);
  assert.strictEqual(alice.labsDeckId, 'labs-deck-77');
  assert.strictEqual(alice.deckName, 'Gardevoir ex');
  // labsDeckId is source-assigned and distinct from the content-hash deckId.
  assert.notStrictEqual(alice.labsDeckId, alice.deckId);

  const evan = labs.participants.find(participant => participant.participantId === 'labs:0001:105');
  assert.ok(evan);
  assert.strictEqual(evan.flags.dropped, true);
  assert.strictEqual(evan.dropRound, 6);

  assert.strictEqual(labs.meta.country, 'US');
  assert.strictEqual(labs.meta.completed, true);
  assert.strictEqual(labs.meta.playersRound1, 24);
  assert.strictEqual(labs.meta.decklistCount, 4);
  assert.strictEqual(labs.meta.labsCode, '0001');
});

test('online-window validates with all Labs source fields absent', () => {
  // Absence (not null) must be accepted by the validators.
  const acelia = online.participants[0] as unknown as Record<string, unknown>;
  assert.strictEqual('points' in acelia, false);
  assert.strictEqual('icons' in acelia, false);
  assert.strictEqual('dropRound' in acelia, false);
  const result = validateNormalizedEvent(online);
  assert.strictEqual(result.ok, true);
});

test('rejects negative match points', () => {
  const event = clone(labs);
  event.participants[0].points = -1;
  assertRejects(event, 'points: expected a non-negative integer or null');
});

test('rejects non-integer match points', () => {
  const event = clone(labs);
  event.participants[0].points = 12.5;
  assertRejects(event, 'points: expected a non-negative integer or null');
});

test('rejects an icons entry that is an empty string', () => {
  const event = clone(labs);
  event.participants[0].icons = ['gardevoir', ''];
  assertRejects(event, 'icons[1]: expected a non-empty string');
});

test('rejects icons that is not an array', () => {
  const event = clone(labs);
  (event.participants[0] as unknown as Record<string, unknown>).icons = 'gardevoir';
  assertRejects(event, 'icons: expected an array of non-empty strings');
});

test('rejects a dropRound on a participant that did not drop', () => {
  const event = clone(labs);
  // Alice (index 0) has flags.dropped === false.
  assert.strictEqual(event.participants[0].flags.dropped, false);
  event.participants[0].dropRound = 3;
  assertRejects(event, 'non-null dropRound requires flags.dropped to be true');
});

test('rejects a dropRound below 1', () => {
  const event = clone(labs);
  event.participants[4].dropRound = 0;
  assertRejects(event, 'dropRound: expected integer >= 1 or null');
});

test('rejects an empty labsDeckId string', () => {
  const event = clone(labs);
  event.participants[0].labsDeckId = '';
  assertRejects(event, 'labsDeckId: expected a non-empty string or null');
});

test('rejects a non-boolean meta.completed', () => {
  const event = clone(labs);
  (event.meta as unknown as Record<string, unknown>).completed = 'yes';
  assertRejects(event, 'completed: expected boolean or null');
});

test('rejects a negative meta.playersRound1', () => {
  const event = clone(labs);
  event.meta.playersRound1 = -1;
  assertRejects(event, 'playersRound1: expected a non-negative integer or null');
});

test('rejects an empty meta.labsCode string', () => {
  const event = clone(labs);
  event.meta.labsCode = '';
  assertRejects(event, 'labsCode: expected a non-empty string or null');
});

test('canonicalStringify honors toJSON like JSON.stringify (Dates do not collide)', () => {
  const a = canonicalStringify({ at: new Date('2026-07-12T00:00:00Z') });
  const b = canonicalStringify({ at: new Date('2026-07-13T00:00:00Z') });
  assert.notStrictEqual(a, b);
  assert.strictEqual(a, '{"at":"2026-07-12T00:00:00.000Z"}');
});
