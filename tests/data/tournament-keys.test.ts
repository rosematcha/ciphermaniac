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
  resolveScopeSlug,
  scopeSlug,
  shortTournamentName,
  tournamentDate
} from '../../shared/data/tournamentKeys.ts';

const LA = '2026-05-08, Regional Championship Los Angeles';
const NAIC = '2026-06-20, North America International Championship';
const LIMA = '2026-08-29, Special Event Lima';
const WORLDS = '2026-08-28, World Championship San Francisco';

// ---------------------------------------------------------------------------
// classifyTournament
// ---------------------------------------------------------------------------

test('events classify by their name, case-insensitively, and anything unparseable is other', () => {
  const cases: Array<[string, string]> = [
    [LA, 'regional'],
    [NAIC, 'international'],
    [LIMA, 'special'],
    [WORLDS, 'worlds'],
    [ONLINE_META_NAME, 'online'],
    ['2026-01-01, League Cup Toronto', 'other'],
    ['2026-05-08, REGIONAL CHAMPIONSHIP Los Angeles', 'regional'],
    ['2026-06-20, north america international championship', 'international'],
    ['', 'other'],
    ['not a tournament key', 'other']
  ];
  for (const [key, expected] of cases) {
    assert.equal(classifyTournament(key), expected, key);
  }
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

test('the online meta, a key without a date prefix, and an impossible date all yield null', () => {
  for (const key of [
    ONLINE_META_NAME,
    'Regional Championship Los Angeles',
    '',
    '26-05-08, Short Year',
    // Date() would silently roll 2026-02-31 into March; the parser must not.
    '2026-13-45, Nonsense Event'
  ]) {
    assert.equal(tournamentDate(key), null, key);
  }
});

// ---------------------------------------------------------------------------
// prettyTournamentName
// ---------------------------------------------------------------------------

test('a dated key renders as name then date', () => {
  const pretty = prettyTournamentName(LA);
  assert.match(pretty, /^Los Angeles Regionals · /);
  assert.match(pretty, /2026/);
  assert.ok(!pretty.startsWith('2026-05-08'), 'the raw date prefix must not survive');
});

test('the online meta renders as its label, and any other undated key is returned unmangled', () => {
  assert.equal(prettyTournamentName(ONLINE_META_NAME), ONLINE_META_LABEL);
  for (const key of ['Some Other Thing', '', '2026-13-45, Nonsense Event']) {
    assert.equal(prettyTournamentName(key), key, key);
  }
});

test('shortTournamentName makes event tiers compact and city-first', () => {
  assert.equal(shortTournamentName('Regional Championship Melbourne'), 'Melbourne Regionals');
  assert.equal(shortTournamentName('International Championship New Orleans'), 'New Orleans Internationals');
  assert.equal(shortTournamentName('World Championship San Francisco'), 'Worlds San Francisco');
  assert.equal(shortTournamentName('League Cup Toronto'), 'League Cup Toronto');
});

// ---------------------------------------------------------------------------
// majorTournaments
// ---------------------------------------------------------------------------

test('majors are worlds, internationals, regionals, and special events, in input order', () => {
  const list = [WORLDS, LA, NAIC, LIMA, ONLINE_META_NAME, '2026-01-01, League Cup Toronto'];
  assert.deepEqual(majorTournaments(list), [WORLDS, LA, NAIC, LIMA]);
  assert.deepEqual(majorTournaments([LIMA, NAIC, LA]), [LIMA, NAIC, LA]);
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

test('scope slugs are short for the online scope and fold punctuation and diacritics', () => {
  assert.equal(scopeSlug(ONLINE_META_NAME), 'online');
  const key = '2026-09-12, São Paulo Regional: Masters & Juniors!';
  assert.equal(scopeSlug(key), '2026-09-12-sao-paulo-regional-masters-juniors');
});

test('scope slugs round trip through a published list, and an unknown or unpublished one does not resolve', () => {
  const keys = [ONLINE_META_NAME, LA, NAIC, LIMA, WORLDS];
  for (const key of keys) {
    assert.equal(resolveScopeSlug(scopeSlug(key), keys), key);
  }
  assert.equal(resolveScopeSlug('2026-01-01-unknown', [ONLINE_META_NAME, LA]), null);
  assert.equal(resolveScopeSlug(scopeSlug(LA), [ONLINE_META_NAME]), null);
});
