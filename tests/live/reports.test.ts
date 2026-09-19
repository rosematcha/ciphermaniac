/** Deck reports: what counts as one, and when a seat's reports settle on an archetype. */

import assert from 'node:assert/strict';
import test from 'node:test';

import { leadingArchetype, liveReportsKey, parseDeckReport } from '../../shared/live/reports.ts';

const REPORT = {
  slug: 'baltimore-2027',
  seat: 'jose nunez|MX',
  archetype: 'Dragapult_Dusknoir',
  voter: '3f2c1a9e-0b7d-4c55-9a11-2b6f0e8d7c41'
};

test('a well-formed report parses, and carries nothing extra along', () => {
  assert.deepEqual(parseDeckReport({ ...REPORT, note: 'free text is not part of a report' }), REPORT);
  assert.deepEqual(parseDeckReport({ ...REPORT, seat: 'no country|' }), { ...REPORT, seat: 'no country|' });
});

test('anything else is not a report', () => {
  const bad: unknown[] = [
    null,
    'text',
    { ...REPORT, slug: '../etc' },
    { ...REPORT, seat: 'no separator' },
    { ...REPORT, seat: 'two|bars|US' },
    { ...REPORT, archetype: 'Has Spaces <b>' },
    { ...REPORT, archetype: '' },
    { ...REPORT, voter: 'short' },
    { ...REPORT, voter: 42 },
    { slug: REPORT.slug }
  ];
  for (const body of bad) {
    assert.equal(parseDeckReport(body), null, JSON.stringify(body));
  }
});

test('an archetype leads with more than half the reports: one report does, a split does not', () => {
  assert.equal(leadingArchetype([{ archetype: 'A', votes: 1 }]), 'A');
  assert.equal(
    leadingArchetype([
      { archetype: 'A', votes: 3 },
      { archetype: 'B', votes: 2 }
    ]),
    'A'
  );
  assert.equal(
    leadingArchetype([
      { archetype: 'A', votes: 2 },
      { archetype: 'B', votes: 2 }
    ]),
    null
  );
  assert.equal(
    leadingArchetype([
      { archetype: 'A', votes: 2 },
      { archetype: 'B', votes: 1 },
      { archetype: 'C', votes: 1 }
    ]),
    null
  );
  assert.equal(leadingArchetype([]), null);
});

test('reports are published beside the event they belong to', () => {
  assert.equal(liveReportsKey('baltimore-2027'), 'live/v1/baltimore-2027/reports.json');
});
