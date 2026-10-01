/**
 * Where History's rows read their events: each event's public copy on R2,
 * the browser's cache allowed only for a finished event, and the API when
 * the edge has no copy. A copy with no player under the entry's key is no
 * entry at all.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';

import type { HistoryEntry } from '../../shared/accounts/types.ts';
import { parseTdf } from '../../shared/tournament/tdf.ts';
import {
  assignKeys,
  DEFAULT_SETTINGS,
  publicDecks,
  publicDivisions,
  publicTournament,
  type PublishedView
} from '../../shared/tournament/view.ts';
import { loadEntry } from '../../src/lib/tournament/historyCopies.ts';

const tdf = parseTdf(readFileSync(new URL('../fixtures/tdf/challenge-midevent.tdf', import.meta.url), 'utf8'));
const keys = assignKeys(tdf, {});
const VIEW: PublishedView = {
  code: 'ABCDEF',
  mode: 'tom',
  version: 4,
  updatedAt: 0,
  tournament: publicTournament(tdf, keys),
  pending: [],
  reports: [],
  divisions: publicDivisions(tdf, keys, Date.UTC(2026, 9, 3)),
  decks: publicDecks({ '7200001': 'Gardevoir ex' }, keys),
  settings: { ...DEFAULT_SETTINGS, deckVisibility: 'always' }
};
const MARY = keys['7200001'] ?? '';

const entry = (status: HistoryEntry['status'], key = MARY): HistoryEntry => ({
  code: 'ABCDEF',
  key,
  name: 'Fixture Challenge & Friends',
  startDate: '10/03/2026',
  startsAt: '',
  format: 'Standard',
  mode: 'tom',
  status
});

const realFetch = globalThis.fetch;
let asked: { url: string; cache: RequestCache | undefined }[] = [];

/** The edge answers with `edge` (404 when null), and the API with `api`. */
function serve(edge: PublishedView | null, api: unknown = { ...VIEW, viewer: {} }) {
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    asked.push({ url, cache: init.cache });
    if (url.endsWith('/tournaments/v1/ABCDEF.json')) {
      return edge ? Response.json(edge) : new Response('missing', { status: 404 });
    }
    return Response.json(api);
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  asked = [];
});

test('a finished event’s copy may come from the browser’s cache; a live one is asked of the edge', async () => {
  serve(VIEW);
  const finished = await loadEntry(entry('finished'));
  assert.equal(finished?.finish.place, 1);
  assert.equal(finished?.finish.deck, 'Gardevoir ex');
  assert.equal(finished?.names.get(keys['7200002'] ?? ''), 'Dorothy Vaughan');
  await loadEntry(entry('live'));
  await loadEntry(entry('upcoming'));
  assert.deepEqual(
    asked.map(a => a.cache),
    ['default', 'no-cache', 'no-cache']
  );
});

test('with no copy on the edge, the event comes from the API', async () => {
  serve(null);
  const result = await loadEntry(entry('live'));
  assert.equal(result?.finish.place, 1);
  assert.deepEqual(
    asked.map(a => a.url.replace(/^https?:\/\/[^/]+/, '')),
    ['/tournaments/v1/ABCDEF.json', '/api/tournaments/ABCDEF']
  );
});

test('a copy with no player under the key is no entry', async () => {
  serve(VIEW);
  assert.equal(await loadEntry(entry('finished', '999')), null);
});
