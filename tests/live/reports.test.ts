/** Deck reports: what counts as one, and when a seat's reports settle on an archetype. */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  leadingArchetype,
  liveReportsKey,
  MAX_REPORTS_PER_REQUEST,
  parseDeckReports,
  reportableArchetypes
} from '../../shared/live/reports.ts';

const REPORT = {
  slug: 'baltimore-2027',
  seat: 'jose nunez|MX',
  archetype: 'Dragapult Dusknoir',
  voter: '3f2c1a9e-0b7d-4c55-9a11-2b6f0e8d7c41'
};

/** A lone report is a batch of one, so the single-report rules read through the same door. */
const parseDeckReport = (body: unknown) => parseDeckReports(body)?.[0] ?? null;
const seated = (seat: string) => ({ ...REPORT, seat });

test('a well-formed report parses, and carries nothing extra along', () => {
  assert.deepEqual(parseDeckReport({ ...REPORT, note: 'free text is not part of a report' }), REPORT);
  assert.deepEqual(parseDeckReport({ ...REPORT, seat: 'no country|' }), { ...REPORT, seat: 'no country|' });
  assert.equal(parseDeckReport({ ...REPORT, archetype: "Rocket's Honchkrow" })?.archetype, "Rocket's Honchkrow");
});

test('a null archetype is a report taken back; a missing one is not a report', () => {
  assert.deepEqual(parseDeckReport({ ...REPORT, archetype: null }), { ...REPORT, archetype: null });
  const { archetype: _dropped, ...rest } = REPORT;
  assert.equal(parseDeckReport(rest), null);
  assert.equal(parseDeckReport({ ...REPORT, seat: null }), null);
});

test('anything else is not a report', () => {
  const bad: unknown[] = [
    null,
    'text',
    { ...REPORT, slug: '../etc' },
    { ...REPORT, seat: 'no separator' },
    { ...REPORT, seat: 'two|bars|US' },
    { ...REPORT, archetype: 'Markup <b>' },
    { ...REPORT, archetype: 'x'.repeat(61) },
    { ...REPORT, archetype: '' },
    { ...REPORT, voter: 'short' },
    { ...REPORT, voter: 42 },
    { slug: REPORT.slug }
  ];
  for (const body of bad) {
    assert.equal(parseDeckReport(body), null, JSON.stringify(body));
  }
});

test('a batch is one device on one event, and is refused whole when it is not', () => {
  const run = [seated('alice|US'), seated('bob|CA'), { ...seated('cleo|JP'), archetype: null }];
  assert.deepEqual(parseDeckReports({ reports: run }), run);
  assert.equal(parseDeckReports({ reports: [] }), null);
  assert.equal(parseDeckReports({ reports: [seated('alice|US'), seated('alice|US')] }), null);
  assert.equal(parseDeckReports({ reports: [REPORT, { ...seated('bob|CA'), slug: 'elsewhere-2027' }] }), null);
  assert.equal(
    parseDeckReports({ reports: [REPORT, { ...seated('bob|CA'), voter: REPORT.voter.replace('3', '4') }] }),
    null
  );
  assert.equal(parseDeckReports({ reports: [REPORT, 'not a report'] }), null);
});

test('a batch longer than a run could be is refused', () => {
  const run = (n: number) => ({ reports: Array.from({ length: n }, (_, i) => seated(`player ${i}|US`)) });
  assert.equal(parseDeckReports(run(MAX_REPORTS_PER_REQUEST))?.length, MAX_REPORTS_PER_REQUEST);
  assert.equal(parseDeckReports(run(MAX_REPORTS_PER_REQUEST + 1)), null);
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

test('the picker offers the online index first, then the rest of the icon map by name, once each', () => {
  assert.deepEqual(reportableArchetypes(['Slowking', 'Dragapult'], ['Ceruledge', 'dragapult', 'Alakazam']), [
    'Slowking',
    'Dragapult',
    'Alakazam',
    'Ceruledge'
  ]);
});
