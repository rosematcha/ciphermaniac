/**
 * `cardUsage.json` carries, per archetype row, how many lists in each finish
 * tier run the card, so the card page can rank "Played in" without the list
 * index. The counts must equal what the page would count from `lists.json`.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildArchetypeReports } from '../../shared/data/archetypes/build.ts';
import { buildCardUsageIndex, USAGE_TIERS } from '../../shared/data/reports/cardUsage.ts';
import { buildListIndex } from '../../shared/data/reports/listIndex.ts';
import { onlineArchetypeOptions } from '../../shared/data/reports/onlineArtifacts.ts';
import { decodeListIndex } from '../../src/lib/data/lists.ts';
import { normalizeArchetypeName } from '../../shared/cardUtils.ts';
import type { SynonymDatabase } from '../../shared/data/cardIdentity.ts';

const BOSS = "Boss's Orders::MEG::114";
// The reprint collapses onto the MEG print, in the reports and in the list index alike.
const DB = { synonyms: { "Boss's Orders::PAL::172": BOSS }, canonicals: {} } as unknown as SynonymDatabase;

const boss = (set: string, number: string) => ({ name: "Boss's Orders", set, number, count: 2, category: 'trainer' });
const deck = (archetype: string, placement: number, successTags: string[], cards = [boss('MEG', '114')]) => ({
  player: `P${placement}`,
  placement,
  archetype,
  successTags,
  hasDecklist: true,
  tournamentId: 't1',
  tournamentName: 'Weekly',
  tournamentDate: '2026-10-20',
  tournamentPlayers: 64,
  cards
});

const DECKS = [
  deck('Dragapult', 1, ['winner', 'top25', 'top50']),
  deck('Dragapult', 3, ['top25', 'top50'], [boss('PAL', '172')]),
  deck('Dragapult', 20, ['top50']),
  deck('Dragapult', 40, []),
  deck('Dragapult', 50, [], [{ name: 'Dreepy', set: 'TWM', number: '128', count: 4, category: 'pokemon' }]),
  deck('Crustle', 30, ['top50']),
  deck('Crustle', 60, [])
];

test('usage rows count the lists in each finish tier, matching the list index', () => {
  const built = buildArchetypeReports(DECKS, DB, onlineArchetypeOptions({}, null, null));
  const index = buildCardUsageIndex(built.files);
  assert.deepEqual(index.tiers, [...USAGE_TIERS]);
  const rows = Object.fromEntries(index.usage[BOSS].map(row => [row.slug, row]));
  assert.equal(rows.Dragapult.found, 4);
  assert.deepEqual(rows.Dragapult.t, [3, 2, 1]);
  assert.deepEqual(rows.Crustle.t, [1], 'trailing zero tiers are dropped');
  assert.equal(index.usage['Dreepy::TWM::128'][0].t, undefined, 'a row with no tiered lists carries no counts');

  const records = decodeListIndex(buildListIndex(DECKS)!, DB);
  for (const row of index.usage[BOSS]) {
    const mine = records.filter(
      record => normalizeArchetypeName(record.archetype) === normalizeArchetypeName(row.slug) && record.uids.has(BOSS)
    );
    assert.equal(mine.length, row.found, `${row.slug}: all`);
    USAGE_TIERS.forEach((tier, i) => {
      assert.equal(mine.filter(record => record.tags.has(tier)).length, row.t?.[i] ?? 0, `${row.slug}: ${tier}`);
    });
  }
});

test('decks without finish tags claim no tier counts', () => {
  const untagged = DECKS.map(({ successTags: _tags, ...rest }) => rest);
  const index = buildCardUsageIndex(buildArchetypeReports(untagged, DB, onlineArchetypeOptions({}, null, null)).files);
  assert.equal(index.tiers, undefined);
  assert.ok(index.usage[BOSS].every(row => row.t === undefined));
});
