/**
 * event-cli rebake: rolling-canonical rebuild of an event's card-facing
 * artifacts from stored decks. The Boss's Orders fixture walks the same
 * cluster the acceptance spec pins in rolling-canonical.test.ts — the same
 * decks rebaked at three event dates must key (and display) three different
 * canonicals while every key still resolves to one global cluster identity.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { rebakeFromDecks } from '../../.github/scripts/event-cli.ts';
import type { SynonymDatabase } from '../../shared/data/cardIdentity.ts';

const MEG_UID = "Boss's Orders::MEG::114";

const DB: SynonymDatabase = {
  synonyms: {
    "Boss's Orders::BRS::132": MEG_UID,
    "Boss's Orders::PAL::172": MEG_UID,
    "Boss's Orders::PAL::248": MEG_UID,
    "Boss's Orders::ASC::183": MEG_UID
  },
  canonicals: { "Boss's Orders": MEG_UID },
  prints: {
    "Boss's Orders::BRS::132": 0.44,
    "Boss's Orders::PAL::172": 0.32,
    "Boss's Orders::PAL::248": 11.18,
    "Boss's Orders::MEG::114": 0.25,
    "Boss's Orders::ASC::183": 0.23
  }
};

// Two decks running different printings of the same card; one made Day 2 + top cut.
const decks = [
  {
    archetype: 'Gardevoir ex',
    madePhase2: true,
    madeTopCut: true,
    cards: [
      { name: "Boss's Orders", set: 'PAL', number: '248', count: 1 },
      { name: "Boss's Orders", set: 'BRS', number: '132', count: 1 }
    ]
  },
  {
    archetype: 'Charizard ex',
    madePhase2: false,
    madeTopCut: false,
    cards: [{ name: "Boss's Orders", set: 'PAL', number: '172', count: 2 }]
  }
];

function masterOf(
  bodies: Map<string, unknown>,
  path = 'master.json'
): {
  items: { name?: string; uid?: string; set?: string; number?: string; found: number }[];
  canonicalizedAt?: string;
} {
  return bodies.get(path) as ReturnType<typeof masterOf>;
}

test('rebake keys master/usage/conversion by the rolling canonical of the event date', () => {
  const at2024 = rebakeFromDecks(decks, DB, '2024-09-13');
  const master = masterOf(at2024);
  assert.equal(master.canonicalizedAt, '2024-09-13');
  const boss = master.items.find(item => item.name === "Boss's Orders" || item.uid?.startsWith("Boss's Orders"));
  assert.ok(boss, 'merged Boss item present');
  // Baltimore 2024: BRS 132 is the oldest legal accessible print.
  assert.equal(boss.uid, "Boss's Orders::BRS::132");
  // Display fields derive from the rolling canonical, so period-correct art shows.
  assert.equal(boss.set, 'BRS');
  assert.equal(boss.number, '132');
  // Both variants in deck 1 collapse to one row: found = 2 decks.
  assert.equal(boss.found, 2);

  const usage = at2024.get('cardUsage.json') as { usage: Record<string, unknown>; canonicalizedAt?: string };
  assert.ok(usage.usage["Boss's Orders::BRS::132"], 'usage keyed by rolling canonical');
  assert.equal(usage.canonicalizedAt, '2024-09-13');

  const conversion = at2024.get('conversion.json') as {
    cards: Record<string, { day1: number; day2: number }>;
    canonicalizedAt?: string;
  };
  assert.deepEqual(conversion.cards["Boss's Orders::BRS::132"], { day1: 2, day2: 1 });
  assert.equal(conversion.canonicalizedAt, '2024-09-13');
});

test('the same decks rebaked at later events roll to later canonicals', () => {
  const at2025 = rebakeFromDecks(decks, DB, '2025-09-13');
  assert.ok((at2025.get('cardUsage.json') as { usage: Record<string, unknown> }).usage["Boss's Orders::PAL::172"]);
  const at2026 = rebakeFromDecks(decks, DB, '2026-06-12');
  assert.ok((at2026.get('cardUsage.json') as { usage: Record<string, unknown> }).usage[MEG_UID]);
  // Cluster identity is stable: every rolling key resolves to the same global canonical.
  for (const bodies of [at2025, at2026]) {
    const [key] = Object.keys((bodies.get('cardUsage.json') as { usage: Record<string, unknown> }).usage);
    assert.equal(DB.synonyms[key] ?? key, MEG_UID);
  }
});

test('event-date price overrides change the accessibility outcome', () => {
  // At Monterrey 2025 the PAL 172 print supposedly spiked; with the event-date
  // price override striking it, the cheap ASC print is not yet legal and the
  // pricey PAL 248 is out of cap — but 172 remains the only accessible print
  // when its historical price was actually low. Verify the override is applied:
  // price 172 out of reach, so 248 (11.18) vs 172 (50) -> cap picks 248.
  const bodies = rebakeFromDecks(decks, DB, '2025-09-13', { "Boss's Orders::PAL::172": 50 });
  const usage = bodies.get('cardUsage.json') as { usage: Record<string, unknown> };
  assert.ok(usage.usage["Boss's Orders::PAL::248"], 'override redirects the rolling canonical');
});

test('rebake emits slice masters with markers and skips slice cardUsage', () => {
  const bodies = rebakeFromDecks(decks, DB, '2024-09-13');
  const phase2 = masterOf(bodies, 'slices/phase2/master.json');
  assert.equal(phase2.canonicalizedAt, '2024-09-13');
  assert.equal(phase2.items[0].found, 1);
  assert.ok(bodies.get('slices/topcut/master.json'), 'topcut slice present');
  assert.ok(bodies.get('slices/phase2/archetypes/Gardevoir_ex/cards.json'), 'slice archetype cards present');
  assert.equal(bodies.get('slices/phase2/cardUsage.json'), undefined, 'slices publish no cardUsage');
});
