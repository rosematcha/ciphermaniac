/**
 * Running an event through the functions, for the API suites: an organizer
 * starts one, adds players and changes its settings, staff send commands,
 * and a player says who they are from the event's page.
 */

import assert from 'node:assert/strict';

import * as me from '../../functions/api/me.ts';
import * as commands from '../../functions/api/tournaments/[code]/commands.ts';
import * as event from '../../functions/api/tournaments/[code]/index.ts';
import * as report from '../../functions/api/tournaments/[code]/report.ts';
import * as settings from '../../functions/api/tournaments/[code]/settings.ts';
import * as tournaments from '../../functions/api/tournaments/index.ts';
import type { TournamentView } from '../../shared/tournament/view.ts';
import type { apiCalls, Call, Handler } from './apiCalls.ts';

/** The birth year of every player addPlayers adds. */
export const PLAYER_BIRTH_YEAR = '1990';

/** The route parameters of an event's routes. */
export const at = (code: string) => ({ code });

/** The event helpers, calling through `hit` (see apiCalls). */
export function eventCalls(hit: ReturnType<typeof apiCalls>['hit']) {
  /** The first store the account signed in under `cookie` belongs to; null for none. */
  async function storeOf(cookie: string): Promise<string | null> {
    const stores = (await hit(me.onRequestGet as Handler, '/api/me', {}, { cookie })).json.user?.stores as
      { id: string }[] | undefined;
    return stores?.[0]?.id ?? null;
  }

  /**
   * Starts an event as the organizer signed in under `cookie`, with `body`
   * laid over a Swiss event's: for its store when it belongs to one and
   * `body` names none, as its own otherwise.
   */
  async function newEvent(cookie: string, body: Record<string, unknown> = {}): Promise<string> {
    const store = 'store' in body ? {} : { store: await storeOf(cookie) };
    const created = await hit(
      tournaments.onRequestPost as Handler,
      '/api/tournaments',
      {},
      { method: 'POST', cookie, body: { mode: 'swiss', name: 'Test Cup', ...store, ...body } }
    );
    assert.equal(created.status, 201, JSON.stringify(created.json));
    return created.json.code as string;
  }

  const newSwiss = (cookie: string) => newEvent(cookie);

  function send(code: string, cookie: string, command: unknown) {
    return hit(commands.onRequestPost as Handler, `/api/tournaments/${code}/commands`, at(code), {
      method: 'POST',
      cookie,
      body: { command, localTime: '10/10/2026 12:00:00' }
    });
  }

  async function addPlayers(code: string, cookie: string, count: number) {
    for (let i = 0; i < count; i += 1) {
      const added = await send(code, cookie, {
        type: 'addPlayer',
        player: { firstName: 'Player', lastName: `${i}`, id: `${900 + i}`, birthDate: `02/27/${PLAYER_BIRTH_YEAR}` }
      });
      assert.equal(added.status, 200);
    }
  }

  function settle(code: string, cookie: string, change: Record<string, unknown>) {
    return hit(settings.onRequestPut as Handler, '/settings', at(code), { method: 'PUT', cookie, body: change });
  }

  /**
   * What a player's page sends to say who they are, or to report, with `call`
   * adding a session. A Player ID goes with the birth year addPlayers gives
   * everyone, unless the body says another.
   */
  function playerSays(code: string, body: Record<string, unknown>, call: Call = {}) {
    const year = body.popId === undefined ? {} : { birthYear: PLAYER_BIRTH_YEAR };
    return hit(report.onRequestPost as Handler, '/report', at(code), {
      ...call,
      method: 'POST',
      body: { ...year, ...body, localTime: '10/10/2026 12:00:00' }
    });
  }

  const view = async (code: string, cookie?: string) =>
    (await hit(event.onRequestGet as Handler, `/api/tournaments/${code}`, at(code), { cookie })).json as TournamentView;

  return { newEvent, newSwiss, send, addPlayers, settle, playerSays, view, storeOf };
}
