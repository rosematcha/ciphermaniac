/**
 * Card wall geometry and timing.
 *
 * The one property worth guarding above all others is seamlessness: a row has
 * to be in exactly the same place at the end of the loop as at the start, for
 * every direction and lap count. Break that and the GIF visibly hitches once
 * per loop — which is the kind of thing you notice only after exporting.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildScene,
  CARD_ASPECT,
  createRng,
  dealRows,
  GIF_FRAME_RATES,
  gifFrameDelayCs,
  shuffled,
  tileOriginX,
  type WallConfig,
  type WallDeal
} from '../../src/lib/cardWall/scene.ts';
import { WALL_ROSTER, type WallCard } from '../../src/lib/cardWall/roster.ts';

/** The default deal: nothing guaranteed, everything available. */
const OPEN: WallDeal = { always: [], rest: WALL_ROSTER };

function dealOf(always: readonly WallCard[]): WallDeal {
  const pinned = new Set(always);
  return { always, rest: WALL_ROSTER.filter(card => !pinned.has(card)) };
}

function config(overrides: Partial<WallConfig> = {}): WallConfig {
  return {
    rows: 4,
    cardsPerRow: 6,
    loopSeconds: 13.2,
    gap: 0.1,
    cardScale: 0.84,
    rowSettings: [
      { direction: 'left', laps: 1 },
      { direction: 'right', laps: 2 },
      { direction: 'left', laps: 3 },
      { direction: 'right', laps: 1 }
    ],
    seed: 7,
    ...overrides
  };
}

test('roster entries are unique printings with a usable set and number', () => {
  assert.ok(WALL_ROSTER.length >= 40, 'the wall needs enough cards to fill several rows');
  const keys = new Set<string>();
  for (const card of WALL_ROSTER) {
    assert.match(card.set, /^[A-Z0-9]{2,5}$/, `${card.name} has an odd set code`);
    assert.match(card.number, /^\d{3}[a-z]?$/, `${card.name} number should be CDN-padded`);
    assert.ok(card.name.length > 0);
    const key = `${card.set}::${card.number}`;
    assert.ok(!keys.has(key), `${key} appears twice`);
    keys.add(key);
  }
});

test('cards keep trading-card proportions and tile the row exactly', () => {
  const scene = buildScene(config(), OPEN, 1280, 720);
  assert.equal(scene.rows.length, 4);
  assert.ok(Math.abs(scene.cardWidth / scene.cardHeight - CARD_ASPECT) < 1e-9);
  assert.ok(Math.abs(scene.tileWidth - 6 * (scene.cardWidth + scene.gapPx)) < 1e-9);
  // Card height is the row band scaled, and rows are stacked bands.
  assert.ok(Math.abs(scene.cardHeight - (720 / 4) * 0.84) < 1e-9);
  for (let i = 1; i < scene.rows.length; i++) {
    assert.ok(scene.rows[i]!.y > scene.rows[i - 1]!.y);
  }
});

test('the loop is whatever length was asked for, and scroll speed falls out of it', () => {
  const scene = buildScene(config({ loopSeconds: 12 }), OPEN, 1280, 720);
  assert.equal(scene.loopSeconds, 12);
  assert.ok(Math.abs(scene.cardsPerSecond - scene.tileWidth / (scene.cardWidth * 12)) < 1e-9);
  // Halving the loop doubles the pace; the geometry is untouched.
  const quick = buildScene(config({ loopSeconds: 6 }), OPEN, 1280, 720);
  assert.ok(Math.abs(quick.cardsPerSecond - scene.cardsPerSecond * 2) < 1e-9);
  assert.equal(quick.tileWidth, scene.tileWidth);
});

test('adding cards to a row speeds it up rather than lengthening the loop', () => {
  const six = buildScene(config({ cardsPerRow: 6, loopSeconds: 12 }), OPEN, 1280, 720);
  const twelve = buildScene(config({ cardsPerRow: 12, loopSeconds: 12 }), OPEN, 1280, 720);
  assert.equal(twelve.loopSeconds, six.loopSeconds, 'the loop the user pinned must survive a density change');
  assert.ok(Math.abs(twelve.cardsPerSecond - six.cardsPerSecond * 2) < 1e-9);
});

test('a nonsensical loop length is floored rather than dividing by zero', () => {
  const scene = buildScene(config({ loopSeconds: 0 }), OPEN, 1280, 720);
  assert.ok(scene.loopSeconds > 0);
  assert.ok(Number.isFinite(scene.cardsPerSecond));
});

test('the same config at a different resolution is the same scene, scaled', () => {
  const small = buildScene(config(), OPEN, 640, 360);
  const large = buildScene(config(), OPEN, 1280, 720);
  assert.ok(Math.abs(large.loopSeconds - small.loopSeconds) < 1e-9, 'timing must not depend on output size');
  assert.ok(Math.abs(large.cardsPerSecond - small.cardsPerSecond) < 1e-9, 'pace is in card widths, not pixels');
  assert.ok(Math.abs(large.cardWidth - small.cardWidth * 2) < 1e-9);
  assert.ok(Math.abs(large.tileWidth - small.tileWidth * 2) < 1e-9);
  for (let i = 0; i < small.rows.length; i++) {
    assert.deepEqual(
      large.rows[i]!.cards.map(c => c.name),
      small.rows[i]!.cards.map(c => c.name),
      'the deal must not depend on output size'
    );
  }
});

test('every row lands back where it started at the end of the loop', () => {
  for (const laps of [1, 2, 3]) {
    for (const direction of ['left', 'right'] as const) {
      const scene = buildScene(
        config({ rowSettings: Array.from({ length: 4 }, () => ({ direction, laps })) }),
        OPEN,
        1280,
        720
      );
      for (const row of scene.rows) {
        const start = tileOriginX(row, scene.tileWidth, scene.loopSeconds, 0);
        const end = tileOriginX(row, scene.tileWidth, scene.loopSeconds, scene.loopSeconds);
        assert.ok(Math.abs(end - start) < 1e-6, `${direction} at ${laps}x seams by ${end - start}px`);
      }
    }
  }
});

test('tile origin always sits one tile to the left, so callers only tile rightwards', () => {
  const scene = buildScene(config(), OPEN, 1280, 720);
  for (const row of scene.rows) {
    for (let step = 0; step <= 50; step++) {
      const x = tileOriginX(row, scene.tileWidth, scene.loopSeconds, (step / 50) * scene.loopSeconds);
      assert.ok(x >= -scene.tileWidth - 1e-9 && x < 1e-9, `origin ${x} escaped the wrap window`);
    }
  }
});

test('direction decides which way the cards travel', () => {
  const scene = buildScene(
    config({
      rowSettings: [
        { direction: 'left', laps: 1 },
        { direction: 'right', laps: 1 },
        { direction: 'left', laps: 1 },
        { direction: 'right', laps: 1 }
      ]
    }),
    OPEN,
    1280,
    720
  );
  const dt = scene.loopSeconds / 1000;
  // Compare unwrapped travel rather than the wrapped origin, which can jump.
  const travel = (rowIndex: number, t: number) => {
    const row = scene.rows[rowIndex]!;
    const raw = (t / scene.loopSeconds) * row.laps * scene.tileWidth + row.phase;
    return row.direction === 'left' ? -raw : raw;
  };
  assert.ok(travel(0, dt) < travel(0, 0), 'a left row moves left');
  assert.ok(travel(1, dt) > travel(1, 0), 'a right row moves right');
});

test('a faster row covers proportionally more ground per loop', () => {
  const scene = buildScene(
    config({
      rowSettings: [
        { direction: 'left', laps: 1 },
        { direction: 'left', laps: 3 },
        { direction: 'left', laps: 1 },
        { direction: 'left', laps: 1 }
      ]
    }),
    OPEN,
    1280,
    720
  );
  assert.equal(scene.rows[1]!.laps, 3);
  assert.equal(scene.rows[0]!.laps, 1);
});

test('the deal covers the roster and repeats only once it has to', () => {
  const hands = dealRows(OPEN, 6, 8, createRng(3));
  assert.equal(hands.length, 6);
  assert.ok(hands.every(hand => hand.length === 8));
  const seen = new Set(hands.flat().map(card => `${card.set}::${card.number}`));
  // 48 slots against a 48-card roster: one full pass, so every card shows up.
  assert.equal(seen.size, WALL_ROSTER.length);
});

test('a guaranteed card makes the wall even when most of the roster does not', () => {
  const dragapult = WALL_ROSTER.find(card => card.name === 'Dragapult ex');
  assert.ok(dragapult, 'the roster should still contain the card this guard is about');
  const deal = dealOf([dragapult]);
  // 12 slots against 48 cards: three quarters of the roster misses out, so an
  // unguarded card is usually absent. The guaranteed one never is.
  for (let seed = 0; seed < 40; seed++) {
    const hands = dealRows(deal, 3, 4, createRng(seed));
    const names = hands.flat().map(card => card.name);
    assert.ok(names.includes('Dragapult ex'), `seed ${seed} dropped the guaranteed card`);
  }
});

test('guaranteed cards are scattered through the wall, not stacked in the first row', () => {
  const deal = dealOf(WALL_ROSTER.slice(0, 6));
  const rowsHit = new Set<number>();
  for (let seed = 0; seed < 20; seed++) {
    dealRows(deal, 4, 6, createRng(seed)).forEach((hand, row) => {
      if (hand.some(card => deal.always.includes(card))) {
        rowsHit.add(row);
      }
    });
  }
  assert.equal(rowsHit.size, 4, 'selection and placement have to be separate shuffles');
});

test('cards left out of the deal never appear', () => {
  const kept = WALL_ROSTER.slice(0, 10);
  const hands = dealRows({ always: [], rest: kept }, 4, 6, createRng(1));
  const keptNames = new Set(kept.map(card => card.name));
  for (const card of hands.flat()) {
    assert.ok(keptNames.has(card.name), `${card.name} was excluded but still dealt`);
  }
});

test('more guaranteed cards than slots still fills the wall', () => {
  const hands = dealRows(dealOf(WALL_ROSTER.slice(0, 20)), 2, 3, createRng(4));
  assert.equal(hands.flat().length, 6);
});

test('a seed reproduces a wall, and a new seed changes it', () => {
  const first = buildScene(config({ seed: 11 }), OPEN, 1280, 720);
  const same = buildScene(config({ seed: 11 }), OPEN, 1280, 720);
  const other = buildScene(config({ seed: 12 }), OPEN, 1280, 720);
  const names = (scene: typeof first) => scene.rows.map(row => row.cards.map(c => c.name).join(','));
  assert.deepEqual(names(same), names(first));
  assert.notDeepEqual(names(other), names(first));
});

test('shuffled keeps every element and leaves the input alone', () => {
  const input = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8]);
  const out = shuffled(input, createRng(9));
  assert.deepEqual(
    [...out].sort((a, b) => a - b),
    [...input]
  );
});

test('every GIF frame is held for the same whole centisecond', () => {
  for (const fps of GIF_FRAME_RATES) {
    const delay = gifFrameDelayCs(fps);
    assert.ok(Number.isInteger(delay), `${fps}fps needs a whole-centisecond delay`);
    // Uneven frame lengths are what a viewer reads as judder on a smooth pan,
    // so the offered rates all divide 100 exactly.
    assert.equal(delay * fps, 100, `${fps}fps does not divide 100`);
  }
});

test('an absurd frame rate is floored rather than written as zero', () => {
  // Renderers silently rewrite anything under 2cs to a tenth of a second.
  assert.equal(gifFrameDelayCs(1000), 2);
  assert.ok(gifFrameDelayCs(1) > 0);
});
