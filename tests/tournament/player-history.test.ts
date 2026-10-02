/**
 * One player's event as History reads it from the public copy: place,
 * division, record, deck and rounds, the same as the event page's standings
 * say, and the day an event is on.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { describe } from 'node:test';

import { applyCommand, type Command } from '../../shared/tournament/commands.ts';
import { emptyTournament } from '../../shared/tournament/create.ts';
import { seededRandom } from '../../shared/tournament/random.ts';
import { parseTdf } from '../../shared/tournament/tdf.ts';
import type { Pod, Tournament } from '../../shared/tournament/types.ts';
import {
  assignKeys,
  DEFAULT_SETTINGS,
  publicDecks,
  publicDivisions,
  publicTournament,
  type PublishedView,
  type TournamentSettings
} from '../../shared/tournament/view.ts';
import { eventDay, playerResult, readEntry } from '../../src/lib/tournament/history.ts';
import { namesById, podStandings } from '../../src/lib/tournament/present.ts';
import { juniorsCutApart } from '../__utils__/divisionCuts.ts';

const CHALLENGE = parseTdf(readFileSync(new URL('../fixtures/tdf/challenge-midevent.tdf', import.meta.url), 'utf8'));

function run(tournament: Tournament, ...commands: Command[]): Tournament {
  return commands.reduce((current, command) => {
    const result = applyCommand(current, command, {
      now: 0,
      localTime: '10/10/2026 10:00:00',
      season: 2027,
      random: seededRandom(3)
    });
    assert.ok(result.ok, result.ok ? '' : result.error);
    return result.tournament;
  }, tournament);
}

test('an event’s day: the organizer’s start time, else TOM’s date, with the year only outside this one', () => {
  const thisYear = new Date().getFullYear();
  assert.match(eventDay(`${thisYear}-10-03T11:00`, ''), /Oct 3/);
  assert.doesNotMatch(eventDay(`${thisYear}-10-03T11:00`, ''), new RegExp(String(thisYear)));
  assert.match(eventDay('', '10/03/2025'), /Oct 3, 2025|3 Oct 2025/);
  assert.equal(eventDay('', ''), '', 'neither set');
});

describe('one player’s event, read from the public copy as History reads it', () => {
  /** The copy the site publishes of `t`, as the event page and History fetch it. */
  function copyOf(
    t: Tournament,
    event: { mode?: 'swiss' | 'tom'; settings?: Partial<TournamentSettings>; decks?: Record<string, string> } = {}
  ): { view: PublishedView; keys: Record<string, string> } {
    const settings = { ...DEFAULT_SETTINGS, ...event.settings };
    const keys = assignKeys(t, {});
    const short = event.mode !== 'tom' && !settings.sanctioned;
    return {
      keys,
      view: {
        code: 'ABCDEF',
        mode: event.mode ?? 'tom',
        version: 1,
        updatedAt: 0,
        tournament: publicTournament(t, keys, short),
        pending: [],
        reports: [],
        divisions: publicDivisions(t, keys, Date.UTC(2026, 9, 3)),
        decks: publicDecks(event.decks ?? {}, keys),
        settings
      }
    };
  }

  test('the match for third is named for itself, not for the final it shares a round with', () => {
    const latest = (t: Tournament) => t.pods[0]?.rounds.at(-1);
    const reportAll = (t: Tournament): Tournament => {
      const round = latest(t);
      const open = round?.matches.filter(m => m.outcome === 'pending') ?? [];
      return run(
        t,
        ...open.map(m => ({
          type: 'reportResult' as const,
          pod: 'masters' as const,
          round: round?.number ?? 0,
          table: m.table,
          p1: m.p1,
          p2: m.p2,
          outcome: 'p1' as const
        }))
      );
    };
    const adds: Command[] = Array.from({ length: 8 }, (_, i) => ({
      type: 'addPlayer',
      player: { firstName: 'Player', lastName: String(i), id: String(300 + i), birthDate: '01/01/1990' }
    }));
    let t = run(emptyTournament({ name: 'Cup' }), ...adds);
    for (let i = 0; i < 3; i += 1) {
      t = reportAll(run(t, { type: 'pairRound', pod: 'masters' }));
    }
    t = reportAll(run(t, { type: 'startTopCut', pod: 'masters', size: 4, playoff3rd4th: true }));
    t = reportAll(run(t, { type: 'pairRound', pod: 'masters' }));
    const [final, third] = latest(t)?.matches ?? [];
    const { view, keys } = copyOf(t, { mode: 'swiss' });
    const lastLabel = (id: string | undefined) => playerResult(view, keys[id ?? ''] ?? '')?.rounds.at(-1)?.label;
    assert.equal(lastLabel(final?.p2 ?? undefined), 'Final');
    assert.equal(lastLabel(third?.p1), 'Third place');
    assert.equal(playerResult(view, keys[third?.p1 ?? ''] ?? '')?.place, 3);
  });

  test('mid-event: place in the division, record, every round with a bye, and who dropped', () => {
    const { view, keys } = copyOf(CHALLENGE);
    const mary = playerResult(view, keys['7200001'] ?? '');
    assert.equal(mary?.division, 'masters');
    assert.equal(mary?.place, 1);
    assert.deepEqual(mary?.record, { wins: 1, losses: 0, ties: 0 });
    assert.deepEqual(
      mary?.rounds.map(row => [row.label, row.table, row.opponent, row.mark]),
      [
        ['Round 1', 1, keys['7200002'], 'W'],
        ['Round 2', 1, keys['7200004'], '']
      ],
      'opponents under their public keys, an open round with no mark'
    );
    const dorothy = playerResult(view, keys['7200002'] ?? '');
    assert.deepEqual([dorothy?.division, dorothy?.place], ['junior', 1], 'ranked in her own division');
    assert.deepEqual(
      dorothy?.rounds.map(row => [row.round, row.opponent, row.mark, row.outcome]),
      [
        [1, keys['7200001'], 'L', 'p1'],
        [2, null, 'W', 'bye']
      ]
    );
    assert.equal(playerResult(view, keys['7200003'] ?? '')?.dropped, true);
    assert.equal(mary?.dropped, false);
  });

  test('no player under the key is no entry', () => {
    assert.equal(playerResult(copyOf(CHALLENGE).view, '999'), null);
  });

  test('the place matches the standings the event page draws', () => {
    const { view } = copyOf(CHALLENGE);
    const p = view.tournament.pods[0] as Pod;
    const rows = podStandings(view.tournament, p, id => view.divisions[id] ?? 'masters').flatMap(g => g.rows);
    for (const row of rows) {
      assert.equal(playerResult(view, row.playerId)?.place, row.place);
    }
  });

  test('a result entered on the site counts once TOM has it, as in the page’s standings', () => {
    const { view, keys } = copyOf(CHALLENGE);
    const open = view.tournament.pods[0]?.rounds[1]?.matches.find(m => m.outcome === 'pending');
    assert.ok(open);
    const pending = [
      { pod: 'mixed' as const, round: 2, table: open.table, p1: open.p1, p2: open.p2, outcome: 'p2' as const, at: 0 }
    ];
    const mary = keys['7200001'] ?? '';
    assert.deepEqual(playerResult({ ...view, pending }, mary), playerResult(view, mary));
  });

  test('a deck shows only while the public may see it', () => {
    const decks = { '7200001': 'Gardevoir ex' };
    const key = (view: PublishedView) => view.tournament.players[0]?.id ?? '';
    const shown = (settings: Partial<TournamentSettings>) => {
      const { view } = copyOf(CHALLENGE, { settings, decks });
      return playerResult(view, key(view))?.deck;
    };
    assert.equal(shown({ deckVisibility: 'always' }), 'Gardevoir ex');
    assert.equal(shown({ deckVisibility: 'after' }), null, 'held back until the event ends');
    assert.equal(shown({ deckVisibility: 'after', finished: true }), 'Gardevoir ex');
    assert.equal(shown({ deckVisibility: 'off' }), null);
  });

  test('a finished event with a top cut: the cut’s rounds by name, and places from the cut', () => {
    const t = juniorsCutApart();
    const { view, keys } = copyOf(t, { mode: 'swiss', settings: { finished: true } });
    const final = t.pods.find(p => p.category === 'junior')?.rounds.at(-1)?.matches[0];
    const champion = playerResult(view, keys[final?.p1 ?? ''] ?? '');
    const finalist = playerResult(view, keys[final?.p2 ?? ''] ?? '');
    assert.deepEqual([champion?.place, finalist?.place], [1, 2]);
    assert.deepEqual(
      champion?.rounds.map(row => [row.label, row.kind, row.mark]),
      [
        ['Round 1', 'swiss', 'W'],
        ['Semifinals', 'elimination', 'W'],
        ['Final', 'elimination', 'W']
      ]
    );
    assert.deepEqual(
      champion?.record,
      { wins: 1, losses: 0, ties: 0 },
      'the record is the Swiss one, as standings show'
    );
    const masters = t.players.find(p => p.birthDate.endsWith('1990'));
    const master = playerResult(view, keys[masters?.id ?? ''] ?? '');
    assert.equal(master?.division, 'masters');
    assert.deepEqual(
      master?.rounds.map(row => row.kind),
      ['swiss'],
      'a division with no cut played only Swiss'
    );
  });

  test('before round 1 a player has no place yet', () => {
    const t = run(emptyTournament({ name: 'Soon' }), {
      type: 'addPlayer',
      player: { firstName: 'Ash', lastName: 'Ketchum', id: '11' }
    });
    const { view, keys } = copyOf(t, { mode: 'swiss' });
    assert.deepEqual(playerResult(view, keys['11'] ?? ''), {
      division: 'masters',
      place: null,
      record: null,
      deck: null,
      dropped: false,
      rounds: []
    });
  });

  test('at an unsanctioned event: no division, and opponents under their shortened names', () => {
    const t = run(
      emptyTournament({ name: 'Locals' }),
      ...[
        ['Ash', 'Ketchum'],
        ['Ash', 'Kelly'],
        ['Misty', 'Waterflower'],
        ['Brock', 'Harrison']
      ].map(([firstName, lastName]) => ({ type: 'addPlayer', player: { firstName, lastName } }) as Command),
      { type: 'pairRound', pod: 'masters' }
    );
    const { view } = copyOf(t, { mode: 'swiss', settings: { sanctioned: false } });
    const names = namesById(view.tournament);
    const [first] = view.tournament.players;
    const result = playerResult(view, first?.id ?? '');
    assert.equal(result?.division, null);
    const opponent = result?.rounds[0]?.opponent ?? '';
    assert.ok(opponent);
    assert.doesNotMatch(names.get(opponent) ?? '', /Ketchum|Kelly|Waterflower|Harrison/);
    assert.deepEqual(
      [...names.values()].sort(),
      ['Ash Kel.', 'Ash Ket.', 'Brock H.', 'Misty W.'],
      'the copy carries the names the public page shows'
    );
  });
});

test('a History row takes the names, and the decks only while the public may see them', () => {
  const keys = assignKeys(CHALLENGE, {});
  const view: PublishedView = {
    code: 'ABCDEF',
    mode: 'tom',
    version: 1,
    updatedAt: 0,
    tournament: publicTournament(CHALLENGE, keys),
    pending: [],
    reports: [],
    divisions: publicDivisions(CHALLENGE, keys, Date.UTC(2026, 9, 3)),
    decks: publicDecks({ '7200001': 'Gardevoir ex' }, keys),
    settings: { ...DEFAULT_SETTINGS, deckVisibility: 'after' }
  };
  const entry = {
    code: 'ABCDEF',
    key: keys['7200001'] ?? '',
    name: 'Fixture Challenge & Friends',
    startDate: '10/03/2026',
    startsAt: '',
    format: 'Standard',
    mode: 'tom' as const,
    status: 'live' as const
  };
  const hidden = readEntry(entry, view);
  assert.deepEqual(hidden?.decks, {});
  assert.equal(hidden?.names.get(keys['7200002'] ?? ''), 'Dorothy Vaughan');
  const shown = readEntry(entry, { ...view, settings: { ...view.settings, deckVisibility: 'always' } });
  assert.deepEqual(shown?.decks, view.decks);
  assert.equal(readEntry({ ...entry, key: '999' }, view), null);
});
