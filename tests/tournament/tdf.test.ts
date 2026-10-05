/**
 * Reading and writing TOM's .tdf. The finalized fixture is a real TOM 1.86
 * file with the names changed; the mid-event one is written by hand in the
 * same layout to cover byes, ties, double losses, forced losses, a drop and a
 * combined pod. An untouched file must come back byte for byte, and a result
 * reported on the site must change that match's line and nothing else.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { applyCommand } from '../../shared/tournament/commands.ts';
import { emptyTournament } from '../../shared/tournament/create.ts';
import { seededRandom } from '../../shared/tournament/random.ts';
import { swissStandings } from '../../shared/tournament/standings.ts';
import { wasFinalized } from '../../shared/tournament/rounds.ts';
import { parseTdf, writeTdf } from '../../shared/tournament/tdf.ts';
import type { Pod, Tournament } from '../../shared/tournament/types.ts';
import { readTournament } from '../../shared/tournament/validate.ts';
import { juniorsCutApart } from '../__utils__/divisionCuts.ts';

const fixture = (name: string) => readFileSync(new URL(`../fixtures/tdf/${name}`, import.meta.url), 'utf8');
const CUP = fixture('cup-finalized.tdf');
const CHALLENGE = fixture('challenge-midevent.tdf');

test('reads a finalized cup', () => {
  const t = parseTdf(CUP);
  assert.equal(t.info.name, 'Fixture League Cup');
  assert.equal(t.info.sanctionId, '26-09-000123');
  assert.equal(t.info.roundTime, 30);
  assert.equal(t.info.organizerPopId, '7000001');
  assert.equal(t.players.length, 6);
  assert.equal(t.pods.length, 1);
  const pod = t.pods[0] as Pod;
  assert.equal(pod.category, 'masters');
  assert.equal(pod.rounds.length, 3);
  assert.ok(pod.rounds.every(round => round.kind === 'swiss' && round.status === 'finished'));
  assert.deepEqual(pod.rounds[0]?.matches[0], {
    table: 1,
    p1: '7100004',
    p2: '7100006',
    outcome: 'p1',
    timestamp: '09/28/2026 10:21:44'
  });
  assert.ok(wasFinalized(t));
});

test('computes the same final places TOM wrote', () => {
  const t = parseTdf(CUP);
  const tom = [...CUP.matchAll(/<player id="(\d+)" place="(\d+)" \/>/g)].map(match => match[1]);
  assert.deepEqual(
    swissStandings(t.pods[0] as Pod, t.players).map(row => row.playerId),
    tom
  );
});

test('writes an untouched finalized file back byte for byte', () => {
  const t = parseTdf(CUP);
  assert.equal(writeTdf(t, { finalized: wasFinalized(t) }), CUP);
});

test('reads a mid-event challenge: byes, ties, double and forced losses, a drop, a combined pod', () => {
  const t = parseTdf(CHALLENGE);
  assert.equal(t.info.name, 'Fixture Challenge & Friends');
  const pod = t.pods[0] as Pod;
  assert.equal(pod.category, 'mixed');
  assert.deepEqual(
    pod.rounds[0]?.matches.map(m => [m.outcome, m.p2 === null]),
    [
      ['p1', false],
      ['tie', false],
      ['double-loss', false],
      ['bye', true],
      ['loss', true]
    ]
  );
  assert.equal(pod.rounds[1]?.status, 'started');
  assert.equal(t.players.find(p => p.id === '7200003')?.droppedAfter, 1);
  const standings = swissStandings(pod, t.players);
  const late = standings.find(row => row.playerId === '7200007');
  assert.deepEqual(late?.record, { wins: 1, losses: 1, ties: 0 });
});

test('writes an untouched mid-event file back byte for byte', () => {
  assert.equal(writeTdf(parseTdf(CHALLENGE)), CHALLENGE);
});

test('a result reported on the site changes only its match in the file', () => {
  const t = parseTdf(CHALLENGE);
  const result = applyCommand(
    t,
    { type: 'reportResult', pod: 'mixed', round: 2, table: 1, p1: '7200001', p2: '7200004', outcome: 'p2' },
    { now: 0, localTime: '10/03/2026 13:00:00', season: 2027, random: seededRandom(1) }
  );
  assert.ok(result.ok);
  const before = CHALLENGE.split('\n');
  const after = writeTdf(result.tournament).split('\n');
  assert.equal(after.length, before.length);
  const changed = after.flatMap((line, i) => (line === before[i] ? [] : [line.trim()]));
  assert.deepEqual(changed, ['<match outcome="2">', '<timestamp>10/03/2026 13:00:00</timestamp>']);
});

test('the parsed document survives the wire check', () => {
  for (const source of [CUP, CHALLENGE]) {
    const t = parseTdf(source);
    assert.deepEqual(readTournament(JSON.parse(JSON.stringify(t))), t);
  }
});

test('an event run on the site exports a file that reads back the same', () => {
  let t: Tournament = emptyTournament({ name: 'Site Cup', startDate: '10/10/2026' });
  const ctx = { now: 0, localTime: '10/10/2026 11:00:00', season: 2027, random: seededRandom(4) };
  for (let i = 0; i < 5; i += 1) {
    const added = applyCommand(
      t,
      { type: 'addPlayer', player: { firstName: 'P', lastName: `${i}`, id: `${800 + i}` } },
      ctx
    );
    assert.ok(added.ok);
    t = added.tournament;
  }
  const paired = applyCommand(t, { type: 'pairRound', pod: 'masters' }, ctx);
  assert.ok(paired.ok);
  const written = writeTdf(paired.tournament);
  assert.match(written, /<tournament type="3" stage="4" version="1.86" gametype="TRADING_CARD_GAME" mode="TCG1DAY">/);
  assert.match(written, /<pod category="2" stage="0">/);
  const read = parseTdf(written);
  assert.deepEqual(
    read.pods[0]?.rounds[0]?.matches,
    paired.tournament.pods[0]?.rounds[0]?.matches.map(match => ({ ...match }))
  );
  assert.deepEqual(
    read.players.map(p => p.id),
    paired.tournament.players.map(p => p.id)
  );
  assert.equal(writeTdf(read), written, 'a file this site wrote also round-trips');
});

test('divisions that cut apart are written inside their combined pod', () => {
  const written = writeTdf(juniorsCutApart());
  const read = parseTdf(written);
  assert.equal(read.pods.length, 1);
  assert.equal(read.pods[0]?.category, 'mixed');
  assert.equal(read.pods[0]?.divisionCuts?.junior?.size, 4);
  assert.equal(writeTdf(read), written);
});

test('refuses codes it does not know rather than rewriting them', () => {
  assert.throws(
    () => parseTdf(CHALLENGE.replace('<match outcome="3">', '<match outcome="7">')),
    /Unknown match outcome "7"/
  );
  assert.throws(
    () => parseTdf(CHALLENGE.replace('<pod category="10"', '<pod category="11"')),
    /Unknown pod category "11"/
  );
});

test('refuses files that are not TOM tournaments', () => {
  assert.throws(() => parseTdf('<html></html>'), /Not a TOM tournament/);
  assert.throws(() => parseTdf('<tournament/>'), /Not a TOM tournament/, 'a file with none of TOM’s sections');
  assert.throws(() => parseTdf('<tournament><data/><players/></tournament>'), /Not a TOM tournament/);
  assert.throws(() => parseTdf('<tournament><data></tournament>'), /Unexpected/);
  assert.throws(() => parseTdf('just text'), /No root element/);
});
