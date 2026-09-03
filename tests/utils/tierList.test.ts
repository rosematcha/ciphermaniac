/**
 * tests/utils/tierList.test.ts
 * The Tier List Maker's pure model: tier operations, placement, share
 * encoding, and search ranking. The palette is asserted here too — every
 * swatch has to clear WCAG AA against the text colour it ships with, and that
 * is a property a future hand-edit could silently break.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { AUTO_ORDER, DEFAULT_RAMP, INK, nextSwatchId, PAPER, swatch, SWATCHES } from '../../src/pages/tierList/palette';
import {
  decodeShare,
  defaultTiers,
  distribute,
  encodeShare,
  makeTier,
  rankByQuery,
  type Tier,
  type TierItem,
  withAddedTier,
  withDeletedTier,
  withDroppedItem,
  withEditedTier,
  withMovedTier,
  withRenamedPlacement,
  withTierOrder
} from '../../src/pages/tierList/model';

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

const channel = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(i => channel(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

test('every swatch clears WCAG AA against the text colour it ships with', () => {
  for (const sw of SWATCHES) {
    const ratio = contrast(sw.hex, sw.text);
    assert.ok(ratio >= 4.5, `${sw.id} (${sw.hex} on ${sw.text}) is ${ratio.toFixed(2)}:1`);
  }
});

test('each swatch ships the better of ink and paper', () => {
  for (const sw of SWATCHES) {
    const better = contrast(sw.hex, INK) >= contrast(sw.hex, PAPER) ? INK : PAPER;
    assert.equal(sw.text, better, `${sw.id} should use ${better}`);
  }
});

test('swatch ids are unique, and an unknown id falls back rather than throwing', () => {
  assert.equal(new Set(SWATCHES.map(s => s.id)).size, SWATCHES.length);
  assert.equal(swatch('not-a-swatch').id, 'neutral-stone');
});

test('the auto order covers every swatch outside the default ramp, exactly once', () => {
  const expected = SWATCHES.filter(s => !DEFAULT_RAMP.includes(s.id)).map(s => s.id);
  assert.deepEqual([...AUTO_ORDER].sort(), expected.sort());
});

test('added tiers never reuse a colour that is already on the board', () => {
  // The case that matters: a fourteen-tier board, coloured without the picker.
  const used = [...DEFAULT_RAMP];
  for (let i = 0; i < 8; i++) {
    const next = nextSwatchId(used);
    assert.ok(!used.includes(next), `${next} was already taken`);
    used.push(next);
  }
});

// ---------------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------------

const names = (tiers: readonly Tier[]): string[] => tiers.map(t => t.name);

test('the default board is the six-tier ramp', () => {
  assert.deepEqual(names(defaultTiers()), ['S', 'A', 'B', 'C', 'D', 'F']);
});

test('a tier moves one step and keeps everything else in order', () => {
  const tiers = defaultTiers();
  assert.deepEqual(names(withMovedTier(tiers, tiers[0]!.id, 1)), ['A', 'S', 'B', 'C', 'D', 'F']);
  assert.deepEqual(names(withMovedTier(tiers, tiers[5]!.id, -1)), ['S', 'A', 'B', 'C', 'F', 'D']);
});

test('a move off either end is a no-op, not a wrap', () => {
  const tiers = defaultTiers();
  assert.deepEqual(names(withMovedTier(tiers, tiers[0]!.id, -1)), names(tiers));
  assert.deepEqual(names(withMovedTier(tiers, tiers[5]!.id, 1)), names(tiers));
});

test('a dragged order is applied wholesale', () => {
  const tiers = defaultTiers();
  const reversed = [...tiers].reverse().map(t => t.id);
  assert.deepEqual(names(withTierOrder(tiers, reversed)), ['F', 'D', 'C', 'B', 'A', 'S']);
});

test('deleting a tier returns its contents to the tray rather than destroying them', () => {
  const tiers = defaultTiers();
  const placement = new Map([
    [tiers[0]!.id, ['Dragapult']],
    [tiers[1]!.id, ['Gardevoir']]
  ]);
  const result = withDeletedTier(tiers, placement, tiers[0]!.id);
  assert.equal(result.tiers.length, 5);
  assert.equal(result.placement.has(tiers[0]!.id), false, 'went back to the tray');
  assert.deepEqual(result.placement.get(tiers[1]!.id), ['Gardevoir'], 'untouched');
});

test('the last tier cannot be deleted', () => {
  const one = [makeTier('S', 'vivid-red')];
  assert.equal(withDeletedTier(one, new Map(), one[0]!.id).tiers.length, 1);
});

test('adding a tier appends it with an unused colour', () => {
  const tiers = defaultTiers();
  const next = withAddedTier(tiers);
  assert.equal(next.length, 7);
  assert.ok(!tiers.some(t => t.swatch === next[6]!.swatch));
});

test('editing one tier leaves the others alone', () => {
  const tiers = defaultTiers();
  const next = withEditedTier(tiers, tiers[2]!.id, { name: 'Playable', swatch: 'deep-blue' });
  assert.equal(next[2]!.name, 'Playable');
  assert.equal(next[2]!.swatch, 'deep-blue');
  assert.deepEqual(names(next.filter((_, i) => i !== 2)), ['S', 'A', 'C', 'D', 'F']);
});

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

const item = (id: string): TierItem => ({ id, label: id, kind: 'icon' });

test('everything starts unranked', () => {
  const { buckets, tray } = distribute([item('a'), item('b')], defaultTiers(), new Map());
  assert.deepEqual(
    tray.map(t => t.id),
    ['a', 'b']
  );
  assert.equal([...buckets.values()].flat().length, 0);
});

test('placement keys off the tier id, so a reorder carries contents with it', () => {
  const tiers = defaultTiers();
  const placement = new Map([[tiers[0]!.id, ['a']]]);
  const moved = withMovedTier(tiers, tiers[0]!.id, 3);
  const { buckets } = distribute([item('a')], moved, placement);
  assert.deepEqual(
    buckets.get(tiers[0]!.id)?.map(i => i.id),
    ['a'],
    'the item followed its tier'
  );
});

test('an item in a tier that no longer exists falls back to the tray', () => {
  const { tray } = distribute([item('a')], defaultTiers(), new Map([['ghost-tier', ['a']]]));
  assert.deepEqual(
    tray.map(t => t.id),
    ['a']
  );
});

test('renaming a custom archetype carries its placement to the new id', () => {
  const moved = withRenamedPlacement(new Map([['t2', ['Dragapult', 'Rogue']]]), 'Rogue', 'Rogue v2');
  assert.deepEqual(moved.get('t2'), ['Dragapult', 'Rogue v2'], 'renamed in place, order kept');
});

test('renaming to the same name leaves the list alone', () => {
  const same = withRenamedPlacement(new Map([['t2', ['Rogue']]]), 'Rogue', 'Rogue');
  assert.deepEqual(same.get('t2'), ['Rogue']);
});

// ---------------------------------------------------------------------------
// Dropping
// ---------------------------------------------------------------------------

test('a drop lands at the index it was released over', () => {
  const start = new Map([['t1', ['a', 'b', 'c']]]);
  assert.deepEqual(withDroppedItem(start, 'd', 't1', 1).get('t1'), ['a', 'd', 'b', 'c']);
  assert.deepEqual(withDroppedItem(start, 'd', 't1', 0).get('t1'), ['d', 'a', 'b', 'c']);
  assert.deepEqual(withDroppedItem(start, 'd', 't1', 99).get('t1'), ['a', 'b', 'c', 'd']);
});

test('a drop removes the item from wherever it was, so it can never appear twice', () => {
  const start = new Map([
    ['t1', ['a', 'b']],
    ['t2', ['c']]
  ]);
  const moved = withDroppedItem(start, 'a', 't2', 0);
  assert.deepEqual(moved.get('t2'), ['a', 'c']);
  assert.deepEqual(moved.get('t1'), ['b']);
});

test('a duplicated id from a stale payload is collapsed on the next drop', () => {
  const messy = new Map([
    ['t1', ['a']],
    ['t2', ['a']]
  ]);
  const fixed = withDroppedItem(messy, 'a', 't1', 0);
  assert.deepEqual([...fixed.values()].flat(), ['a'], 'exactly one copy survives');
});

test('a drop never mutates the map it was given', () => {
  const start = new Map([['t1', ['a']]]);
  withDroppedItem(start, 'b', 't1', 0);
  assert.deepEqual(start.get('t1'), ['a']);
});

test('order inside a tier is what the board renders', () => {
  const tiers = defaultTiers();
  const placement = new Map([[tiers[0]!.id, ['c', 'a', 'b']]]);
  const { buckets } = distribute([item('a'), item('b'), item('c')], tiers, placement);
  assert.deepEqual(
    buckets.get(tiers[0]!.id)?.map(i => i.id),
    ['c', 'a', 'b']
  );
});

test('unplaced items follow whatever the tray has been arranged as', () => {
  const { tray } = distribute([item('a'), item('b'), item('c')], defaultTiers(), new Map([['tray', ['c']]]));
  assert.deepEqual(
    tray.map(t => t.id),
    ['c', 'a', 'b']
  );
});

// ---------------------------------------------------------------------------
// Sharing
// ---------------------------------------------------------------------------

test('a shared list round-trips through the URL payload', () => {
  const tiers = defaultTiers();
  const state = {
    mode: 'arts' as const,
    subject: 'Rare Candy',
    title: 'Every Rare Candy, ranked',
    tiers,
    placement: new Map([
      [tiers[0]!.id, ['SVI::191', 'DEX::100']],
      [tiers[2]!.id, ['UL::082']]
    ]),
    custom: [{ id: 1, name: 'Rogue Deck', icons: ['dragapult'], cards: ['ASC/160'] }]
  };
  const back = decodeShare(encodeShare(state));
  assert.ok(back);
  assert.equal(back.mode, 'arts');
  assert.equal(back.subject, 'Rare Candy');
  assert.equal(back.title, 'Every Rare Candy, ranked');
  assert.deepEqual(names(back.tiers), names(tiers));
  assert.deepEqual(
    back.tiers.map(t => t.swatch),
    tiers.map(t => t.swatch)
  );
  // Ids are reissued on decode, so compare by position rather than by id.
  assert.deepEqual(back.placement.get(back.tiers[0]!.id), ['SVI::191', 'DEX::100'], 'order survives');
  assert.deepEqual(back.placement.get(back.tiers[2]!.id), ['UL::082']);
  assert.deepEqual(back.custom, state.custom);
});

test('names outside ASCII survive the round trip', () => {
  const tiers = [makeTier('Étage', 'vivid-red')];
  const back = decodeShare(
    encodeShare({ mode: 'icons', subject: 'Pokémon', title: 'Café', tiers, placement: new Map(), custom: [] })
  );
  assert.equal(back?.subject, 'Pokémon');
  assert.equal(back?.title, 'Café');
  assert.equal(back?.tiers[0]!.name, 'Étage');
});

test('a payload this version did not write decodes to null rather than throwing', () => {
  assert.equal(decodeShare('not-base64!!'), null);
  assert.equal(decodeShare(btoa('{"v":99}')), null);
  assert.equal(decodeShare(''), null);
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

interface Card {
  name: string;
  arts: number;
}

const CARDS: Card[] = [
  { name: 'Riolu', arts: 8 },
  { name: 'Rare Candy', arts: 14 },
  { name: 'Professor Turo', arts: 4 },
  { name: 'Raging Bolt ex', arts: 6 }
];

test('a prefix match outranks a match anywhere else', () => {
  const hits = rankByQuery(
    CARDS,
    'r',
    c => c.name,
    c => c.arts
  );
  assert.equal(hits[0]!.name, 'Rare Candy', 'the heaviest prefix match leads');
  assert.deepEqual(
    hits.map(c => c.name),
    ['Rare Candy', 'Riolu', 'Raging Bolt ex', 'Professor Turo']
  );
});

test('within a group the card with more arts comes first', () => {
  const hits = rankByQuery(
    CARDS,
    'r',
    c => c.name,
    c => c.arts
  );
  assert.ok(hits.indexOf(CARDS[1]!) < hits.indexOf(CARDS[0]!), 'Rare Candy (14) before Riolu (8)');
});

test('an empty query offers the head of the list, already ranked by the caller', () => {
  assert.deepEqual(
    rankByQuery(CARDS, '  ', c => c.name).map(c => c.name),
    CARDS.map(c => c.name)
  );
});

test('matching is case-insensitive and honours the limit', () => {
  assert.deepEqual(
    rankByQuery(CARDS, 'CANDY', c => c.name).map(c => c.name),
    ['Rare Candy']
  );
  assert.equal(
    rankByQuery(
      CARDS,
      'r',
      c => c.name,
      c => c.arts,
      2
    ).length,
    2
  );
});
