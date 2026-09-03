import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compileExclusions,
  countField,
  fetchRecentOnlineTournaments,
  gatherDecks,
  matchExclusion,
  utcDayWindow
} from '../../shared/onlineMeta/index';
import exclusionConfig from '../../config/online-exclusions.json';

const env = { LIMITLESS_API_KEY: 'test-key' };

function tournament(id: string, players: number | null = null) {
  return {
    id,
    name: `Event ${id}`,
    date: '2026-08-20T18:00:00.000Z',
    players,
    format: 'STANDARD',
    platform: 'PTCGL',
    organizer: 'Org'
  };
}

function row(placing: number | null, index: number) {
  return {
    placing: placing ?? undefined,
    name: `Player ${index}`,
    player: `p${index}`,
    deck: { id: 'dragapult', name: 'Dragapult' },
    decklist: { pokemon: [{ name: 'Dragapult ex', count: 4, set: 'TWM', number: '130' }] }
  };
}

function standingsFetcher(byTournament: Record<string, unknown>) {
  return async (path: string) => {
    if (path === '/games/PTCG/decks') {
      return [];
    }
    const match = path.match(/^\/tournaments\/([^/]+)\/standings$/);
    if (match && match[1] in byTournament) {
      const value = byTournament[match[1]];
      if (value instanceof Error) {
        throw value;
      }
      return value;
    }
    return [];
  };
}

test('countField sizes the field by placings, not registrations', () => {
  const rows = [row(1, 1), row(2, 2), row(5, 3), row(null, 4), row(null, 5)];
  assert.deepEqual(countField(rows, 274), { registered: 274, placed: 3, unplaced: 2, fieldSize: 5 });
});

test('gatherDecks drops registrations without a placing and tags against the real field', async () => {
  // 12 placed players plus 12 ghosts; Limitless says 24 registered.
  const rows = [
    ...Array.from({ length: 12 }, (_, i) => row(i + 1, i + 1)),
    ...Array.from({ length: 12 }, (_, i) => row(null, 100 + i))
  ];
  const diagnostics: Record<string, any> = {};
  const decks = await gatherDecks(env, [tournament('t1', 24)], diagnostics, null, {
    fetchJson: standingsFetcher({ t1: rows })
  });

  assert.equal(decks.length, 12);
  assert.ok(decks.every(deck => deck.placement !== null));
  assert.ok(decks.every(deck => deck.tournamentPlayers === 12));
  assert.equal(diagnostics.entriesWithoutPlacing.length, 12);
  assert.deepEqual(diagnostics.tournamentFields.t1, { registered: 24, placed: 12, unplaced: 12, fieldSize: 12 });

  // top25 of a 12-player field is placing 3; a 24-player field would have
  // reached placing 6.
  const top25 = decks.filter(deck => deck.successTags.includes('top25')).map(deck => deck.placement);
  assert.deepEqual(top25, [1, 2, 3]);
});

test('gatherDecks skips events whose real field is below the floor', async () => {
  const rows = [
    ...Array.from({ length: 6 }, (_, i) => row(i + 1, i + 1)),
    ...Array.from({ length: 30 }, (_, i) => row(null, 50 + i))
  ];
  const diagnostics: Record<string, any> = {};
  const decks = await gatherDecks(env, [tournament('t1', 36), tournament('t2', 4)], diagnostics, null, {
    fetchJson: standingsFetcher({ t1: rows })
  });

  assert.equal(decks.length, 0);
  const skipped = diagnostics.tournamentsBelowMinimum
    .map((entry: { tournamentId: string; fieldSize: number }) => [entry.tournamentId, entry.fieldSize])
    .sort();
  assert.deepEqual(skipped, [
    ['t1', 6],
    ['t2', 4]
  ]);
});

test('gatherDecks refuses to publish when too many standings fetches fail', async () => {
  const events = Array.from({ length: 8 }, (_, i) => tournament(`t${i}`, 16));
  const byTournament: Record<string, unknown> = {};
  for (const event of events) {
    byTournament[event.id] = new Error('503');
  }
  await assert.rejects(
    () => gatherDecks(env, events, {}, null, { fetchJson: standingsFetcher(byTournament) }),
    /Standings fetch failed for 8\/8/
  );
});

test('exclusion config catches restricted-format event names and nothing ordinary', () => {
  const exclusions = compileExclusions(exclusionConfig);
  const excluded = [
    'NO Dragapult Tournament! CASH Prize',
    'Oceania Open: NO DRAGAPULT!? | S3 Wk6',
    'Oops! ALL DRAGAPULT (25 Codes)',
    'Domino No Meta #2',
    'Domino Arena No Meta',
    'Kearney Horse Only Tournament',
    'RCC Underground #12 TRAINER POKEMON ONLY',
    '2026 Content Creator Showcase'
  ];
  for (const name of excluded) {
    assert.ok(matchExclusion({ name }, exclusions), `should exclude: ${name}`);
  }
  const kept = [
    'RCC Showdown #36 | $150 USD PRIZE | NO ENTRY FEE',
    'SEASAC League Challenge #22 (SEASON 4) [50 CODES]',
    'TCG Live Sisterhood Sundays #8 Girls & Enbies!',
    'Kearney Free Totally Normal Standard Tournament',
    'Torneo Sidedeck Online Gratis Martes 25 Agosto',
    "Oscar's Best of 3 Events | First Rendition"
  ];
  for (const name of kept) {
    assert.equal(matchExclusion({ name }, exclusions), null, `should keep: ${name}`);
  }
});

test('exclusion config matches organizers by id and by name', () => {
  const exclusions = compileExclusions({ organizerIds: ['abc'], organizerNames: ['Gimmick  Store'] });
  assert.deepEqual(matchExclusion({ name: 'Weekly', organizerId: 'abc' }, exclusions), {
    reason: 'organizer-id',
    matched: 'abc'
  });
  assert.deepEqual(matchExclusion({ name: 'Weekly', organizer: 'gimmick store' }, exclusions), {
    reason: 'organizer-name',
    matched: 'gimmick store'
  });
  assert.equal(matchExclusion({ name: 'Weekly', organizer: 'Other Store' }, exclusions), null);
});

test('fetchRecentOnlineTournaments records excluded events on diagnostics', async () => {
  const fetchJson = async (path: string) => {
    if (path === '/tournaments') {
      return [
        { id: 'a', name: 'Normal Weekly', date: '2026-08-20T18:00:00.000Z' },
        { id: 'b', name: 'NO Dragapult Tournament!', date: '2026-08-20T18:00:00.000Z' }
      ];
    }
    return { decklists: true, isOnline: true, format: 'standard', organizer: { name: 'Org', id: 'org-1' } };
  };
  const diagnostics: Record<string, any> = {};
  const found = await fetchRecentOnlineTournaments(env, new Date('2026-08-01T00:00:00Z'), {
    fetchJson,
    diagnostics,
    maxPages: 1,
    exclusions: compileExclusions(exclusionConfig)
  });
  assert.deepEqual(
    found.map(entry => entry.id),
    ['a']
  );
  assert.equal(found[0].organizerId, 'org-1');
  assert.equal(diagnostics.excludedTournaments.length, 1);
  assert.equal(diagnostics.excludedTournaments[0].tournamentId, 'b');
  assert.equal(diagnostics.excludedTournaments[0].reason, 'name-pattern');
});

test('utcDayWindow covers whole days ending at the start of today', () => {
  const window = utcDayWindow(new Date('2026-09-03T12:17:00Z'), 14);
  assert.equal(window.start.toISOString(), '2026-08-20T00:00:00.000Z');
  assert.equal(window.end.toISOString(), '2026-09-03T00:00:00.000Z');
  assert.equal(window.lastInstant.toISOString(), '2026-09-02T23:59:59.999Z');
  assert.equal(window.days, 14);
});
