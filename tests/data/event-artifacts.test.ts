/**
 * tests/data/event-artifacts.test.ts
 * Event artifact orchestrator: builds every serving body from a normalized event.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildDecksArtifact, buildEventArtifacts, buildPlayersArtifact } from '../../shared/data/reports/eventArtifacts.ts';
import { canonicalStringify } from '../../shared/data/canonicalJson.ts';
import type { NormalizedEvent } from '../../shared/data/contracts.ts';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'data-pipeline');
const labs = JSON.parse(readFileSync(join(fixturesDir, 'labs-event.json'), 'utf8')) as NormalizedEvent;
const online = JSON.parse(readFileSync(join(fixturesDir, 'online-window.json'), 'utf8')) as NormalizedEvent;

test('labs event produces the full artifact set', () => {
  const artifacts = buildEventArtifacts(labs);
  for (const key of ['master.json', 'decks.json', 'players.json', 'matches.json', 'playerMatches.json', 'conversion.json', 'matchupProfiles.json', 'index.json', 'meta.json', 'cardUsage.json', 'archetypes/index.json']) {
    assert.ok(artifacts.has(key), `missing ${key}`);
  }
});

test('archetype index + per-archetype files + cardUsage are generated and consistent', () => {
  const artifacts = buildEventArtifacts(labs);
  const index = artifacts.get('archetypes/index.json') as { name: string }[];
  assert.ok(Array.isArray(index) && index.length > 0);
  // Every index slug resolves to a cards.json body (index slugs resolve to bodies).
  for (const entry of index) {
    assert.ok(artifacts.has(`archetypes/${entry.name}/cards.json`), `no body for ${entry.name}`);
    assert.ok(artifacts.has(`archetypes/${entry.name}/decks.json`));
  }
  // cardUsage slugs are a subset of the archetype index slugs.
  const usage = artifacts.get('cardUsage.json') as { usage: Record<string, { slug: string }[]> };
  const indexSlugs = new Set(index.map(e => e.name));
  for (const rows of Object.values(usage.usage)) {
    for (const row of rows) assert.ok(indexSlugs.has(row.slug), `usage slug ${row.slug} not in index`);
  }
});

test('phase2 and topcut slices reuse the report bundle under a prefix', () => {
  const artifacts = buildEventArtifacts(labs);
  assert.ok(artifacts.has('slices/phase2/master.json'));
  assert.ok(artifacts.has('slices/phase2/archetypes/index.json'));
  assert.ok(artifacts.has('slices/topcut/master.json'));
});

test('online window omits match-derived and conversion artifacts', () => {
  const artifacts = buildEventArtifacts(online);
  assert.ok(artifacts.has('master.json'));
  assert.ok(artifacts.has('decks.json'));
  assert.deepStrictEqual(artifacts.get('matches.json'), []);
  assert.deepStrictEqual(artifacts.get('playerMatches.json'), []);
  assert.strictEqual(artifacts.has('matchupProfiles.json'), false, 'no matchups without matches');
  assert.strictEqual(artifacts.has('conversion.json'), false, 'online has no Day 2');
});

test('master.json deckTotal counts only decks with a decklist; found <= deckTotal', () => {
  const artifacts = buildEventArtifacts(labs) as Map<string, { deckTotal: number; items: { found: number; total: number }[] }>;
  const master = artifacts.get('master.json')!;
  const withList = labs.decks.filter(d => d.hasDecklist).length;
  assert.strictEqual(master.deckTotal, withList);
  for (const item of master.items) {
    assert.ok(item.found <= master.deckTotal, `found ${item.found} > deckTotal ${master.deckTotal}`);
  }
});

test('decks.json separates participantId (playerId) from the content-hash deckId', () => {
  const decks = buildDecksArtifact(labs);
  for (const deck of decks) {
    assert.match(deck.playerId, /^labs:/); // event-scoped participant id, not a hash
    assert.strictEqual(deck.deckId, deck.id);
    assert.notStrictEqual(deck.playerId, deck.deckId);
  }
});

test('players.json is sorted by placement then name', () => {
  const players = buildPlayersArtifact(labs);
  for (let i = 1; i < players.length; i++) {
    const a = players[i - 1];
    const b = players[i];
    const pa = a.placement ?? Number.MAX_SAFE_INTEGER;
    const pb = b.placement ?? Number.MAX_SAFE_INTEGER;
    assert.ok(pa < pb || (pa === pb && (a.name ?? '') <= (b.name ?? '')));
  }
});

test('index.json reports consistent counts', () => {
  const artifacts = buildEventArtifacts(labs) as Map<string, { participantCount: number; deckCount: number; matchCount: number }>;
  const index = artifacts.get('index.json')!;
  assert.strictEqual(index.participantCount, labs.participants.length);
  assert.strictEqual(index.deckCount, labs.decks.length);
  assert.strictEqual(index.matchCount, labs.matches.length);
});

test('the whole artifact set is permutation-invariant', () => {
  const shuffled: NormalizedEvent = {
    ...labs,
    decks: [...labs.decks].reverse(),
    participants: [...labs.participants].reverse(),
    matches: [...labs.matches].reverse()
  };
  const a = buildEventArtifacts(labs);
  const b = buildEventArtifacts(shuffled);
  assert.deepStrictEqual([...a.keys()].sort(), [...b.keys()].sort());
  for (const key of a.keys()) {
    assert.strictEqual(canonicalStringify(a.get(key)), canonicalStringify(b.get(key)), `${key} differs under permutation`);
  }
});
