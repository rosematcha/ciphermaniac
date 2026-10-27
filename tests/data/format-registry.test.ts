import assert from 'node:assert/strict';
import test from 'node:test';

import { formatIdFromKey, formatLabel, formatScopeKey, isLimitlessPlayScope } from '../../shared/formats/registry.ts';
import { tournamentPath } from '../../src/lib/data/paths.ts';
import { nameFromTournamentKey } from '../../src/lib/format.ts';

const ONLINE = 'Online - Last 14 Days';

test('format keys round-trip and read as their label', () => {
  assert.equal(formatScopeKey('eternal'), 'format:eternal');
  assert.equal(formatIdFromKey('format:eternal'), 'eternal');
  assert.equal(formatIdFromKey('2026-10-24, Regional Championship Puebla'), null);
  assert.equal(formatLabel('rspk'), 'RS-PK');
  assert.equal(formatLabel('unknown-format'), 'unknown-format');
  assert.equal(nameFromTournamentKey('format:efg'), 'EFG');
});

test('a format reads its reports from its own folder', () => {
  assert.equal(tournamentPath('format:expanded'), '/reports/Formats/expanded');
  assert.equal(tournamentPath(ONLINE), '/reports/Online%20-%20Last%2014%20Days');
});

test('only the online meta and Play-sourced formats link to Play standings', () => {
  assert.equal(isLimitlessPlayScope(ONLINE, ONLINE), true);
  assert.equal(isLimitlessPlayScope('format:eternal', ONLINE), true);
  assert.equal(isLimitlessPlayScope('format:unknown', ONLINE), false);
  assert.equal(isLimitlessPlayScope('2026-10-24, Regional Championship Puebla', ONLINE), false);
});
