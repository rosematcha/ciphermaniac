/**
 * Structured card-metadata derivation: stage, mechanicSubtypes, numeric
 * hp/retreat, and structured weakness/resistance — the pure parsers behind
 * build-card-types.mjs's v2 fields and its offline `--restructure` pass.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CARD_MECHANIC_SUBTYPES,
  CARD_STAGES,
  parseMechanicSubtypes,
  parseStage,
  parseWeaknessResistance,
  restructureEntry
} from '../../scripts/build-card-types.mjs';

void test('parseStage maps the observed type-line vocabulary', () => {
  assert.equal(parseStage('Basic'), 'basic');
  assert.equal(parseStage('Stage 1 - Evolves from Eevee'), 'stage1');
  assert.equal(parseStage('Stage 2 - Evolves from Kirlia'), 'stage2');
  assert.equal(parseStage('VSTAR - Evolves from Charizard V'), 'vstar');
  assert.equal(parseStage('VMAX - Evolves from Kyurem V'), 'vmax');
  assert.equal(parseStage('Level Up'), 'levelUp');
  // every mapped value is in the exported vocabulary
  for (const info of ['Basic', 'Stage 1', 'Stage 2', 'VSTAR', 'VMAX', 'Level Up']) {
    const stage = parseStage(info);
    assert.ok(stage === null || CARD_STAGES.includes(stage));
  }
});

void test('parseStage returns null for unknown / non-string input', () => {
  assert.equal(parseStage('Restored'), null);
  assert.equal(parseStage(null), null);
  assert.equal(parseStage(undefined), null);
  assert.equal(parseStage(''), null);
});

void test('parseMechanicSubtypes extracts single and multi-mechanic names', () => {
  assert.deepEqual(parseMechanicSubtypes('Charizard ex'), ['ex']);
  assert.deepEqual(parseMechanicSubtypes('Terapagos ex'), ['ex']);
  assert.deepEqual(parseMechanicSubtypes('Tera Charizard ex'), ['Tera', 'ex']);
  assert.deepEqual(parseMechanicSubtypes('Lugia VSTAR'), ['VSTAR']);
  assert.deepEqual(parseMechanicSubtypes('Charizard VMAX'), ['VMAX']);
  assert.deepEqual(parseMechanicSubtypes('Mewtwo V'), ['V']);
  assert.deepEqual(parseMechanicSubtypes('Radiant Greninja'), ['Radiant']);
  assert.deepEqual(parseMechanicSubtypes('Mega Venusaur ex'), ['Mega', 'ex']);
  // canonical emission order (Mega before ex, VMAX before V family precedence)
  assert.deepEqual(parseMechanicSubtypes('Charizard'), []);
});

void test('parseMechanicSubtypes does not false-positive on name substrings', () => {
  assert.deepEqual(parseMechanicSubtypes('Vaporeon'), []); // "V" only as a word
  assert.deepEqual(parseMechanicSubtypes('Vespiquen'), []);
  assert.deepEqual(parseMechanicSubtypes('Exeggutor'), []); // "ex" only as a word
  assert.deepEqual(parseMechanicSubtypes(''), []);
  assert.deepEqual(parseMechanicSubtypes(null), []);
  for (const name of ['Charizard ex', 'Lugia VSTAR', 'Mega Venusaur ex']) {
    for (const m of parseMechanicSubtypes(name)) {
      assert.ok(CARD_MECHANIC_SUBTYPES.includes(m));
    }
  }
});

void test('parseWeaknessResistance structures type + modifier', () => {
  assert.deepEqual(parseWeaknessResistance('Fighting ×2'), { type: 'Fighting', modifier: '×2' });
  assert.deepEqual(parseWeaknessResistance('Fire x2'), { type: 'Fire', modifier: 'x2' });
  assert.deepEqual(parseWeaknessResistance('Fighting -30'), { type: 'Fighting', modifier: '-30' });
  assert.deepEqual(parseWeaknessResistance('Water +20'), { type: 'Water', modifier: '+20' });
  assert.deepEqual(parseWeaknessResistance('Fighting'), { type: 'Fighting', modifier: null });
});

void test('parseWeaknessResistance treats none/empty/non-string as null', () => {
  assert.equal(parseWeaknessResistance('none'), null);
  assert.equal(parseWeaknessResistance('None'), null);
  assert.equal(parseWeaknessResistance(''), null);
  assert.equal(parseWeaknessResistance(null), null);
  assert.equal(parseWeaknessResistance(undefined), null);
});

void test('restructureEntry upgrades a legacy Pokémon entry offline', () => {
  const legacy: Record<string, unknown> = {
    cardType: 'pokemon',
    evolutionInfo: 'VSTAR - Evolves from Charizard V',
    fullType: 'Pokémon - VSTAR - Evolves from Charizard V',
    regulationMark: 'G',
    lastUpdated: '2026-01-01T00:00:00.000Z'
  };
  const upgraded = restructureEntry(legacy);
  assert.equal(upgraded.metadataVersion, 2);
  assert.equal(upgraded.stage, 'vstar');
  assert.deepEqual(upgraded.mechanicSubtypes, ['VSTAR']); // derived from stage
  // input untouched, existing fields preserved
  assert.equal(legacy.metadataVersion, undefined);
  assert.equal(upgraded.regulationMark, 'G');
  assert.equal(upgraded.fullType, legacy.fullType);
});

void test('restructureEntry structures stored strings and numeric fields', () => {
  const upgraded = restructureEntry({
    cardType: 'pokemon',
    evolutionInfo: 'Basic',
    fullType: 'Pokémon - Basic',
    hp: '210',
    retreatCost: '2',
    weakness: 'Fighting ×2',
    resistance: 'none'
  });
  assert.equal(upgraded.stage, 'basic');
  assert.equal(upgraded.hp, 210);
  assert.equal(upgraded.retreatCost, 2);
  assert.deepEqual(upgraded.weakness, { type: 'Fighting', modifier: '×2' });
  assert.equal('resistance' in upgraded, false); // "none" dropped
});

void test('restructureEntry drops stage for non-Pokémon', () => {
  const upgraded = restructureEntry({
    cardType: 'trainer',
    subType: 'supporter',
    fullType: 'Trainer - Supporter',
    stage: 'basic' // stale field should be removed
  });
  assert.equal('stage' in upgraded, false);
  assert.equal(upgraded.metadataVersion, 2);
});
