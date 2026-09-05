/**
 * A rename has to reach every profile that names the renamed player.
 *
 * `buildRounds` fills each round's `opponentName` with the opponent's name as
 * published today, and promises in its own docstring that "no prior name
 * survives in a published body". Two things used to break that promise, and
 * both are the aggregator deciding it has nothing to do:
 *
 *   - the incremental pass rewrites a player only when their own tournament set
 *     or their own events' content changed, so someone who played nothing new
 *     kept last season's spelling of an opponent they faced once;
 *   - an identity override is a code edit, which moves no tournament
 *     fingerprint, so the no-change fast path skipped the run entirely.
 *
 * That is a privacy promise, not a cosmetic one — the override list exists so a
 * player's former name stops being published.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPlayerAggregates } from '../../shared/onlineMeta/playerAggregator.js';
import { IDENTITY_OVERRIDES_REVISION } from '../../shared/onlineMeta/playerIdentity.js';

function makeEnv(store: Record<string, string>) {
  const bucket = store;
  return {
    REPORTS: {
      async get(key: string) {
        if (!(key in bucket)) {
          return null;
        }
        const value = bucket[key];
        return { text: async () => value };
      },
      async put(key: string, data: string | ArrayBuffer | ArrayBufferView) {
        bucket[key] = typeof data === 'string' ? data : Buffer.from(data as ArrayBuffer).toString('utf-8');
      },
      async delete(key: string) {
        delete bucket[key];
      }
    }
  };
}

const SHARED = '2026-01-10, Regional Shared';
const LATER = '2026-02-10, Regional Later';

function participant(playerId: number, name: string, tpId: number) {
  return {
    tpId,
    playerId,
    name,
    country: 'US',
    placement: playerId,
    wins: 4,
    losses: 2,
    ties: 0,
    madePhase2: false,
    madeTopCut: false
  };
}

/** The one round they played against each other, from each side. */
function pairing() {
  return [
    { id: 'm1', playerId: 1, opponentId: 2, round: 1, phase: 1, outcome: 'win' },
    { id: 'm2', playerId: 2, opponentId: 1, round: 1, phase: 1, outcome: 'loss' }
  ];
}

/**
 * Player 1 and player 2 meet at SHARED. Only player 2 goes on to LATER, where
 * they register under a new name — so player 1's own events never change.
 */
function makeStore(): Record<string, string> {
  return {
    'reports/tournaments.json': JSON.stringify([SHARED]),
    [`reports/${SHARED}/players.json`]: JSON.stringify([
      participant(1, 'Ash Ketchum', 1),
      participant(2, 'Tim Franklin', 2)
    ]),
    [`reports/${SHARED}/decks.json`]: JSON.stringify([]),
    [`reports/${SHARED}/playerMatches.json`]: JSON.stringify(pairing()),
    [`reports/${SHARED}/meta.json`]: JSON.stringify({ fetchedAt: '2026-01-11T00:00:00.000Z' })
  };
}

function addLaterEvent(store: Record<string, string>, name: string) {
  const bucket = store; // local alias so the writes below don't reassign the param
  bucket['reports/tournaments.json'] = JSON.stringify([SHARED, LATER]);
  bucket[`reports/${LATER}/players.json`] = JSON.stringify([participant(2, name, 2)]);
  bucket[`reports/${LATER}/decks.json`] = JSON.stringify([]);
  bucket[`reports/${LATER}/meta.json`] = JSON.stringify({ fetchedAt: '2026-02-11T00:00:00.000Z' });
}

function opponentNames(store: Record<string, string>, playerId: string): string[] {
  const profile = JSON.parse(store[`players/${playerId}/profile.json`]);
  return Object.values(profile.rounds as Record<string, { opponentName: string | null }[]>)
    .flat()
    .map(round => round.opponentName)
    .filter((name): name is string => name != null);
}

test('a rename reaches the opponent lists of players whose own events did not change', async () => {
  const store = makeStore();
  const env = makeEnv(store);

  await buildPlayerAggregates(env);
  assert.deepEqual(opponentNames(store, '1'), ['Tim Franklin'], 'the first build publishes the name as registered');

  // Player 2 re-registers under a new name at a later event that player 1 did
  // not attend. Player 1's tournament set and every fingerprint they depend on
  // are identical to the last run.
  addLaterEvent(store, 'Timothy Franklin');

  const rebuild = await buildPlayerAggregates(env);
  assert.equal(rebuild.skippedNoChanges, false);
  assert.deepEqual(
    opponentNames(store, '1'),
    ['Timothy Franklin'],
    "player 1 played nothing new, so their profile kept the opponent's prior name"
  );
});

test('a run that renames nobody still skips the profiles it always skipped', async () => {
  const store = makeStore();
  const env = makeEnv(store);
  await buildPlayerAggregates(env);

  // A new event for player 2 under the same name: player 1 gains nothing, and
  // rewriting them would be a write we do not owe.
  addLaterEvent(store, 'Tim Franklin');

  const rebuild = await buildPlayerAggregates(env);
  assert.equal(rebuild.skippedNoChanges, false, 'a new tournament is still a rebuild');
  assert.equal(rebuild.profilesWritten, 1, 'only the player whose events changed is rewritten');
});

test('the manifest records the names it published and the override table it published them under', async () => {
  const store = makeStore();
  await buildPlayerAggregates(makeEnv(store));

  const manifest = JSON.parse(store['players/_manifest.json']);
  assert.deepEqual(manifest.names, { '1': 'Ash Ketchum', '2': 'Tim Franklin' });
  assert.equal(manifest.identityRevision, IDENTITY_OVERRIDES_REVISION);
});

test('an identity-override edit defeats the no-change fast path', async () => {
  const store = makeStore();
  const env = makeEnv(store);
  await buildPlayerAggregates(env);

  // Nothing changed, so this run short-circuits.
  assert.equal((await buildPlayerAggregates(env)).skippedNoChanges, true);

  // Stand in for an edit to PLAYER_IDENTITY_OVERRIDES: the table this manifest
  // was built under is no longer the table in the build. No tournament
  // fingerprint moves, so this is the only signal there is.
  const manifest = JSON.parse(store['players/_manifest.json']);
  manifest.identityRevision = `${IDENTITY_OVERRIDES_REVISION}|99:::Someone Else`;
  store['players/_manifest.json'] = JSON.stringify(manifest);

  const rebuild = await buildPlayerAggregates(env);
  assert.equal(rebuild.skippedNoChanges, false, 'an override edit must not be skipped as "no changes"');
});

test('a manifest from before names were recorded rewrites every profile once', async () => {
  const store = makeStore();
  const env = makeEnv(store);
  await buildPlayerAggregates(env);

  // A manifest written by the previous version of this code: fingerprints and
  // keys are all current, but there is no name map to diff against, so nobody
  // can be shown to be unrenamed.
  const manifest = JSON.parse(store['players/_manifest.json']);
  delete manifest.names;
  delete manifest.identityRevision;
  store['players/_manifest.json'] = JSON.stringify(manifest);

  const rebuild = await buildPlayerAggregates(env);
  assert.equal(rebuild.skippedNoChanges, false, 'a missing identity revision must not short-circuit');
  assert.equal(rebuild.profilesWritten, 2, 'with nothing to diff, every profile is rewritten to seed the map');

  const seeded = JSON.parse(store['players/_manifest.json']);
  assert.deepEqual(seeded.names, { '1': 'Ash Ketchum', '2': 'Tim Franklin' });
});
