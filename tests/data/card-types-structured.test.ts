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

void test('parseStage maps the observed type-line vocabulary and nothing else', () => {
  const cases: Array<[string | null | undefined, string | null]> = [
    ['Basic', 'basic'],
    ['Stage 1 - Evolves from Eevee', 'stage1'],
    ['Stage 2 - Evolves from Kirlia', 'stage2'],
    ['VSTAR - Evolves from Charizard V', 'vstar'],
    ['VMAX - Evolves from Kyurem V', 'vmax'],
    ['Level Up', 'levelUp'],
    ['Restored', null],
    ['', null],
    [null, null],
    [undefined, null]
  ];
  for (const [info, expected] of cases) {
    const stage = parseStage(info);
    assert.equal(stage, expected, String(info));
    // every mapped value is in the exported vocabulary
    assert.ok(stage === null || CARD_STAGES.includes(stage));
  }
});

void test('parseMechanicSubtypes extracts whole-word mechanics in canonical order', () => {
  const cases: Array<[string | null, string[]]> = [
    ['Charizard ex', ['ex']],
    ['Terapagos ex', ['ex']],
    ['Tera Charizard ex', ['Tera', 'ex']],
    ['Lugia VSTAR', ['VSTAR']],
    ['Charizard VMAX', ['VMAX']],
    ['Mewtwo V', ['V']],
    ['Radiant Greninja', ['Radiant']],
    ['Mega Venusaur ex', ['Mega', 'ex']],
    ['Charizard', []],
    // No false positives on name substrings: "V" and "ex" only as words.
    ['Vaporeon', []],
    ['Vespiquen', []],
    ['Exeggutor', []],
    ['', []],
    [null, []]
  ];
  for (const [name, expected] of cases) {
    const mechanics = parseMechanicSubtypes(name);
    assert.deepEqual(mechanics, expected, String(name));
    for (const m of mechanics) {
      assert.ok(CARD_MECHANIC_SUBTYPES.includes(m));
    }
  }
});

void test('parseWeaknessResistance structures type + modifier and treats none/empty as null', () => {
  const cases: Array<[string | null | undefined, { type: string; modifier: string | null } | null]> = [
    ['Fighting ×2', { type: 'Fighting', modifier: '×2' }],
    ['Fire x2', { type: 'Fire', modifier: 'x2' }],
    ['Fighting -30', { type: 'Fighting', modifier: '-30' }],
    ['Water +20', { type: 'Water', modifier: '+20' }],
    ['Fighting', { type: 'Fighting', modifier: null }],
    ['none', null],
    ['None', null],
    ['', null],
    [null, null],
    [undefined, null]
  ];
  for (const [value, expected] of cases) {
    assert.deepEqual(parseWeaknessResistance(value), expected, String(value));
  }
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
