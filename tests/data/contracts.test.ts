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
  computeSuccessTags,
  deckId,
  eventId,
  labsParticipantId,
  makeArchetypeIdentity,
  matchId,
  type NormalizedEvent,
  onlineParticipantId,
  parseCardIdentity,
  validateCardRecord,
  validateNormalizedEvent
} from '../../shared/data/contracts.ts';
import { canonicalStringify } from '../../shared/data/canonicalJson.ts';
import { sha256Hex } from '../../shared/data/hash.ts';

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

test('both fixtures validate', () => {
  for (const [label, event] of [
    ['labs-event', labs],
    ['online-window', online]
  ] as const) {
    const result = validateNormalizedEvent(event);
    assert.deepStrictEqual(result.ok ? [] : result.errors, [], label);
  }
});

test('the fixtures exercise the representability cases the validators must accept', () => {
  // Guard the guard: these are the shapes the validation test above proves
  // representable, so the fixtures must keep carrying them.
  const richDeck = labs.decks.find(deck => deck.participantId === 'labs:0001:103');
  assert.ok(richDeck);
  // A canonical rewrite may differ from its source printing set/number.
  const rareCandy = richDeck.cards.find(card => card.canonical.name === 'Rare Candy');
  assert.ok(rareCandy);
  assert.strictEqual(rareCandy.canonical.number, '256');
  assert.strictEqual(rareCandy.printings[0].number, '191');
  // Two synonym printings of one card collapse into a single deck card.
  const pidgeot = richDeck.cards.find(card => card.canonical.name === 'Pidgeot ex');
  assert.ok(pidgeot);
  assert.strictEqual(pidgeot.printings.length, 2);
  assert.strictEqual(pidgeot.count, 2);

  // Labs source fields present on Labs participants and meta.
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

  // ...and absent (not null) on online participants.
  const acelia = online.participants[0] as unknown as Record<string, unknown>;
  assert.strictEqual('points' in acelia, false);
  assert.strictEqual('icons' in acelia, false);
  assert.strictEqual('dropRound' in acelia, false);
});

// ============================================================================
// Invariant violations — every mutation must be rejected
// ============================================================================

interface Violation {
  name: string;
  /** Returns a fresh fixture clone that breaks exactly one invariant. */
  build: () => NormalizedEvent;
  needle: string;
}

const VIOLATIONS: Violation[] = [
  {
    name: 'duplicate deckId',
    build: () => {
      const event = clone(labs);
      event.decks[1].deckId = event.decks[0].deckId;
      return event;
    },
    needle: 'duplicate stable id'
  },
  {
    name: 'duplicate participantId',
    build: () => {
      const event = clone(labs);
      event.participants[1].participantId = event.participants[0].participantId;
      return event;
    },
    needle: 'duplicate stable id'
  },
  {
    name: 'dangling deck.participantId reference',
    build: () => {
      const event = clone(labs);
      event.decks[0].participantId = 'labs:0001:999';
      return event;
    },
    needle: 'unresolved participant'
  },
  {
    name: 'dangling participant.deckId reference',
    build: () => {
      const event = clone(labs);
      event.participants[0].deckId = 'sha256:deadbeef';
      return event;
    },
    needle: 'unresolved deck'
  },
  {
    name: 'placement below 1',
    build: () => {
      const event = clone(labs);
      event.participants[0].placement = 0;
      return event;
    },
    needle: 'placement'
  },
  {
    name: 'canonical set/number disagreeing with UID',
    build: () => {
      const event = clone(labs);
      event.decks[0].cards[0].canonical.set = 'XXX';
      return event;
    },
    needle: 'does not match UID set'
  },
  {
    name: 'an unparseable canonical UID',
    build: () => {
      const event = clone(labs);
      event.decks[0].cards[0].canonical.uid = 'Name::ONLYTWO';
      return event;
    },
    needle: 'unparseable UID'
  },
  {
    name: 'a non-canonical (unpadded) card number',
    build: () => {
      const event = clone(labs);
      const card = event.decks[0].cards[0];
      card.canonical.uid = 'Gardevoir ex::SVI::86';
      card.canonical.number = '86';
      return event;
    },
    needle: 'not canonical padded form'
  },
  {
    name: 'the same canonical card counted twice in one deck',
    build: () => {
      const event = clone(labs);
      event.decks[0].cards.push(clone(event.decks[0].cards[0]));
      return event;
    },
    needle: 'counted more than once'
  },
  {
    name: 'a card count below 1',
    build: () => {
      const event = clone(labs);
      event.decks[0].cards[0].count = 0;
      return event;
    },
    needle: 'count'
  },
  {
    name: 'an invalid match outcome',
    build: () => {
      const event = clone(labs);
      event.matches[0].outcome = 'victory' as NormalizedEvent['matches'][number]['outcome'];
      return event;
    },
    needle: 'invalid outcome'
  },
  {
    name: 'an unresolved match participant',
    build: () => {
      const event = clone(labs);
      event.matches[0].participantIds[0] = 'labs:0001:999';
      return event;
    },
    needle: 'unresolved participant'
  },
  {
    name: 'a decided match with no winner',
    build: () => {
      const event = clone(labs);
      event.matches[0].winnerParticipantId = null;
      return event;
    },
    needle: 'required for a decided match'
  },
  {
    name: 'an archetype slug not derived from the key',
    build: () => {
      const event = clone(labs);
      event.decks[0].archetype.slug = 'wrong-slug';
      return event;
    },
    needle: 'does not match derived slug'
  },
  {
    name: 'a wrong top-level schemaVersion',
    build: () => {
      const event = clone(labs);
      event.schemaVersion = 2;
      return event;
    },
    needle: 'schemaVersion'
  },
  {
    name: 'a solo outcome carrying two participants',
    build: () => {
      const event = clone(labs);
      event.matches[0].outcome = 'bye';
      event.matches[0].winnerParticipantId = null;
      return event;
    },
    needle: 'requires exactly 1 participant'
  },
  {
    name: 'a pair outcome carrying one participant',
    build: () => {
      const event = clone(labs);
      const solo = event.matches.find(match => match.outcome === 'bye' || match.outcome === 'unpaired');
      assert.ok(solo);
      solo.outcome = 'tie';
      return event;
    },
    needle: 'requires exactly 2 participants'
  },
  {
    name: 'a winner named on a non-decided outcome',
    build: () => {
      const event = clone(labs);
      event.matches[0].outcome = 'tie';
      return event;
    },
    needle: 'forbidden for outcome'
  },
  {
    name: 'a winner who is not a match participant',
    build: () => {
      const event = clone(labs);
      event.matches[0].winnerParticipantId = event.matches[1].participantIds[0];
      return event;
    },
    needle: 'not a match participant'
  },
  {
    name: 'negative or non-integer win/loss/tie counts',
    build: () => {
      const event = clone(labs);
      event.participants[0].record.wins = -1;
      return event;
    },
    needle: 'record.wins: expected a non-negative integer'
  },
  {
    name: 'non-boolean participant flags',
    build: () => {
      const event = clone(labs);
      (event.participants[0].flags as unknown as Record<string, unknown>).madePhase2 = 'true';
      return event;
    },
    needle: 'flags.madePhase2: expected boolean'
  },
  {
    name: 'out-of-range opponent win percentages',
    build: () => {
      const event = clone(labs);
      event.participants[0].opwPct = 240;
      return event;
    },
    needle: 'opwPct: expected a finite number in [0, 100] or null'
  },
  {
    name: 'an unpadded number on a printing (not just the canonical)',
    build: () => {
      const event = clone(labs);
      const withPrinting = event.decks
        .flatMap(deck => deck.cards)
        .find(card => card.printings.length > 0 && card.printings[0].number.startsWith('0'));
      assert.ok(withPrinting);
      const printing = withPrinting.printings[0];
      const stripped = printing.number.replace(/^0+/, '');
      printing.uid = `${printing.name}::${printing.set}::${stripped}`;
      printing.number = stripped;
      return event;
    },
    needle: 'not canonical padded form'
  },
  {
    name: 'a printing whose name disagrees with its UID',
    build: () => {
      const event = clone(labs);
      const card = event.decks.flatMap(deck => deck.cards).find(candidate => candidate.printings.length > 0);
      assert.ok(card);
      card.printings[0].name = `${card.printings[0].name}X`;
      return event;
    },
    needle: 'does not match UID name'
  },
  {
    name: 'a broken deck<->participant back-reference',
    build: () => {
      const event = clone(labs);
      const [a, b] = event.participants.filter(participant => participant.deckId);
      assert.ok(a && b);
      a.deckId = b.deckId;
      return event;
    },
    needle: 'back-references participant'
  },
  {
    name: 'two decks claiming the same participant',
    build: () => {
      const event = clone(labs);
      event.decks[1].participantId = event.decks[0].participantId;
      return event;
    },
    needle: 'claimed by more than one deck'
  },
  {
    name: 'successTags that disagree with the frozen policy',
    build: () => {
      const event = clone(online);
      event.decks[0].successTags = [...event.decks[0].successTags, 'phase2'];
      return event;
    },
    needle: 'does not match policy recomputation'
  },
  {
    name: 'decks stored out of canonical ascending order',
    build: () => {
      const event = clone(labs);
      const sorted = [...event.decks].sort((a, b) => (a.deckId < b.deckId ? -1 : 1));
      event.decks = [sorted[sorted.length - 1], ...sorted.slice(0, -1)];
      // Re-point participants at their decks unchanged; only storage order moved.
      return event;
    },
    needle: 'not in canonical ascending order'
  },
  {
    name: 'trainer/energy subtype fields on the wrong category',
    build: () => {
      const event = clone(labs);
      const pokemon = event.decks.flatMap(deck => deck.cards).find(card => card.category === 'pokemon');
      assert.ok(pokemon);
      (pokemon as unknown as Record<string, unknown>).trainerType = 'supporter';
      return event;
    },
    needle: 'only allowed when category is "trainer"'
  },
  {
    name: 'an invalid regulation mark',
    build: () => {
      const event = clone(labs);
      (event.decks[0].cards[0] as unknown as Record<string, unknown>).regulationMark = 'h';
      return event;
    },
    needle: 'single uppercase letter'
  },
  {
    name: 'negative match points',
    build: () => {
      const event = clone(labs);
      event.participants[0].points = -1;
      return event;
    },
    needle: 'points: expected a non-negative integer or null'
  },
  {
    name: 'non-integer match points',
    build: () => {
      const event = clone(labs);
      event.participants[0].points = 12.5;
      return event;
    },
    needle: 'points: expected a non-negative integer or null'
  },
  {
    name: 'an icons entry that is an empty string',
    build: () => {
      const event = clone(labs);
      event.participants[0].icons = ['gardevoir', ''];
      return event;
    },
    needle: 'icons[1]: expected a non-empty string'
  },
  {
    name: 'icons that is not an array',
    build: () => {
      const event = clone(labs);
      (event.participants[0] as unknown as Record<string, unknown>).icons = 'gardevoir';
      return event;
    },
    needle: 'icons: expected an array of non-empty strings'
  },
  {
    name: 'a dropRound on a participant that did not drop',
    build: () => {
      const event = clone(labs);
      // Alice (index 0) has flags.dropped === false.
      assert.strictEqual(event.participants[0].flags.dropped, false);
      event.participants[0].dropRound = 3;
      return event;
    },
    needle: 'non-null dropRound requires flags.dropped to be true'
  },
  {
    name: 'a dropRound below 1',
    build: () => {
      const event = clone(labs);
      event.participants[4].dropRound = 0;
      return event;
    },
    needle: 'dropRound: expected integer >= 1 or null'
  },
  {
    name: 'an empty labsDeckId string',
    build: () => {
      const event = clone(labs);
      event.participants[0].labsDeckId = '';
      return event;
    },
    needle: 'labsDeckId: expected a non-empty string or null'
  },
  {
    name: 'a non-boolean meta.completed',
    build: () => {
      const event = clone(labs);
      (event.meta as unknown as Record<string, unknown>).completed = 'yes';
      return event;
    },
    needle: 'completed: expected boolean or null'
  },
  {
    name: 'a negative meta.playersRound1',
    build: () => {
      const event = clone(labs);
      event.meta.playersRound1 = -1;
      return event;
    },
    needle: 'playersRound1: expected a non-negative integer or null'
  },
  {
    name: 'an empty meta.labsCode string',
    build: () => {
      const event = clone(labs);
      event.meta.labsCode = '';
      return event;
    },
    needle: 'labsCode: expected a non-empty string or null'
  },
  {
    name: 'a round below 1',
    build: () => {
      const event = clone(labs);
      event.matches[0].round = 0;
      return event;
    },
    needle: 'round: expected integer >= 1'
  },
  {
    name: 'a string phase',
    build: () => {
      const event = clone(labs);
      (event.matches[0] as unknown as Record<string, unknown>).phase = '2';
      return event;
    },
    needle: 'phase: expected integer >= 1'
  },
  {
    name: 'a non-integer table',
    build: () => {
      const event = clone(labs);
      (event.matches[0] as unknown as Record<string, unknown>).table = 'foo';
      return event;
    },
    needle: 'table: expected integer >= 1 or null'
  },
  {
    name: 'match data on an online window',
    build: () => {
      const event = clone(online);
      const pair = [event.participants[0].participantId, event.participants[1].participantId];
      event.matches = [
        {
          schemaVersion: 1,
          matchId: matchId(1, 1, pair),
          round: 1,
          phase: 1,
          table: 1,
          participantIds: pair,
          outcome: 'tie',
          winnerParticipantId: null,
          completed: true
        }
      ];
      return event;
    },
    needle: 'online windows must have an empty matches array'
  }
];

test('every contract invariant violation is rejected with a matching error', () => {
  for (const violation of VIOLATIONS) {
    const result = validateNormalizedEvent(violation.build());
    const errors = result.ok ? [] : result.errors;
    assert.ok(
      errors.some(error => error.includes(violation.needle)),
      `${violation.name}: expected an error containing "${violation.needle}", got:\n${errors.join('\n')}`
    );
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

// ============================================================================
// Archetype identity
// ============================================================================

test('casing, punctuation, and whitespace variants share key and slug but keep their display name', () => {
  const groups: Array<[string[], string, string]> = [
    [['Gardevoir ex', 'gardevoir EX'], 'gardevoir ex', 'gardevoir-ex'],
    [['Charizard Pidgeot', 'charizard_PIDGEOT', 'Charizard  Pidgeot'], 'charizard pidgeot', 'charizard-pidgeot']
  ];
  for (const [variants, key, slug] of groups) {
    for (const name of variants) {
      const identity = makeArchetypeIdentity(name);
      assert.strictEqual(identity.key, key, name);
      assert.strictEqual(identity.slug, slug, name);
      assert.strictEqual(identity.displayName, name);
    }
  }
});

test('archetypeSlug derives from the key, empties fall back to unknown', () => {
  assert.strictEqual(archetypeSlug(archetypeKey('')), 'unknown');
  assert.strictEqual(archetypeSlug(archetypeKey('Raging Bolt ex')), 'raging-bolt-ex');
});

// ============================================================================
// Card identity parsing
// ============================================================================

test('parseCardIdentity round-trips canonical and bare-name UIDs', () => {
  assert.deepStrictEqual(parseCardIdentity('Comfey::SIT::TG15'), { name: 'Comfey', set: 'SIT', number: 'TG15' });
  assert.deepStrictEqual(parseCardIdentity('Basic Fire Energy'), {
    name: 'Basic Fire Energy',
    set: null,
    number: null
  });
  assert.strictEqual(parseCardIdentity('Bad::Two'), null);
});

// ============================================================================
// Success tags
// ============================================================================

test('computeSuccessTags matches the frozen policy, appending phase tags only for Labs events', () => {
  const labsTags = computeSuccessTags(1, 24, { madePhase2: true, madeTopCut: true, appendPhaseTags: true });
  assert.deepStrictEqual(labsTags, ['winner', 'top2', 'top4', 'top8', 'top10', 'top25', 'top50', 'phase2', 'topcut']);
  const onlineTags = computeSuccessTags(1, 24, { madePhase2: true, madeTopCut: true, appendPhaseTags: false });
  assert.deepStrictEqual(onlineTags, ['winner', 'top2', 'top4', 'top8', 'top10', 'top25', 'top50']);
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
// ID constructors and serialization edge cases
// ============================================================================

test('ID constructors reject degenerate and delimiter-bearing inputs', () => {
  assert.throws(() => eventId('labs-event', ''), TypeError);
  assert.throws(() => eventId('labs-event', '   '), TypeError);
  assert.throws(() => labsParticipantId('labs:0001', Number.NaN), TypeError);
  assert.throws(() => onlineParticipantId('online:w1', 'a|b'), TypeError);
  assert.throws(() => matchId(Number.NaN, 1, ['labs:0001:101']), TypeError);
  assert.throws(() => matchId(1, 1, ['a|b', 'c']), TypeError);
});

test('canonicalStringify honors toJSON like JSON.stringify (Dates do not collide)', () => {
  const a = canonicalStringify({ at: new Date('2026-07-12T00:00:00Z') });
  const b = canonicalStringify({ at: new Date('2026-07-13T00:00:00Z') });
  assert.notStrictEqual(a, b);
  assert.strictEqual(a, '{"at":"2026-07-12T00:00:00.000Z"}');
});

// --- validateCardRecord (card catalog "cards table") ---

test('validateCardRecord accepts identity-only and fully-populated structured records', () => {
  const records: Array<[string, unknown]> = [
    ['minimal', { metadataVersion: 2, cardType: 'trainer', fullType: 'Trainer - Item' }],
    [
      'full Pokémon',
      {
        metadataVersion: 2,
        cardType: 'pokemon',
        subType: null,
        evolutionInfo: 'Stage 2 - Evolves from Kirlia',
        fullType: 'Pokémon - Stage 2 - Evolves from Kirlia',
        stage: 'stage2',
        mechanicSubtypes: ['ex'],
        regulationMark: 'H',
        hp: 320,
        pokemonType: 'Psychic',
        weakness: { type: 'Metal', modifier: '×2' },
        resistance: { type: 'Fighting', modifier: '-30' },
        retreatCost: 2,
        abilityDetails: [{ name: 'Psychic Embrace', effect: 'Attach energy.' }],
        attackDetails: [{ cost: 'PP', name: 'Miracle Force', damage: '190', effect: null }],
        legality: { standard: 'legal' },
        lastUpdated: '2026-07-14T00:00:00.000Z'
      }
    ]
  ];
  for (const [label, record] of records) {
    const result = validateCardRecord(record);
    assert.deepStrictEqual(result.ok ? [] : result.errors, [], label);
  }
});

test('validateCardRecord rejects a non-object and records missing identity fields', () => {
  const cases: Array<[unknown, string]> = [
    [{ cardType: 'pokemon', fullType: 'x' }, 'metadataVersion'],
    [{ metadataVersion: 2, cardType: 'creature', fullType: 'x' }, 'cardType'],
    [null, 'root: expected object']
  ];
  for (const [record, prefix] of cases) {
    const result = validateCardRecord(record);
    assert.ok(!result.ok && result.errors.some(error => error.startsWith(prefix)), prefix);
  }
});

test('validateCardRecord rejects out-of-vocabulary stage/mechanic and malformed weakness', () => {
  const bad = validateCardRecord({
    metadataVersion: 2,
    cardType: 'pokemon',
    fullType: 'Pokémon - Basic',
    stage: 'stage3',
    mechanicSubtypes: ['GX'],
    weakness: { type: '', modifier: 5 },
    regulationMark: 'HH',
    hp: -10
  });
  assert.equal(bad.ok, false);
  assert.ok(!bad.ok);
  assert.ok(bad.errors.some(e => e.startsWith('stage')));
  assert.ok(bad.errors.some(e => e.startsWith('mechanicSubtypes')));
  assert.ok(bad.errors.some(e => e.startsWith('weakness')));
  assert.ok(bad.errors.some(e => e.startsWith('regulationMark')));
  assert.ok(bad.errors.some(e => e.startsWith('hp')));
});
