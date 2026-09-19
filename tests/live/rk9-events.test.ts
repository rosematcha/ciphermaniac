/**
 * RK9 event list parser: which events are followed live, and when. The fixture
 * keeps RK9's row shape, including the three tournament links of which only the
 * TCG one matters, and the rows that must be left out.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { detectEventsBreakage, parseRk9Dates, parseRk9Events } from '../../shared/live/rk9Events.ts';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/live');
const fixture = (name: string) => readFileSync(join(FIXTURES, `${name}.html`), 'utf8');

const parsed = parseRk9Events(fixture('events'));

test('regionals, internationals and worlds are kept, soonest first', () => {
  assert.deepEqual(
    parsed.events.map(event => [event.slug, event.kind]),
    [
      ['brisbane-2027', 'regional'],
      ['gdansk-2027', 'regional'],
      ['laic-2027', 'international'],
      ['worlds-2027', 'worlds']
    ]
  );
  assert.equal(detectEventsBreakage(parsed), undefined);
});

test('an event carries its TCG tournament, not the GO or VG one, and a plain name', () => {
  assert.deepEqual(parsed.events[0], {
    slug: 'brisbane-2027',
    name: 'Brisbane Regional Championships',
    kind: 'regional',
    rk9Id: 'BR001-abcDEF1',
    pod: 2,
    firstDay: '2026-09-26',
    lastDay: '2026-09-27'
  });
  assert.equal(parsed.events[1].name, 'Gdansk Regional Championships');
});

test('special championships and finished events are left out without counting as unreadable', () => {
  const slugs = parsed.events.map(event => event.slug);
  assert.equal(slugs.includes('turin-2027'), false);
  assert.equal(slugs.includes('naic-2026'), false);
  assert.deepEqual([parsed.rowsSeen, parsed.rowsUnreadable], [6, 0]);
});

test('date ranges within a month, across months, across years, and single days', () => {
  assert.deepEqual(parseRk9Dates('September 18-20, 2026'), { firstDay: '2026-09-18', lastDay: '2026-09-20' });
  assert.deepEqual(parseRk9Dates('October 31-November 1, 2026'), { firstDay: '2026-10-31', lastDay: '2026-11-01' });
  assert.deepEqual(parseRk9Dates('December 30, 2026-January 1, 2027'), {
    firstDay: '2026-12-30',
    lastDay: '2027-01-01'
  });
  assert.deepEqual(parseRk9Dates('June 6, 2026'), { firstDay: '2026-06-06', lastDay: '2026-06-06' });
  assert.equal(parseRk9Dates('Smarch 3-4, 2026'), null);
  assert.equal(parseRk9Dates('26.09.2026'), null);
});

test('a followed event whose dates stop parsing is breakage, as is a page without events', () => {
  const redated = parseRk9Events(fixture('events-redated'));
  assert.equal(
    redated.events.some(event => event.slug === 'brisbane-2027'),
    false
  );
  assert.match(detectEventsBreakage(redated) ?? '', /1 of 6 event rows unreadable/);
  assert.match(detectEventsBreakage(parseRk9Events('<html></html>')) ?? '', /no event rows/);
});
