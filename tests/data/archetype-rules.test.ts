import test from 'node:test';
import assert from 'node:assert/strict';

import { type ArchetypeRule, matchArchetypeRule, ruleIcons, ruleThumbnails } from '../../shared/formats/archetypeRules';
import eternal from '../../config/archetypes/eternal.json' with { type: 'json' };

const card = (count: number, name: string, set: string, number: string) => ({ count, name, set, number });

const rule = (name: string, requires: ArchetypeRule['requires']): ArchetypeRule => ({
  name,
  requires,
  thumbnails: [],
  icons: []
});

test('the first rule a deck satisfies names it', () => {
  const rules = [
    rule('Munkidori Gardevoir', [
      { card: 'Kirlia', copies: 2 },
      { card: 'Munkidori', copies: 1 }
    ]),
    rule('Gardevoir', [{ card: 'Kirlia', copies: 2 }])
  ];
  const munki = [card(3, 'Kirlia', 'SP', '271'), card(2, 'Munkidori', 'PRE', '44')];
  assert.equal(matchArchetypeRule(munki, rules)?.name, 'Munkidori Gardevoir');
  assert.equal(matchArchetypeRule([card(3, 'Kirlia', 'SP', '271')], rules)?.name, 'Gardevoir');
  assert.equal(matchArchetypeRule([card(1, 'Kirlia', 'SP', '271')], rules), null);
});

test('copies count across prints, and a pinned print counts only itself', () => {
  const rules = [rule('Jirachi Mill', [{ card: 'Jirachi', print: 'RR 7', copies: 3 }])];
  assert.equal(matchArchetypeRule([card(4, 'Jirachi', 'DX', '9')], rules), null);
  assert.equal(
    matchArchetypeRule([card(2, 'Jirachi', 'RR', '7'), card(1, 'Jirachi', 'RR', '007')], rules)?.name,
    'Jirachi Mill'
  );
  const anyPrint = [rule('Vileplume', [{ card: 'Vileplume', copies: 2 }])];
  assert.equal(
    matchArchetypeRule([card(1, 'Vileplume', 'AOR', '3'), card(1, 'Vileplume', 'UD', '24')], anyPrint)?.name,
    'Vileplume'
  );
});

test('the Eternal rules give every archetype thumbnails and icons, keyed by name', () => {
  const rules = eternal.archetypes as ArchetypeRule[];
  const names = rules.map(entry => entry.name);
  assert.equal(new Set(names).size, names.length, 'archetype names are unique');
  for (const entry of rules) {
    assert.ok(entry.requires.length > 0, `${entry.name} requires a card`);
    assert.ok(entry.icons.length > 0, `${entry.name} has a sprite`);
    assert.ok(
      entry.thumbnails.every(id => /^[A-Z0-9]+\/[A-Za-z0-9]+$/.test(id)),
      `${entry.name} thumbnails are SET/NUM`
    );
  }
  assert.deepEqual(ruleThumbnails(rules)['Arceus Vileplume'], ['BRS/123', 'AOR/3']);
  assert.deepEqual(ruleIcons(rules)['ADP Garbodor'], ['arceus', 'garbodor']);
});

test('Eternal rules classify real lists the way the sample folder names them', () => {
  const rules = eternal.archetypes as ArchetypeRule[];
  const blastoise = [
    card(3, 'Squirtle', 'BCR', '29'),
    card(2, 'Blastoise', 'PLB', '16'),
    card(3, 'Chien-Pao ex', 'PAL', '61')
  ];
  assert.equal(matchArchetypeRule(blastoise, rules)?.name, 'Blastoise Chien-Pao');
  const pao = [card(2, 'Chien-Pao ex', 'PAL', '61'), card(3, 'Baxcalibur', 'SVP', '19')];
  assert.equal(matchArchetypeRule(pao, rules)?.name, 'Chien-Pao Baxcalibur');
  const garbodor = [card(3, 'Ultra Necrozma', 'CEC', '164'), card(2, 'Garbodor', 'BKP', '57')];
  assert.equal(matchArchetypeRule(garbodor, rules)?.name, 'ADP Garbodor');
});
