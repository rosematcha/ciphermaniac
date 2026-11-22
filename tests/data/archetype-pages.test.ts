/**
 * Which archetypes get a page. Online and City Leagues give one to the 100
 * largest archetypes with at least 5 decks; every other format keeps the 0.5%
 * floor. Decks below the cut still count in every archetype's share.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildArchetypeReports } from '../../shared/data/archetypes/build.ts';
import { onlineArchetypeOptions } from '../../shared/data/reports/onlineArtifacts.ts';
import { FORMAT_SCOPES, TOP_ARCHETYPE_PAGES } from '../../shared/formats/registry.ts';
import { formatReportScope } from '../../.github/scripts/lib/formatMeta.ts';
import { STANDARD_SCOPE } from '../../.github/scripts/lib/onlineMeta.ts';

/** `count` decks of one archetype. */
function decks(archetype: string, count: number): Array<{ archetype: string; cards: never[] }> {
  return Array.from({ length: count }, () => ({ archetype, cards: [] }));
}

test('pages go to the largest archetypes at the deck floor, up to the cap', () => {
  // 1,000 decks: the 0.5% floor would be 5 decks too, so only the cap tells them apart.
  const field = [
    ...decks('Zed Tie', 6),
    ...decks('Big', 900),
    ...decks('Alpha Tie', 6),
    ...decks('Other', 70),
    ...decks('Four', 4),
    ...decks('Five', 5),
    ...decks('Rest', 9)
  ];
  const options = onlineArchetypeOptions(null, null, null, { minDecks: 5, max: 3 });
  const result = buildArchetypeReports(field, null, options);

  // "Other" never gets a page and Four is under the floor. The cap keeps the
  // first seen of the two 6-deck ties, not the first by name.
  assert.deepEqual(
    result.index.map(entry => entry.label),
    ['Big', 'Rest', 'Zed Tie']
  );
  assert.equal(result.minDecks, 5);
  assert.equal(result.deckTotal, field.length);
  assert.equal(result.index[0].percent, 900 / field.length);
});

test('two names with one file base get one page, the larger', () => {
  const field = [...decks('Arceus: Giratina', 5), ...decks('Arceus Giratina', 40)];
  const result = buildArchetypeReports(field, null, onlineArchetypeOptions(null, null, null, TOP_ARCHETYPE_PAGES));
  assert.deepEqual(
    result.index.map(entry => [entry.name, entry.deckCount]),
    [['Arceus_Giratina', 40]]
  );
  assert.deepEqual([...result.decksByBase.keys()], ['Arceus_Giratina']);
});

test('a fixed floor holds however large the window grows', () => {
  const field = [...decks('Big', 4000), ...decks('Small', 5), ...decks('Too Small', 4)];
  const pages = buildArchetypeReports(field, null, onlineArchetypeOptions(null, null, null, TOP_ARCHETYPE_PAGES));
  const share = buildArchetypeReports(field, null, onlineArchetypeOptions(null, null, null));
  assert.deepEqual(
    pages.index.map(entry => entry.label),
    ['Big', 'Small']
  );
  assert.deepEqual(
    share.index.map(entry => entry.label),
    ['Big']
  );
});

test('Online and City Leagues use the top 100; other formats keep the 0.5% floor', () => {
  assert.deepEqual(STANDARD_SCOPE.archetypePages, { minDecks: 5, max: 100 });
  const scoped = FORMAT_SCOPES.filter(format => formatReportScope(format, new Date()).archetypePages);
  assert.deepEqual(
    scoped.map(format => format.id),
    ['city-leagues']
  );
});
