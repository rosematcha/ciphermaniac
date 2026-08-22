/**
 * The tournament-key format.
 *
 * A key is `YYYY-MM-DD, Event Name` and doubles as the R2 folder name, so
 * parsing it is a data concern, not a display one — the daily majors-trends
 * pipeline classifies and dates events exactly the way the selector does. The
 * rolling online meta is the one key that does not follow the format; every
 * function here has to special-case it.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyTournament,
  majorTournaments,
  ONLINE_META_LABEL,
  ONLINE_META_NAME,
  prettyTournamentName,
  tournamentDate
} from '../../shared/data/tournamentKeys.ts';

const LA = '2026-05-08, Regional Championship Los Angeles';
const NAIC = '2026-06-20, North America International Championship';
const LIMA = '2026-08-29, Special Event Lima';

// ---------------------------------------------------------------------------
// classifyTournament
// ---------------------------------------------------------------------------

test('events classify by their name', () => {
  assert.equal(classifyTournament(LA), 'regional');
  assert.equal(classifyTournament(NAIC), 'international');
  assert.equal(classifyTournament(LIMA), 'special');
  assert.equal(classifyTournament(ONLINE_META_NAME), 'online');
  assert.equal(classifyTournament('2026-01-01, League Cup Toronto'), 'other');
});

test('classification is case-insensitive', () => {
  assert.equal(classifyTournament('2026-05-08, REGIONAL CHAMPIONSHIP Los Angeles'), 'regional');
  assert.equal(classifyTournament('2026-06-20, north america international championship'), 'international');
});

test('an unparseable key classifies as other rather than throwing', () => {
  assert.equal(classifyTournament(''), 'other');
  assert.equal(classifyTournament('not a tournament key'), 'other');
});

// ---------------------------------------------------------------------------
// tournamentDate
// ---------------------------------------------------------------------------

test('the date prefix parses to a local calendar date', () => {
  const d = tournamentDate(LA);
  assert.ok(d);
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 4, 'May is month index 4');
  assert.equal(d.getDate(), 8);
});

test('the online meta has no date', () => {
  assert.equal(tournamentDate(ONLINE_META_NAME), null);
});

test('a key without a parseable date prefix yields null', () => {
  assert.equal(tournamentDate('Regional Championship Los Angeles'), null);
  assert.equal(tournamentDate(''), null);
  assert.equal(tournamentDate('26-05-08, Short Year'), null);
});

test('an impossible calendar date yields null rather than a rolled-over one', () => {
  // Date() would silently roll 2026-02-31 into March; the parser must not.
  const d = tournamentDate('2026-13-45, Nonsense Event');
  assert.equal(d, null);
});

test('dates sort chronologically, which is what the majors window relies on', () => {
  const keys = [LIMA, LA, NAIC];
  const sorted = [...keys].sort((a, b) => (tournamentDate(a)?.getTime() ?? 0) - (tournamentDate(b)?.getTime() ?? 0));
  assert.deepEqual(sorted, [LA, NAIC, LIMA]);
});

// ---------------------------------------------------------------------------
// prettyTournamentName
// ---------------------------------------------------------------------------

test('a dated key renders as name then date', () => {
  const pretty = prettyTournamentName(LA);
  assert.match(pretty, /^Regional Championship Los Angeles · /);
  assert.match(pretty, /2026/);
  assert.ok(!pretty.startsWith('2026-05-08'), 'the raw date prefix must not survive');
});

test('the online meta renders as its label', () => {
  assert.equal(prettyTournamentName(ONLINE_META_NAME), ONLINE_META_LABEL);
});

test('an unrecognized key is returned unchanged rather than mangled', () => {
  assert.equal(prettyTournamentName('Some Other Thing'), 'Some Other Thing');
  assert.equal(prettyTournamentName(''), '');
});

test('an unparseable date leaves the key untouched', () => {
  const key = '2026-13-45, Nonsense Event';
  assert.equal(prettyTournamentName(key), key);
});

// ---------------------------------------------------------------------------
// majorTournaments
// ---------------------------------------------------------------------------

test('majors are regionals, internationals, and special events', () => {
  const list = [LA, NAIC, LIMA, ONLINE_META_NAME, '2026-01-01, League Cup Toronto'];
  assert.deepEqual(majorTournaments(list), [LA, NAIC, LIMA]);
});

test('filtering preserves input order', () => {
  const list = [LIMA, NAIC, LA];
  assert.deepEqual(majorTournaments(list), [LIMA, NAIC, LA]);
});

test('the online meta is never a major', () => {
  assert.deepEqual(majorTournaments([ONLINE_META_NAME]), []);
});

test('an empty list stays empty', () => {
  assert.deepEqual(majorTournaments([]), []);
});

// ---------------------------------------------------------------------------
// The online key itself
// ---------------------------------------------------------------------------

test('the online key is the R2 folder name verbatim, and the label is not', () => {
  // The key doubles as a fetch path; swapping in the display label would 404.
  assert.equal(ONLINE_META_NAME, 'Online - Last 14 Days');
  assert.notEqual(ONLINE_META_LABEL, ONLINE_META_NAME);
});
