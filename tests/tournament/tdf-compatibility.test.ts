import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { parseTdf, wasFinalized, writeTdf } from '../../shared/tournament/tdf.ts';
import { LIMITS, readTournament } from '../../shared/tournament/validate.ts';
import { attr, child, children, childText, parseXml } from '../../shared/tournament/xml.ts';
import { tdfText } from '../../src/lib/tournament/exportTdf.ts';

const directory = new URL('../fixtures/tdf/', import.meta.url);
const fixture = (name: string) => readFileSync(new URL(name, directory), 'utf8');
const samples = readdirSync(directory).filter(name => name.startsWith('tom-'));

for (const name of samples) {
  test(`${name}: imports, survives server validation, and preserves all TOM data on export`, () => {
    const source = fixture(name);
    const tournament = parseTdf(source);
    const stored = readTournament(JSON.parse(JSON.stringify(tournament)));
    assert.deepEqual(stored, tournament);
    assert.ok(stored);
    const exported = tdfText({ tournament: stored, pending: [], finished: false });
    assert.deepEqual(parseXml(exported), parseXml(source));
    assert.equal(wasFinalized(parseTdf(exported)), wasFinalized(tournament));
    assert.equal(writeTdf(parseTdf(exported)), exported);
  });
}

test('a TOM stage 4 round stays playing while site results are written', () => {
  const tournament = parseTdf(fixture('tom-182-inprogress.tdf'));
  const pod = tournament.pods[0]!;
  const round = pod.rounds[0]!;
  assert.equal(round.status, 'started');
  const match = round.matches[0]!;
  const exported = tdfText({
    tournament,
    pending: [{ pod: pod.category, round: round.number, ...match, p2: match.p2!, outcome: 'p1', at: 0 }],
    finished: false
  });
  const parsed = parseTdf(exported);
  assert.equal(parsed.pods[0]?.rounds[0]?.matches[0]?.outcome, 'p1');
  assert.equal(parsed.passthrough?.roundCodes['masters:1']?.stage, '4');
  assert.equal(wasFinalized(parsed), false);
});

test('saved TOM standings survive metadata edits but are recomputed after a result or roster change', () => {
  const tournament = parseTdf(fixture('tom-184-mixed.tdf'));
  const original = parseXml(writeTdf(tournament));
  const metadata = { ...tournament, info: { ...tournament.info, name: 'Renamed' } };
  assert.deepEqual(child(parseXml(writeTdf(metadata)), 'standings'), child(original, 'standings'));
  const changed = structuredClone(tournament);
  const match = changed.pods[0]!.rounds[0]!.matches.find(m => m.p2 !== null)!;
  match.outcome = match.outcome === 'p1' ? 'p2' : 'p1';
  assert.notDeepEqual(child(parseXml(writeTdf(changed)), 'standings'), child(original, 'standings'));
  const removed = structuredClone(tournament);
  const { id } = removed.players.pop()!;
  removed.pods[0]!.playerIds = removed.pods[0]!.playerIds.filter(p => p !== id);
  removed.pods[0]!.rounds.forEach(r => {
    r.matches = r.matches.filter(m => m.p1 !== id && m.p2 !== id);
  });
  const standings = child(parseXml(writeTdf(removed)), 'standings');
  assert.ok(children(standings, 'pod').every(p => children(p, 'player').every(p => attr(p, 'id') !== id)));
});

test('an explicitly reopened tournament omits finalized standings', () => {
  const tournament = parseTdf(fixture('tom-184-challenge.tdf'));
  const root = parseXml(writeTdf(tournament, { finalized: false }));
  assert.equal(attr(root, 'stage'), '4');
  assert.equal(child(root, 'standings'), undefined);
});

test('drop timestamps and nested metadata survive, and undropping removes the saved drop', () => {
  const tournament = parseTdf(fixture('tom-182-drop-stage5.tdf'));
  const player = tournament.players.find(p => p.droppedAfter !== null)!;
  const original = player.droppedAfter;
  const dropOf = () =>
    child(
      children(child(parseXml(writeTdf(tournament)), 'players'), 'player').find(p => attr(p, 'userid') === player.id),
      'dropped'
    );
  assert.ok(childText(dropOf(), 'timestamp'));
  player.droppedAfter = original! + 1;
  assert.equal(childText(dropOf(), 'round'), String(original! + 1));
  assert.equal(childText(dropOf(), 'timestamp'), player.modified);
  player.droppedAfter = null;
  assert.equal(dropOf(), undefined);
});

test('TOM starter flags map late entrants both ways', () => {
  const source = fixture('tom-182-masters.tdf').replace('<starter>true</starter>', '<starter>false</starter>');
  const tournament = parseTdf(source);
  assert.equal(tournament.players[0]?.late, true);
  // TOM writes no false starter: a late entrant has a <late> block instead.
  const written = writeTdf(tournament);
  assert.ok(!written.includes('<starter>false</starter>'));
  assert.equal(parseTdf(written).players[0]?.late, true);
  delete tournament.passthrough;
  assert.equal(parseTdf(writeTdf(tournament)).players[0]?.late, true);
});

test('saved standings accept regional-sized blocks and refuse malformed or excessive payloads', () => {
  const tournament = parseTdf(fixture('tom-184-challenge.tdf'));
  assert.ok(tournament.passthrough?.standings);
  tournament.passthrough.standings.xml = 'x'.repeat(LIMITS.passthrough + 1);
  assert.ok(readTournament(tournament));
  tournament.passthrough.standings.xml = 'x'.repeat(LIMITS.standings + 1);
  assert.equal(readTournament(tournament), null);
  assert.equal(readTournament({ ...tournament, passthrough: { ...tournament.passthrough, standings: null } }), null);
});

test('a new League Challenge is written as TOM writes one: root and Swiss rounds of type 2', () => {
  const tournament = parseTdf(fixture('tom-184-mixed-drop.tdf'));
  delete tournament.passthrough;
  tournament.info.eventType = 'challenge';
  const root = parseXml(writeTdf(tournament));
  assert.equal(attr(root, 'type'), '2');
  assert.equal(attr(root, 'mode'), 'LEAGUECHALLENGE');
  const rounds = children(child(child(child(root, 'pods'), 'pod'), 'rounds'), 'round');
  assert.ok(rounds.length > 0 && rounds.every(r => attr(r, 'type') === '2'));
  assert.equal(parseTdf(writeTdf(tournament)).info.eventType, 'challenge');
  assert.equal(parseTdf(fixture('tom-184-challenge.tdf')).info.eventType, 'challenge', 'TOM’s own Challenge');
});

test('new files contain TOM event, roster, round, standings, and top-cut fields', () => {
  const tournament = parseTdf(fixture('tom-184-mixed-drop.tdf'));
  delete tournament.passthrough;
  // A Custom event in TOM, which writes type 2 as a Challenge does: read as a Cup.
  assert.equal(tournament.info.eventType, undefined);
  tournament.pods[0]!.cut = 4;
  const written = writeTdf(tournament, { finalized: true });
  const root = parseXml(written);
  assert.deepEqual(Object.fromEntries(root.attrs), {
    type: '3',
    stage: '5',
    version: '1.86',
    gametype: 'TRADING_CARD_GAME',
    mode: 'TCG1DAY'
  });
  assert.deepEqual(
    root.children.map(c => c.name),
    ['data', 'timeelapsed', 'players', 'pods', 'standings', 'finalsoptions']
  );
  const data = child(root, 'data');
  assert.equal(childText(data, 'id'), tournament.info.sanctionId);
  assert.equal(attr(child(data, 'organizer'), 'popid'), tournament.info.organizerPopId);
  const pod = child(child(root, 'pods'), 'pod')!;
  assert.equal(childText(child(pod, 'poddata'), 'subgroupcount'), '1');
  const rounds = children(child(pod, 'rounds'), 'round');
  assert.equal(attr(rounds.at(-1), 'stage'), '8');
  assert.ok(rounds.every(r => attr(r, 'type') === '3'));
  const standings = children(child(root, 'standings'), 'pod');
  const rows = standings.flatMap(p => children(p, 'player'));
  assert.equal(rows.length, tournament.players.length);
  assert.equal(new Set(rows.map(p => attr(p, 'id'))).size, tournament.players.length);
  assert.ok(standings.some(p => attr(p, 'category') === '1' && children(p, 'player').length > 0));
  for (const cut of children(child(root, 'finalsoptions'), 'categorycut')) {
    const count = Number(childText(cut, 'playercount'));
    assert.deepEqual(
      children(child(cut, 'options'), 'value').map(v => v.text),
      ['0', ...(count >= 9 ? ['4'] : []), ...(count > 20 ? ['8'] : [])]
    );
  }
  assert.ok(readTournament(parseTdf(written)));
});

test('a finalized export refuses unresolved matches but allows an in-progress TOM file', () => {
  const tournament = parseTdf(fixture('tom-182-inprogress.tdf'));
  assert.throws(() => writeTdf(tournament, { finalized: true }), /Enter all match results/);
  assert.doesNotThrow(() => writeTdf(tournament));
});

test('a newly dropped player does not reuse an inactive saved drop', () => {
  const source = fixture('tom-182-drop-stage5.tdf').replace('<status>1</status>', '<status>0</status>');
  const tournament = parseTdf(source);
  const player = tournament.players.find(p =>
    tournament.passthrough?.playerExtras[p.id]?.some(([key]) => key === 'dropped')
  )!;
  assert.equal(player.droppedAfter, null);
  player.droppedAfter = 2;
  const exported = children(child(parseXml(writeTdf(tournament)), 'players'), 'player').find(
    p => attr(p, 'userid') === player.id
  );
  assert.equal(childText(child(exported, 'dropped'), 'status'), '1');
});

test('finalizing results supplied by the site also finalizes the round stage', () => {
  const tournament = parseTdf(fixture('tom-182-inprogress.tdf'));
  const pod = tournament.pods[0]!;
  const round = pod.rounds[0]!;
  const pending = round.matches.map(match => ({
    pod: pod.category,
    round: round.number,
    ...match,
    p2: match.p2!,
    outcome: 'p1' as const,
    at: 0
  }));
  const exported = parseXml(tdfText({ tournament, pending, finished: true }));
  const last = children(child(child(child(exported, 'pods'), 'pod'), 'rounds'), 'round').at(-1);
  assert.equal(attr(exported, 'stage'), '5');
  assert.equal(attr(last, 'stage'), '8');
  assert.equal(attr(last, 'type'), '2');
});
