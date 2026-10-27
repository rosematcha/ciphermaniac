import test from 'node:test';
import assert from 'node:assert/strict';

import { formatReportScope, runFormatMetas } from '../../.github/scripts/lib/formatMeta';
import type { OnlineMetaOptions, OnlineMetaStore } from '../../.github/scripts/lib/onlineMeta';
import { FORMAT_SCOPES, type FormatScope, type FormatsIndex } from '../../shared/formats/registry';
import { releaseGroups, windowDays } from '../../shared/formats/window';
import { decodeStandings } from '../../shared/api/limitlessDecoders';
import { fetchRecentOnlineTournaments } from '../../shared/onlineMeta/tournamentFetcher';

const NOW = new Date('2026-10-27T12:00:00Z');
const SYNONYMS = { synonyms: { 'Slowking::SCR::58': 'Slowking::SCR::58' }, canonicals: {} };
const ETERNAL = FORMAT_SCOPES.find(format => format.id === 'eternal') as FormatScope;
const RSPK = FORMAT_SCOPES.find(format => format.id === 'rspk') as FormatScope;

function memoryStore(seed: Record<string, unknown> = {}) {
  const objects = new Map<string, unknown>(Object.entries({ 'assets/card-synonyms.json': SYNONYMS, ...seed }));
  const store: OnlineMetaStore = {
    read: async <T>(key: string) => (objects.get(key) as T | undefined) ?? null,
    async write(key, value) {
      objects.set(key, value);
    },
    list: async prefix => [...objects.keys()].filter(key => key.startsWith(prefix)),
    async remove(keys) {
      for (const key of keys) {
        objects.delete(key);
      }
      return keys.length;
    }
  };
  return { store, objects };
}

const player = (placing: number, deck: { id: string; name: string; icons: string[] }) => ({
  placing,
  name: `Player ${placing}`,
  player: `p${placing}`,
  deck,
  decklist: { pokemon: [{ name: 'Slowking', count: 3, set: 'SCR', number: '58' }] }
});

/** A Limitless stand-in serving one event of `size` players, recording every query it gets. */
function limitless({ failFormat, size = 3 }: { failFormat?: string; size?: number } = {}) {
  const queries: Array<Record<string, unknown>> = [];
  const fetchJson: OnlineMetaOptions['fetchJson'] = async (path, options) => {
    if (path === '/tournaments') {
      const query = { ...(options?.searchParams as Record<string, unknown>) };
      queries.push(query);
      if (query.format === failFormat) {
        throw new Error('Limitless is down');
      }
      return query.page === 1
        ? [
            {
              id: `t-${String(query.format)}`,
              name: 'Eternal Tournament #40',
              date: '2026-10-20T17:00:00.000Z',
              players: size
            }
          ]
        : [];
    }
    if (path === '/games/PTCG/decks') {
      return [];
    }
    if (path.endsWith('/details')) {
      return {
        decklists: true,
        isOnline: true,
        format: String(path.split('/')[2]).slice(2),
        organizer: { name: 'JustInBasil', id: 90 }
      };
    }
    if (path.endsWith('/pairings')) {
      return [];
    }
    const slowking = { id: 'slowking-scr', name: 'Slowking', icons: ['slowking'] };
    const other = { id: 'other', name: 'Other', icons: ['substitute'] };
    return Array.from({ length: size }, (_, index) => player(index + 1, index < 2 ? slowking : other));
  };
  return { fetchJson, queries };
}

function runOptions(store: OnlineMetaStore, fetchJson: OnlineMetaOptions['fetchJson'], formats: FormatScope[]) {
  return {
    store,
    fetchJson,
    limitlessApiKey: 'test-key',
    now: NOW,
    reportsPrefix: 'reports',
    formats,
    log: () => undefined,
    warn: () => undefined
  };
}

test('a days window is its length; an all-time window counts back to its start', () => {
  assert.equal(windowDays({ kind: 'days', days: 60 }, NOW), 60);
  assert.equal(windowDays({ kind: 'all', since: '2026-10-01' }, NOW), 26);
});

test('a sets window opens at the release of the oldest of the newest release groups', () => {
  const groups = releaseGroups('2026-10-27');
  // 30th Celebration, Pitch Black, Chaos Rising, Perfect Order: legality minus two weeks.
  assert.deepEqual(groups.slice(0, 4), [
    '2026-09-11T00:00:00.000Z',
    '2026-07-17T00:00:00.000Z',
    '2026-05-22T00:00:00.000Z',
    '2026-03-27T00:00:00.000Z'
  ]);
  assert.equal(windowDays({ kind: 'sets', count: 4 }, NOW), 214);
});

test('promo and energy sets and same-day sets never open a release group of their own', () => {
  const groups = releaseGroups('2025-11-01');
  // Mega Evolution, its energy and promos share one date; Black Bolt and White Flare share another.
  assert.equal(groups.filter(date => date === '2025-09-26T00:00:00.000Z').length, 1);
  assert.equal(groups.filter(date => date === '2025-07-18T00:00:00.000Z').length, 1);
});

test('a format scope asks Limitless for its format and organizer and filters by name', () => {
  const scope = formatReportScope(ETERNAL, NOW);
  assert.equal(scope.folder, 'Formats/eternal');
  assert.deepEqual(scope.fetch, {
    formats: ['CUSTOM'],
    query: { format: 'CUSTOM', organizerId: 90 },
    nameIncludes: 'Eternal'
  });
  assert.equal(scope.minFieldPlayers, 0);
  assert.equal(scope.windowDays, 365);
});

test('the fetcher sends extra query parameters and drops events outside the name and format', async () => {
  const seen: Array<Record<string, unknown>> = [];
  const fetchJson: OnlineMetaOptions['fetchJson'] = async (path, options) => {
    if (path === '/tournaments') {
      seen.push({ ...(options?.searchParams as Record<string, unknown>) });
      return [
        { id: 'a', name: 'Eternal Tournament #1', date: '2026-10-20T17:00:00.000Z', players: 4 },
        { id: 'b', name: 'Gym Leader Challenge', date: '2026-10-19T17:00:00.000Z', players: 4 },
        { id: 'c', name: 'eternal labs', date: '2026-10-18T17:00:00.000Z', players: 4 },
        { id: 'd', name: 'Old Eternal', date: '2025-01-01T17:00:00.000Z', players: 4 }
      ];
    }
    return { decklists: true, isOnline: true, format: path.includes('/c/') ? 'STANDARD' : 'CUSTOM' };
  };
  const found = await fetchRecentOnlineTournaments(undefined, new Date('2026-10-01T00:00:00Z'), {
    fetchJson,
    formats: ['CUSTOM'],
    query: { format: 'CUSTOM', organizerId: 90 },
    nameIncludes: 'eternal'
  });
  assert.deepEqual(
    found.map(entry => entry.id),
    ['a']
  );
  assert.deepEqual(seen[0], { format: 'CUSTOM', organizerId: 90, game: 'PTCG', limit: 100, page: 1 });
});

test('standings keep the sprites Limitless assigns an archetype', () => {
  const { rows } = decodeStandings([player(1, { id: 'bombtar', name: 'Bombtar', icons: ['typhlosion', 'tyranitar'] })]);
  assert.deepEqual(rows[0].deck, { id: 'bombtar', name: 'Bombtar', icons: ['typhlosion', 'tyranitar'] });
});

test('every format publishes its own folder and the index lists it', async () => {
  const bucket = memoryStore();
  const { fetchJson } = limitless({ size: 4 });
  const index = await runFormatMetas(runOptions(bucket.store, fetchJson, [ETERNAL, RSPK]));

  assert.deepEqual(
    index.formats.map(entry => [entry.id, entry.label, entry.window, entry.events]),
    [
      ['eternal', 'Eternal', 'last 12 months', 1],
      ['rspk', 'RS-PK', 'last 60 days', 1]
    ]
  );
  assert.deepEqual(bucket.objects.get('reports/Formats/index.json'), index);
  assert.ok(bucket.objects.has('reports/Formats/eternal/master.json'));
  assert.ok(bucket.objects.has('reports/Formats/rspk/meta.json'));
  assert.ok(!bucket.objects.has('reports/Online - Last 14 Days/meta.json'));
});

test('Eternal counts a three-player event and its archetypes carry Limitless sprites', async () => {
  const bucket = memoryStore();
  const { fetchJson } = limitless();
  await runFormatMetas(runOptions(bucket.store, fetchJson, [ETERNAL]));

  const meta = bucket.objects.get('reports/Formats/eternal/meta.json') as Record<string, unknown>;
  assert.equal(meta.deckTotal, 3);
  assert.equal(meta.name, 'Eternal');
  const archetypes = bucket.objects.get('reports/Formats/eternal/archetypes/index.json') as Array<{
    label: string;
    icons?: string[];
  }>;
  assert.deepEqual(archetypes.find(entry => entry.label === 'Slowking')?.icons, ['slowking']);
});

test('a failed format keeps its previous index entry and is named as failed', async () => {
  const previous: FormatsIndex = {
    generatedAt: '2026-10-26T12:00:00.000Z',
    formats: [
      {
        id: 'rspk',
        label: 'RS-PK',
        window: 'last 60 days',
        events: 9,
        decks: 90,
        windowStart: '2026-08-27T00:00:00.000Z',
        windowEnd: '2026-10-26T00:00:00.000Z'
      }
    ]
  };
  const bucket = memoryStore({ 'reports/Formats/index.json': previous });
  const { fetchJson } = limitless({ failFormat: 'EX' });
  const index = await runFormatMetas(runOptions(bucket.store, fetchJson, [ETERNAL, RSPK]));

  assert.deepEqual(
    index.formats.map(entry => entry.id),
    ['eternal', 'rspk']
  );
  assert.equal(index.formats[1], previous.formats[0]);
  assert.equal(index.failed?.[0].id, 'rspk');
  assert.match(index.failed?.[0].message ?? '', /Limitless is down/);
});
