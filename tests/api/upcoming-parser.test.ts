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

test('a normal page yields every event, date-ascending', () => {
  const result = parseUpcoming(fixture('normal'));
  assert.equal(result.events.length, 3);
  assert.deepEqual(
    result.events.map(e => e.date),
    ['2026-08-14', '2026-08-29', '2026-09-12']
  );
  assert.equal(detectParseBreakage(result), undefined);
});

test('each event carries its country, format, and Limitless link', () => {
  const [worlds, lima, baltimore] = parseUpcoming(fixture('normal')).events;
  assert.equal(baltimore.name, 'Regional Championship Baltimore');
  assert.equal(baltimore.country, 'US');
  assert.equal(baltimore.format, 'standard');
  assert.equal(baltimore.limitlessUrl, 'https://limitlesstcg.com/tournaments/612');
  assert.equal(baltimore.externalUrl, 'https://rk9.gg/event/baltimore');
  assert.equal(lima.country, 'PE');
  assert.equal(lima.externalUrl, undefined, 'no external link in that row');
  assert.equal(worlds.type, 'worlds');
});

test('an external link keeps its query string intact', () => {
  const worlds = parseUpcoming(fixture('normal')).events.find(e => e.type === 'worlds');
  // &amp; must decode, or the second param arrives as "amp;b".
  assert.equal(worlds?.externalUrl, 'https://worlds.pokemon.com/?a=1&b=2');
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

test('a genuinely empty schedule is empty, with no warning', () => {
  const result = parseUpcoming(fixture('empty'));
  assert.equal(result.events.length, 0);
  assert.equal(detectParseBreakage(result), undefined, 'an off-season must not look like a bug');
});

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
  const result = parseUpcoming(fixture('malformed'));
  const complete = result.events.find(e => e.name === 'Complete Event');
  assert.ok(complete, 'the well-formed row survives its broken neighbors');
  assert.equal(complete.date, '2026-09-12');
  assert.equal(complete.limitlessUrl, 'https://limitlesstcg.com/tournaments/612');
  assert.equal(complete.externalUrl, undefined);
});

test('a row missing country and format still yields an event', () => {
  const event = parseUpcoming(fixture('malformed')).events.find(e => e.name === 'No Link Event');
  assert.ok(event);
  assert.equal(event.country, '');
  assert.equal(event.format, '');
  assert.equal(event.limitlessUrl, undefined);
});

test('a javascript: external link is dropped, not surfaced as clickable', () => {
  const event = parseUpcoming(fixture('malformed')).events.find(e => e.name === 'Hostile Link');
  assert.ok(event);
  assert.equal(event.externalUrl, undefined);
  assert.equal(event.limitlessUrl, 'https://limitlesstcg.com/tournaments/999', 'the safe link survives');
});

test('an unparseable external href is dropped', () => {
  const event = parseUpcoming(fixture('malformed')).events.find(e => e.name === 'Broken Link');
  assert.ok(event);
  assert.equal(event.externalUrl, undefined);
});

test('a row with a blank date is not emitted', () => {
  const { events } = parseUpcoming(fixture('malformed'));
  assert.equal(
    events.some(e => e.name === 'Blank Date'),
    false
  );
});

test('an unterminated final row does not throw', () => {
  assert.doesNotThrow(() => parseUpcoming(fixture('malformed')));
});

test('empty and non-HTML input is safe', () => {
  for (const input of ['', '   ', 'not html at all', '<html></html>']) {
    const result = parseUpcoming(input);
    assert.equal(result.events.length, 0);
    assert.equal(detectParseBreakage(result), undefined);
  }
});

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

test('event names classify into the display buckets', () => {
  assert.equal(classifyType('World Championships 2026'), 'worlds');
  assert.equal(classifyType('2026 Pokemon World Championship'), 'worlds');
  assert.equal(classifyType('North America International Championships'), 'international');
  assert.equal(classifyType('NAIC 2026'), 'international');
  assert.equal(classifyType('Regional Championship Baltimore'), 'regional');
  assert.equal(classifyType('Baltimore Regional Championship'), 'regional');
  assert.equal(classifyType('Special Event Lima'), 'special');
  assert.equal(classifyType('League Cup Toronto'), 'other');
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

test('parsing is repeatable — the module-scoped regex does not carry state', () => {
  const html = fixture('normal');
  const first = parseUpcoming(html);
  const second = parseUpcoming(html);
  const third = parseUpcoming(html);
  assert.deepEqual(first, second);
  assert.deepEqual(second, third);
});
