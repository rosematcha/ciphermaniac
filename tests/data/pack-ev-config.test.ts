/**
 * The shipped pack model, checked for the mistakes a hand-edited config makes.
 *
 * `config/pack-ev.json` is transcribed from one pull-rate count per set. A
 * decimal in the wrong place, a slot with two remainder outcomes, or a sealed
 * product id pasted twice all produce a page that looks fine and lies, so they
 * are caught here rather than in production.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveChances } from '../../shared/packEv/ev.ts';
import type { PackEvConfig } from '../../shared/packEv/types.ts';
import rawConfig from '../../config/pack-ev.json';

const config = rawConfig as unknown as PackEvConfig;

test('every set is distinct and cites the count its rates came from', () => {
  const codes = config.sets.map(set => set.code);
  assert.equal(new Set(codes).size, codes.length);
  for (const set of config.sets) {
    assert.match(set.source.url, /^https:\/\//, `${set.code} pull-rate source`);
    assert.ok(set.source.sampleSize > 0, `${set.code} sample size`);
    assert.ok(set.groupId > 0, `${set.code} group id`);
  }
});

test('every slot resolves: at most one remainder outcome, and no slot over 100%', () => {
  for (const set of config.sets) {
    for (const slot of set.slots) {
      const chances = resolveChances(slot.outcomes);
      assert.equal(chances.length, slot.outcomes.length, `${set.code} ${slot.label}`);
      const total = chances.reduce((sum, chance) => sum + chance, 0);
      assert.ok(Math.abs(total - 1) < 1e-9, `${set.code} ${slot.label} sums to ${total}`);
    }
  }
});

test('each outcome draws from a pool or is flat bulk, never both and never neither', () => {
  for (const set of config.sets) {
    for (const slot of set.slots) {
      for (const outcome of slot.outcomes) {
        const where = `${set.code} ${slot.label} / ${outcome.label}`;
        assert.notEqual(Boolean(outcome.pool), Boolean(outcome.flat), where);
        if (outcome.pool) {
          assert.ok(outcome.pool.rarities.length > 0, where);
          assert.ok(config.bulk[outcome.pool.bulk] !== undefined, `${where} bulk class`);
        }
      }
    }
  }
});

/** Cards a pack holds, energy included, the way the boxes describe it. 30th Celebration packs are half size. */
function packSize(code: string): number {
  return code === '30C' ? 6 : 11;
}

test('a pack holds its cards plus the energy, the way the boxes describe it', () => {
  for (const set of config.sets) {
    const cards = set.slots.reduce((sum, slot) => sum + (slot.count ?? 1), 0);
    assert.equal(cards, packSize(set.code), `${set.code} draws ${cards} cards a pack`);
  }
});

function drawCardCount(draw: NonNullable<(typeof config.sets)[number]['specialPacks']>[number]['draws'][number]) {
  if (draw.kind === 'cards') {
    return draw.cards.length;
  }
  return draw.kind === 'oneOf' ? draw.groups[0].length : draw.count;
}

test('a special pack is still a whole pack: kept slots plus draws fill it', () => {
  for (const set of config.sets) {
    const counts = new Map(set.slots.map(slot => [slot.label, slot.count ?? 1]));
    for (const special of set.specialPacks ?? []) {
      const where = `${set.code} ${special.label}`;
      assert.ok(special.odds > 1, `${where} odds`);
      const kept = special.keepSlots.reduce((sum, label) => {
        assert.ok(counts.has(label), `${where} keeps unknown slot ${label}`);
        return sum + (counts.get(label) ?? 0);
      }, 0);
      const drawn = special.draws.reduce((sum, draw) => sum + drawCardCount(draw), 0);
      assert.equal(kept + drawn, packSize(set.code), `${where} holds ${kept + drawn} cards`);
    }
  }
});

test('a demigod pack offers groups of the same size', () => {
  for (const set of config.sets) {
    for (const draw of (set.specialPacks ?? []).flatMap(special => special.draws)) {
      if (draw.kind === 'oneOf') {
        assert.equal(new Set(draw.groups.map(group => group.length)).size, 1, `${set.code} uneven groups`);
      }
    }
  }
});

test('every set sells a single pack, and no sealed product is listed twice', () => {
  for (const set of config.sets) {
    const ids = set.sealed.map(product => product.id);
    assert.equal(new Set(ids).size, ids.length, `${set.code} repeats a product id`);
    // The single is what lets every opener button be priced whatever else is listed.
    assert.ok(
      set.sealed.some(product => product.packs === 1),
      `${set.code} has no single pack`
    );
    for (const product of set.sealed) {
      assert.ok(product.packs > 0, `${set.code} ${product.label}`);
    }
  }
});

test('opener buttons open a whole number of packs, starting from a single', () => {
  for (const set of config.sets) {
    const rips = set.rips ?? [];
    for (const rip of rips) {
      assert.ok(Number.isInteger(rip.packs) && rip.packs > 0, `${set.code} ${rip.label}`);
    }
    if (rips.length) {
      assert.equal(rips[0].packs, 1, `${set.code} opens a single pack first`);
    }
  }
});

test('an unpriced stand-in is worth more than bulk, or it would be pointless', () => {
  for (const set of config.sets) {
    for (const outcome of set.slots.flatMap(slot => slot.outcomes)) {
      const unpriced = outcome.pool?.unpriced;
      if (unpriced !== undefined) {
        assert.ok(unpriced > config.threshold, `${set.code} ${outcome.label} stand-in ${unpriced}`);
      }
    }
  }
});

test('the bulk rates are the posted buylist, not placeholders', () => {
  assert.match(config.bulkSource.url, /^https:\/\//);
  assert.equal(config.threshold, 1);
  for (const [tier, rate] of Object.entries(config.bulk)) {
    assert.ok(rate > 0 && rate < config.threshold, `${tier} rate ${rate}`);
  }
});
