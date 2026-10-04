import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { applyCommand, type Command } from '../../shared/tournament/commands.ts';
import { emptyTournament } from '../../shared/tournament/create.ts';
import { seededRandom } from '../../shared/tournament/random.ts';
import { withSiteClocks } from '../../shared/tournament/tomClock.ts';
import { defaultRootAttrs, parseTdf, writeTdf } from '../../shared/tournament/tdf.ts';
import type { Tournament } from '../../shared/tournament/types.ts';
import { readTournament } from '../../shared/tournament/validate.ts';
import { attr, child, children, childText, parseXml } from '../../shared/tournament/xml.ts';

const fixtures = new URL('../fixtures/tdf/harness/', import.meta.url);
const now = Date.UTC(2026, 9, 4, 17);
const ctx = { now, localTime: '10/04/2026 12:00:00', season: 2027, random: seededRandom(73) };

function run(t: Tournament, command: Command): Tournament {
  const result = applyCommand(t, command, ctx);
  assert.ok(result.ok, result.ok ? '' : result.error);
  return result.tournament;
}

function field(count = 9): Tournament {
  let t = emptyTournament({ name: "Finch & Co's Cup", startDate: '10/04/2026' });
  for (let i = 0; i < count; i += 1) {
    t = run(t, {
      type: 'addPlayer',
      player: { id: String(100 + i), firstName: 'Robin', lastName: `Finch${i}`, birthDate: '05/10/1995' }
    });
  }
  return t;
}

function complete(input: Tournament): Tournament {
  let t = input;
  for (const pod of t.pods) {
    for (const m of pod.rounds.at(-1)?.matches ?? []) {
      if (m.p2 !== null) {
        t = run(t, { type: 'reportResult', pod: pod.category, round: pod.rounds.at(-1)!.number, ...m, outcome: 'p1' });
      }
    }
  }
  return t;
}

test('gaps 0, 7, 8, 15: normalized birth years, TOM escaping, deliberate table defaults and LF', () => {
  const t = field();
  t.players[0]!.lastName = "O'Brien";
  const xml = writeTdf(t);
  assert.ok(xml.includes('<name>Finch &amp; Co&apos;s Cup</name>'));
  assert.ok(xml.includes('<lastname>O&apos;Brien</lastname>'));
  assert.ok(xml.includes('<birthdate>02/27/1995</birthdate>'));
  assert.ok(!xml.includes('05/10/1995'));
  // Birth year only, everywhere: the roster itself keeps no full date (shared/accounts/age.ts).
  assert.equal(t.players[0]!.birthDate, '02/27/1995');
  assert.ok(xml.includes('<autotablenumber>false</autotablenumber>\n\t\t<overflowtablestart>0</overflowtablestart>'));
  assert.ok(!xml.includes('\r'));
  assert.ok(xml.endsWith('</tournament>\n'));
});

test('gap 1: prestart players have no starter; late entrants use TOM block', () => {
  let t = field();
  assert.ok(!writeTdf(t).includes('<starter>'));
  t = run(t, { type: 'pairRound', pod: 'masters' });
  t = run(t, {
    type: 'addPlayer',
    player: { id: '999', firstName: 'Alex', lastName: 'Wren', birthDate: '06/03/1990' }
  });
  const players = children(child(parseXml(writeTdf(t)), 'players'), 'player');
  assert.equal(childText(players[0], 'starter'), 'true');
  const late = players.find(p => attr(p, 'userid') === '999')!;
  assert.equal(child(late, 'starter'), undefined);
  assert.deepEqual(
    child(late, 'late')?.children.map(c => [c.name, c.text]),
    [
      ['round', '1'],
      ['timestamp', ctx.localTime],
      ['forcedloss', 'true'],
      ['usedforcedloss', 'true']
    ]
  );
  assert.equal(parseTdf(writeTdf(t)).players.at(-1)?.late, true);
});

test('gaps 2, 3: dropped players finish, DQs go in alphabetized dnf, all divisions written', () => {
  let t = complete(run(field(), { type: 'pairRound', pod: 'masters' }));
  t.players[0]!.firstName = 'Zoe';
  t.players[1]!.firstName = 'alex';
  t = run(t, { type: 'disqualifyPlayer', id: t.players[0]!.id });
  t = run(t, { type: 'disqualifyPlayer', id: t.players[1]!.id });
  t = run(t, { type: 'dropPlayer', id: t.players[2]!.id });
  const xml = writeTdf(t, { finalized: true });
  const pods = children(child(parseXml(xml), 'standings'), 'pod');
  assert.deepEqual(
    pods.map(p => [attr(p, 'category'), attr(p, 'type')]),
    [
      ['2', 'finished'],
      ['2', 'dnf'],
      ['1', 'finished'],
      ['1', 'dnf'],
      ['0', 'finished'],
      ['0', 'dnf']
    ]
  );
  assert.equal(children(pods[0], 'player').length, 7);
  assert.deepEqual(
    children(pods[1], 'player').map(p => p.attrs),
    [[['id', t.players[1]!.id]], [['id', t.players[0]!.id]]]
  );
  assert.equal(parseTdf(xml).players[0]!.disqualified, true);
});

test('gap 4: finals options list all offered sizes and freeze attendance at start', () => {
  let t = field(22);
  const before = parseXml(writeTdf(t));
  const options = children(child(before, 'finalsoptions'), 'categorycut');
  assert.deepEqual(
    options.map(p => attr(p, 'key')),
    ['2']
  );
  assert.deepEqual(
    children(child(options[0], 'options'), 'value').map(v => v.text),
    ['0', '4', '8']
  );
  t = run(t, { type: 'pairRound', pod: 'masters' });
  t = run(t, { type: 'addPlayer', player: { id: '999', firstName: 'Alex', lastName: 'Wren' } });
  const cut = child(child(parseXml(writeTdf(t)), 'finalsoptions'), 'categorycut');
  assert.equal(childText(cut, 'playercount'), '22');
});

test('gaps 5, 6, 9: configured root stage, cut pod stage and last Swiss stage', () => {
  let t = field();
  assert.equal(attr(parseXml(writeTdf(emptyTournament({ name: 'Empty fictional Cup' }))), 'type'), '2');
  assert.equal(attr(parseXml(writeTdf(t)), 'stage'), '3');
  for (let i = 0; i < 4; i += 1) {
    t = complete(run(t, { type: 'pairRound', pod: 'masters' }));
  }
  t = run(t, { type: 'startTopCut', pod: 'masters', size: 4 });
  const root = parseXml(writeTdf(t));
  const pod = child(child(root, 'pods'), 'pod');
  assert.equal(attr(pod, 'stage'), '1');
  const rounds = children(child(pod, 'rounds'), 'round');
  assert.deepEqual(
    rounds.map(r => attr(r, 'stage')),
    ['6', '6', '6', '8', '2']
  );
});

test('gap 11: export clock decays after a round completes', () => {
  let t = run(field(), { type: 'pairRound', pod: 'masters' });
  t = run(t, { type: 'startClock', pod: 'masters' });
  t = complete(t);
  const xml = writeTdf(t, { now: now + 2_000_000 });
  assert.ok(xml.includes('<timeleft>0</timeleft>'));
});

for (const scenario of readdirSync(fixtures)) {
  const dir = new URL(`${scenario}/`, fixtures);
  for (const name of readdirSync(dir)) {
    test(`TOM harness round trip: ${scenario}/${name}`, () => {
      const source = readFileSync(new URL(name, dir), 'utf8');
      const t = parseTdf(source);
      const checked = readTournament(JSON.parse(JSON.stringify(t)));
      assert.ok(checked);
      assert.equal(writeTdf(checked), source);
      const fresh = structuredClone(checked);
      const finalized = attr(parseXml(source), 'stage') === '5';
      delete fresh.passthrough;
      assert.equal(normalizeText(writeTdf(fresh, { finalized })), normalizeText(source));
      assert.equal(writeTdf(withSiteClocks(checked, null)), source);
      const renamed = withSiteClocks(checked, null);
      renamed.info.name = 'Fictional renamed event';
      const edited = parseTdf(writeTdf(renamed));
      assert.deepEqual(
        edited.pods.flatMap(p => p.rounds.map(r => [r.timeLeft, r.startTime])),
        checked.pods.flatMap(p => p.rounds.map(r => [r.timeLeft, r.startTime]))
      );
    });
  }
}

test('fresh serialization matches TOM text, including tabs, empty blocks and trailing spaces', () => {
  const dir = new URL('cup-solo/', fixtures);
  const name = readdirSync(dir).find(name => name.endsWith('-final.tdf'))!;
  const source = readFileSync(new URL(name, dir), 'utf8');
  const t = parseTdf(source);
  delete t.passthrough;
  const written = writeTdf(t, { finalized: true, now: new Date(t.pods[0]!.rounds.at(-1)!.startTime).getTime() });
  assert.equal(normalizeText(written), normalizeText(source));
});

test('fixed seats appear on the player record and both-seat match attributes', () => {
  let t = run(field(8), { type: 'setFixedTable', id: '100', table: 11 });
  t = run(t, { type: 'pairRound', pod: 'masters' });
  const xml = writeTdf(t);
  assert.ok(xml.includes('\t\t\t<staticseat>11</staticseat>\n'));
  assert.match(xml, /<player[12] userid="100" staticseat="11"\/>/);
  assert.equal(parseTdf(xml).players.find(p => p.id === '100')!.fixedTable, 11);
});

test('result reopening timestamps the action, and imported clocks decay only when requested', () => {
  const dir = new URL('challenge/', fixtures);
  const source = readFileSync(new URL('04-r1-complete.tdf', dir), 'utf8');
  const t = parseTdf(source);
  const pod = t.pods[0]!;
  const round = latest(t);
  const match = round.matches.find(m => m.p2 !== null)!;
  const reopened = run(t, {
    type: 'reportResult',
    pod: pod.category,
    round: round.number,
    ...match,
    outcome: 'pending'
  });
  assert.equal(latest(reopened).matches.find(m => m.table === match.table)!.timestamp, ctx.localTime);
  assert.ok(
    writeTdf(t, { finalized: false, now: new Date(round.startTime).getTime() + 2_000_000 }).includes(
      '<timeleft>0</timeleft>'
    )
  );
});

function latest(t: Tournament) {
  return t.pods[0]!.rounds.at(-1)!;
}

test('legacy scalar late=false stays non-late, and imported attendance survives late roster changes', () => {
  const dir = new URL('cup-solo/', fixtures);
  const source = readFileSync(new URL('03-r1-paired.tdf', dir), 'utf8');
  const original = parseTdf(source.replace('<starter>true</starter>', '<starter>true</starter><late>false</late>'));
  assert.equal(original.players[0]!.late, undefined);
  const changed = run(original, {
    type: 'addPlayer',
    player: { id: '999', firstName: 'Sage', lastName: 'Moss', birthDate: '01/01/1990' }
  });
  const options = child(child(parseXml(writeTdf(changed)), 'finalsoptions'), 'categorycut');
  assert.equal(childText(options, 'playercount'), '22');
});

test('imported prestart pods retain their roster even before subgroups are dealt', () => {
  const dir = new URL('cup-solo/', fixtures);
  const t = parseTdf(readFileSync(new URL('02-stage3-configured.tdf', dir), 'utf8'));
  assert.equal(t.pods[0]!.playerIds.length, 22);
  assert.ok(run(t, { type: 'pairRound', pod: 'masters' }).pods[0]!.rounds.length > 0);
});

test('DNF uses TOM character order after case folding, including accented fictional names', () => {
  const t = field(3);
  for (const [i, name] of ['Áster', 'Azure', 'azure'].entries()) {
    t.players[i]!.firstName = name;
    t.players[i]!.lastName = 'Finch';
    t.players[i]!.disqualified = true;
    t.players[i]!.droppedAfter = 1;
  }
  const standings = child(parseXml(writeTdf(t, { finalized: true })), 'standings');
  const dnf = children(standings, 'pod').find(p => attr(p, 'category') === '2' && attr(p, 'type') === 'dnf');
  assert.deepEqual(
    children(dnf, 'player').map(p => attr(p, 'id')),
    ['101', '102', '100']
  );
});

test('TOM truncates elapsed seconds and permits a clock ahead of the save time', () => {
  const t = run(run(field(8), { type: 'pairRound', pod: 'masters' }), { type: 'startClock', pod: 'masters' });
  const seconds = (at: number) =>
    childText(
      child(child(child(parseXml(writeTdf(t, { now: at })), 'pods'), 'pod'), 'rounds')?.children[0],
      'timeleft'
    );
  assert.equal(seconds(now - 1500), '1801');
  assert.equal(seconds(now - 500), '1800');
});

function normalizeText(xml: string): string {
  return xml
    .replace(/<(timeleft|timestamp|pairtime|starttime)>[^<]*<\/(timeleft|timestamp|pairtime|starttime)>/g, '<$1>*</$2>')
    .replace(/<autotablenumber>[^<]*<\/autotablenumber>/, '<autotablenumber>false</autotablenumber>')
    .replace(/<overflowtablestart>[^<]*<\/overflowtablestart>/, '<overflowtablestart>0</overflowtablestart>');
}

for (const [type, game, mode] of [
  ['1', 'TRADING_CARD_GAME', 'CUSTOM'],
  ['2', 'GO', 'GOPREMIER']
]) {
  test(`gap 3: age-independent ${mode} standings use only pod 10`, () => {
    const t = complete(run(field(2), { type: 'pairRound', pod: 'masters' }));
    t.pods[0]!.category = 'mixed';
    t.pods[0]!.rounds[0]!.kind = type === '1' ? 'elimination' : 'swiss';
    t.players[1]!.disqualified = true;
    t.players[1]!.droppedAfter = 1;
    const values: Record<string, string> = { type: type!, gametype: game!, mode: mode! };
    t.passthrough = {
      rootAttrs: defaultRootAttrs('cup').map(([key, value]) => [key, values[key] ?? value]),
      extraData: [],
      timeElapsed: '0',
      playerExtras: {},
      podExtras: {},
      roundCodes: {},
      finalsOptions: ''
    };
    const pods = children(child(parseXml(writeTdf(t, { finalized: true })), 'standings'), 'pod');
    assert.deepEqual(
      pods.map(p => [attr(p, 'category'), attr(p, 'type')]),
      [
        ['10', 'finished'],
        ['10', 'dnf']
      ]
    );
    assert.equal(children(pods[0], 'player').length, 1);
    assert.equal(children(pods[1], 'player').length, 1);
  });
}
