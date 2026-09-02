import test from 'node:test';
import assert from 'node:assert/strict';

import { buildStories, type BuildStoriesInput, type FieldRow } from '../../src/lib/storylines.ts';
import type { ArchetypeIndexEntry, TournamentParticipant } from '../../src/types/index.ts';

function archetype(name: string): ArchetypeIndexEntry {
  return { name, label: name, deckCount: 0, percent: 0, thumbnails: [] } as unknown as ArchetypeIndexEntry;
}

function row(label: string, overrides: Partial<FieldRow> = {}): FieldRow {
  return {
    rawName: label,
    label,
    archetype: archetype(label),
    thumbnails: [],
    fieldPct: 10,
    fieldDecks: 20,
    day2Count: 5,
    day2Pct: 10,
    day2Conversion: 25,
    topCutCount: 0,
    cutPct: 0,
    avgWins: null,
    bestPlacement: null,
    onlinePct: 10,
    delta: 0,
    conversionPct: 0,
    ...overrides
  };
}

function input(rows: FieldRow[], overrides: Partial<BuildStoriesInput> = {}): BuildStoriesInput {
  const byName = new Map(rows.map(r => [r.label, r.archetype]));
  return {
    rows,
    excludeArchetype: undefined,
    hasDay2: true,
    winner: undefined,
    standings: [],
    topCutParticipants: [],
    cutLine: null,
    totalTopCut: 0,
    lookupArchetype: name => (name ? byName.get(name) : undefined),
    ...overrides
  };
}

test('a conversion story leads with the Day 2 rate and counts, never prose', () => {
  const stories = buildStories(input([row('Gardevoir ex', { day2Conversion: 60, day2Count: 12, bestPlacement: 3 })]));
  const top = stories.find(s => s.tagLabel === 'Top performer');
  assert.ok(top);
  assert.equal(top.subject, 'Gardevoir ex');
  assert.equal(top.figure, '60%');
  assert.equal(top.measure, 'Day 2 conversion');
  assert.equal(top.detail, '12 of 20 pilots · best finish #3');
});

test('an unbeaten winner carries the Swiss record and deck as data', () => {
  const winner: TournamentParticipant = {
    tpId: 1,
    name: 'A. Pilot',
    wins: 9,
    losses: 0,
    ties: 0,
    deckName: 'Dragapult ex'
  };
  const stories = buildStories(input([row('Dragapult ex')], { winner, hasDay2: false }));
  const s = stories.find(x => x.tagLabel === 'Unbeaten');
  assert.ok(s);
  assert.equal(s.subject, 'A. Pilot');
  assert.equal(s.figure, '9-0');
  assert.equal(s.measure, 'through Swiss');
  assert.equal(s.detail, '1st · Dragapult ex');
});

test('a meta surprise states the gap in points with both shares as context', () => {
  const stories = buildStories(
    input([row('Charizard ex', { fieldPct: 18, onlinePct: 8, delta: 10 })], { hasDay2: false })
  );
  const s = stories.find(x => x.tagLabel === 'Overbrought');
  assert.ok(s);
  assert.equal(s.figure, '+10.0 pp');
  assert.equal(s.measure, 'vs. online meta');
  assert.equal(s.detail, '18% field · 8.0% online');
});

test('one story per archetype even when several generators fire on it', () => {
  const rows = [row('Gardevoir ex', { day2Conversion: 60, day2Count: 12, fieldPct: 20, onlinePct: 8, delta: 12 })];
  const stories = buildStories(input(rows));
  const subjects = stories.map(s => s.subject);
  assert.equal(new Set(subjects).size, subjects.length);
});
