/**
 * Card-asset discovery over the non-Standard formats: card types, synonyms and
 * images must see every format's cards, and must behave exactly as before
 * while no format is published.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { discoverCardTypeCards, imageInputs, synonymInputs } from '../../.github/scripts/lib/cardAssets.ts';

const ONLINE = 'reports/Online - Last 14 Days';
const EVENT = '2026-10-01, Regional Example';
const EVENT_ROOT = '/releases/v1/events/regional/aaaaaaaaaaaa';

const MANIFEST = {
  contractVersion: 2,
  releaseId: 'release-abc',
  publishedAt: '2026-10-27T00:00:00Z',
  roots: {
    online: '/releases/v1/online/aaaaaaaaaaaa',
    trends: '/releases/v1/trends/aaaaaaaaaaaa',
    players: '/releases/v1/players/aaaaaaaaaaaa',
    prices: '/releases/v1/prices/aaaaaaaaaaaa',
    catalogs: '/releases/v1/catalogs/aaaaaaaaaaaa',
    snapshots: '/releases/v1/snapshots/aaaaaaaaaaaa',
    assets: '/releases/v1/assets/aaaaaaaaaaaa'
  },
  events: { [EVENT]: EVENT_ROOT },
  dependencies: {}
};

function bucket(extra: Record<string, unknown> = {}, roots: Record<string, string> = {}) {
  const values: Record<string, unknown> = {
    'current.json': { releaseId: MANIFEST.releaseId },
    [`build/v1/releases/${MANIFEST.releaseId}.json`]: { ...MANIFEST, roots: { ...MANIFEST.roots, ...roots } },
    [`${EVENT_ROOT.slice(1)}/master.json`]: { items: [{ set: 'TWM', number: '095' }] },
    [`${ONLINE}/master.json`]: { items: [{ set: 'SVI', number: '181' }] },
    [`${ONLINE}/decks/index.json`]: ['decks/other.json'],
    [`${ONLINE}/decks/other.json`]: [{ cards: [{ name: 'Iono', set: 'PAL', number: '185' }] }],
    ...extra
  };
  return { read: async <T>(key: string) => (values[key] as T | undefined) ?? null };
}

const FORMATS = {
  'reports/Formats/index.json': {
    generatedAt: '2026-10-27T00:00:00Z',
    formats: [{ id: 'rs-pk', label: 'RS-PK', window: 'Last 60 days', events: 15, decks: 180 }]
  },
  'reports/Formats/rs-pk/master.json': { items: [{ set: 'P4', number: '010' }] },
  'reports/Formats/rs-pk/decks/index.json': ['decks/other.json'],
  'reports/Formats/rs-pk/decks/other.json': [{ cards: [{ name: 'Scramble Energy', set: 'P4', number: '010' }] }]
};

test('card types cover events and the online meta when no format is published', async () => {
  assert.deepEqual(await discoverCardTypeCards(bucket()), ['SVI::181', 'TWM::095']);
});

test('card types add every published format master', async () => {
  assert.deepEqual(await discoverCardTypeCards(bucket(FORMATS)), ['P4::010', 'SVI::181', 'TWM::095']);
});

test('an indexed format without a master fails discovery like a missing online master', async () => {
  const { 'reports/Formats/rs-pk/master.json': _master, ...partial } = FORMATS;
  await assert.rejects(discoverCardTypeCards(bucket(partial)), /Missing card discovery source: reports\/Formats/);
});

test('synonym inputs are unchanged without formats and gain the format cards with them', async () => {
  const today = '2026-10-27';
  const before = await synonymInputs(bucket(), today);
  assert.deepEqual(Object.keys(before), ['sources', 'onlineCards', 'newSets']);
  assert.deepEqual(before.onlineCards, [['Iono', 'PAL', '185'].join('\0')]);

  const after = await synonymInputs(bucket(FORMATS), today);
  assert.deepEqual(after.formatCards, [['Scramble Energy', 'P4', '010'].join('\0')]);
  assert.deepEqual(after.onlineCards, before.onlineCards);
});

test('image inputs carry the formats root only when the release has one', async () => {
  const before = await imageInputs(bucket());
  assert.deepEqual(Object.keys(before), ['synonyms', 'sources', 'online']);
  const after = await imageInputs(bucket({}, { formats: '/releases/v1/formats/bbbbbbbbbbbb' }));
  assert.equal(after.formats, 'releases/v1/formats/bbbbbbbbbbbb');
  assert.equal(after.online, before.online);
});
