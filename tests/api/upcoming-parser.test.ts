/**
 * Limitless upcoming-tournaments scraper.
 *
 * Scraping breaks when someone else edits their HTML, so the fixtures here
 * deliberately include the ways that happens: reordered attributes, added line
 * breaks, HTML entities, renamed attributes, hostile hrefs, and a genuinely
 * empty schedule. The property that matters most is the last one — a
 * structurally broken parse must be distinguishable from "no events", because
 * both otherwise render as an empty list.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { classifyType, detectParseBreakage, parseUpcoming } from '../../shared/api/upcomingParser.ts';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/upcoming');

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, `${name}.html`), 'utf8');
}

// ---------------------------------------------------------------------------
// The normal page
// ---------------------------------------------------------------------------

test('a normal page yields every event, date-ascending, with its country, format and links', () => {
  const result = parseUpcoming(fixture('normal'));
  assert.deepEqual(result.events, [
    {
      date: '2026-08-14',
      country: 'JP',
      name: 'World Championships 2026',
      format: 'standard',
      type: 'worlds',
      limitlessUrl: 'https://limitlesstcg.com/tournaments/700',
      // &amp; must decode, or the second param arrives as "amp;b".
      externalUrl: 'https://worlds.pokemon.com/?a=1&b=2'
    },
    {
      date: '2026-08-29',
      country: 'PE',
      name: 'Special Event Lima',
      format: 'standard',
      type: 'special',
      limitlessUrl: 'https://limitlesstcg.com/tournaments/536',
      externalUrl: undefined
    },
    {
      date: '2026-09-12',
      country: 'US',
      name: 'Regional Championship Baltimore',
      format: 'standard',
      type: 'regional',
      limitlessUrl: 'https://limitlesstcg.com/tournaments/612',
      externalUrl: 'https://rk9.gg/event/baltimore'
    }
  ]);
  assert.equal(detectParseBreakage(result), undefined);
});

// ---------------------------------------------------------------------------
// Cosmetic upstream changes must not empty the list
// ---------------------------------------------------------------------------

test('reordered attributes and added line breaks still parse', () => {
  const result = parseUpcoming(fixture('reformatted'));
  assert.equal(result.events.length, 1);
  const [event] = result.events;
  assert.equal(event.date, '2026-09-12');
  assert.equal(event.name, 'Regional Championship Baltimore');
  assert.equal(event.country, 'US');
  assert.equal(event.limitlessUrl, 'https://limitlesstcg.com/tournaments/612');
  assert.equal(event.externalUrl, 'https://rk9.gg/event/baltimore', 'fa-solid is as valid as fas');
  assert.equal(detectParseBreakage(result), undefined);
});

test('HTML entities in names and links are decoded', () => {
  const result = parseUpcoming(fixture('entities'));
  assert.equal(result.events.length, 2);
  const [coupe, cafe] = result.events;
  assert.equal(coupe.name, "Coupe d'Europe & Friends");
  assert.equal(coupe.externalUrl, 'https://example.org/e?x=1&y=2&z=3');
  assert.equal(cafe.name, 'Café Cup  Berlin');
});

// ---------------------------------------------------------------------------
// Empty vs broken
// ---------------------------------------------------------------------------

test('renamed attributes are reported as breakage, not as an empty schedule', () => {
  const result = parseUpcoming(fixture('renamed-attributes'));
  assert.equal(result.events.length, 0);
  assert.equal(result.rowsSkipped, 2);
  assert.match(String(detectParseBreakage(result)), /markup may have changed/);
});

test('markup with rows but nothing extractable is reported as breakage', () => {
  const result = parseUpcoming('<table><tr><td>a</td></tr><tr><td>b</td></tr></table>');
  assert.equal(result.events.length, 0);
  assert.match(String(detectParseBreakage(result)), /no events from a non-empty upstream/);
});

test('a partial breakage is caught even when some rows still parse', () => {
  const html = fixture('normal').replace('data-name="Special Event Lima"', 'data-title="Special Event Lima"');
  const result = parseUpcoming(html);
  assert.equal(result.events.length, 2, 'the intact rows still come through');
  assert.equal(result.rowsSkipped, 1);
  assert.match(String(detectParseBreakage(result)), /skipped 1 row/);
});

// ---------------------------------------------------------------------------
// Malformed and hostile rows
// ---------------------------------------------------------------------------

test('malformed rows degrade individually without losing the good ones', () => {
  let result: ReturnType<typeof parseUpcoming> | undefined;
  // The fixture ends in an unterminated row.
  assert.doesNotThrow(() => {
    result = parseUpcoming(fixture('malformed'));
  });
  assert.deepEqual(result?.events, [
    {
      date: '2026-09-12',
      country: 'US',
      name: 'Complete Event',
      format: 'standard',
      type: 'other',
      limitlessUrl: 'https://limitlesstcg.com/tournaments/612',
      externalUrl: undefined
    },
    // Missing country, format and links still yields an event.
    {
      date: '2026-09-13',
      country: '',
      name: 'No Link Event',
      format: '',
      type: 'other',
      limitlessUrl: undefined,
      externalUrl: undefined
    },
    // A javascript: external link is dropped, not surfaced as clickable; the safe link survives.
    {
      date: '2026-09-14',
      country: 'XX',
      name: 'Hostile Link',
      format: 'standard',
      type: 'other',
      limitlessUrl: 'https://limitlesstcg.com/tournaments/999',
      externalUrl: undefined
    },
    // An unparseable external href is dropped. The "Blank Date" row is not emitted at all.
    {
      date: '2026-09-15',
      country: 'XX',
      name: 'Broken Link',
      format: 'standard',
      type: 'other',
      limitlessUrl: undefined,
      externalUrl: undefined
    }
  ]);
});

test('a genuinely empty schedule, and empty or non-HTML input, is empty with no warning', () => {
  // An off-season must not look like a bug.
  for (const input of [fixture('empty'), '', '   ', 'not html at all', '<html></html>']) {
    const result = parseUpcoming(input);
    assert.equal(result.events.length, 0, input);
    assert.equal(detectParseBreakage(result), undefined, input);
  }
});

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

test('event names classify into the display buckets', () => {
  for (const [name, type] of [
    ['World Championships 2026', 'worlds'],
    ['2026 Pokemon World Championship', 'worlds'],
    ['North America International Championships', 'international'],
    ['NAIC 2026', 'international'],
    ['Regional Championship Baltimore', 'regional'],
    ['Baltimore Regional Championship', 'regional'],
    ['Special Event Lima', 'special'],
    ['League Cup Toronto', 'other']
  ]) {
    assert.equal(classifyType(name), type, name);
  }
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

test('parsing is repeatable — the module-scoped regex does not carry state', () => {
  const html = fixture('normal');
  assert.deepEqual(parseUpcoming(html), parseUpcoming(html));
});
