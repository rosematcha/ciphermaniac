import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as cheerio from 'cheerio';

import { cityLeagueWindow, gatherCityLeagues } from '../../.github/scripts/lib/cityLeagues/index';
import {
  archetypeFromIcons,
  buildDeck,
  hashDeck,
  pokemonNameOf,
  toCardEntries
} from '../../.github/scripts/lib/cityLeagues/decks';
import {
  canonicalJpNumber,
  emptyPrintMap,
  pickEnglishPrint,
  refreshPrintMap,
  resolveJpCard
} from '../../.github/scripts/lib/cityLeagues/prints';
import { createPoliteFetcher, NotFoundError } from '../../.github/scripts/lib/cityLeagues/fetch';
import { parseDecklistPage, parseEventPage } from '../../.github/scripts/lib/cityLeagues/parse';
import type { CityLeagueEvent, CityLeagueStore, JpPrintMap } from '../../.github/scripts/lib/cityLeagues/types';

// Real Limitless pages saved 2026-10-27.
const fixture = (name: string) => readFileSync(new URL(`../fixtures/city-leagues/${name}`, import.meta.url), 'utf8');

const LIMITLESS = 'https://limitlesstcg.com';

function memoryStore(): CityLeagueStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    read: async <T>(key: string) => (data.has(key) ? (structuredClone(data.get(key)) as T) : null),
    write: async (key, value) => {
      data.set(key, structuredClone(value));
    },
    list: async prefix => [...data.keys()].filter(key => key.startsWith(prefix))
  };
}

/** The listing fixture cut down to its first `rows` events. */
function listingWith(rows: number): string {
  const $ = cheerio.load(fixture('listing.html'));
  $('tr[data-date]').slice(rows).remove();
  $('ul.pagination').attr('data-max', '1');
  return $.html();
}

/** Serves the fixtures: every list id gets the 76771 list, only M6/62 has a card page. */
function fixtureSite(listing: string) {
  const requests: string[] = [];
  const pages: Record<string, string> = {
    [`${LIMITLESS}/tournaments/jp?show=100&page=1`]: listing,
    [`${LIMITLESS}/tournaments/jp/5150`]: fixture('event-5150.html'),
    [`${LIMITLESS}/cards/jp/M6/62?translate=en`]: fixture('card-jp-M6-62.html')
  };
  const fetchText = async (url: string) => {
    requests.push(url);
    if (pages[url]) {
      return pages[url];
    }
    if (url.startsWith(`${LIMITLESS}/decks/list/jp/`)) {
      return fixture('decklist-76771.html');
    }
    throw new NotFoundError(url);
  };
  return { requests, fetchText };
}

const event5150 = (): CityLeagueEvent => ({
  id: '5150',
  date: '2026-10-27',
  prefecture: 'Kanagawa',
  shop: '【CARDBOX】青馬堂矢向店',
  ...parseEventPage(fixture('event-5150.html'))
});

// --- window -----------------------------------------------------------------

test('window ends settleDays before today and reaches windowDays back', () => {
  assert.deepEqual(cityLeagueWindow(new Date('2026-10-27T15:00:00Z'), 14, 7), {
    start: '2026-10-06',
    end: '2026-10-20'
  });
  assert.deepEqual(cityLeagueWindow(new Date('2026-10-27T00:00:00Z'), 1, 0), {
    start: '2026-10-26',
    end: '2026-10-27'
  });
});

// --- archetypes and ids -----------------------------------------------------

test('archetype names read off the Pokémon icons', () => {
  assert.equal(pokemonNameOf('kangaskhan-mega'), 'Mega Kangaskhan');
  assert.equal(pokemonNameOf('zoroark-hisui'), 'Hisuian Zoroark');
  assert.equal(pokemonNameOf('ogerpon-wellspring'), 'Ogerpon Wellspring');
  assert.deepEqual(archetypeFromIcons(['kangaskhan-mega', 'talonflame']), {
    name: 'Mega Kangaskhan Talonflame',
    id: 'kangaskhan-mega talonflame'
  });
  assert.deepEqual(archetypeFromIcons([]), { name: 'Unknown', id: null });
});

test('deck ids hash the cards exactly as the online producer does', async () => {
  const cards = [
    { count: 3, name: 'Talonflame ex', set: 'JP-M6', number: '62', category: 'pokemon' as const },
    { count: 4, name: 'Ultra Ball', set: 'MEG', number: '131', category: 'trainer' as const }
  ];
  const canonical = ['3xTalonflame ex::JP-M6::62', '4xUltra Ball::MEG::131'].sort().join('|');
  assert.equal(await hashDeck(cards), createHash('sha1').update(canonical).digest('hex'));
  assert.equal(await hashDeck([], 'fallback'), createHash('sha1').update('fallback').digest('hex'));
});

// --- print map and the flip -------------------------------------------------

test('canonical Japanese print: the lowest number in the same set', () => {
  assert.equal(
    canonicalJpNumber({ set: 'M6', number: '96' }, [
      { set: 'M6', number: '62' },
      { set: 'M6', number: '96' }
    ]),
    '62'
  );
  // A promo print elsewhere does not pull the card out of its set.
  assert.equal(
    canonicalJpNumber({ set: 'M6a', number: '15' }, [
      { set: 'MP', number: '151' },
      { set: 'M6a', number: '15' }
    ]),
    '15'
  );
});

test('English print pick: a set print before a promo, lowest number first', () => {
  assert.deepEqual(
    pickEnglishPrint([
      { set: 'MEP', number: '99' },
      { set: '30C', number: '148' },
      { set: '30C', number: '21' }
    ]),
    { set: '30C', number: '21' }
  );
  assert.deepEqual(pickEnglishPrint([{ set: 'MEP', number: '99' }]), { set: 'MEP', number: '99' });
  assert.equal(pickEnglishPrint([]), null);
});

const unreleased: JpPrintMap = {
  schemaVersion: 1,
  updatedAt: '2026-10-27',
  prints: {
    'M6/62': { canonicalNumber: '62', name: 'Talonflame ex', en: null, checkedAt: '2026-10-27' },
    'M6/96': { canonicalNumber: '62', name: 'Talonflame ex', en: null, checkedAt: '2026-10-27' }
  }
};

function released(): JpPrintMap {
  const map = structuredClone(unreleased);
  map.prints['M6/62'].en = { set: 'DLR', number: '120', name: 'Talonflame ex' };
  return map;
}

test('an unreleased card keeps its Japanese print under a JP- set code', () => {
  assert.deepEqual(resolveJpCard({ set: 'M6', number: '62', name: 'Talonflame ex' }, unreleased), {
    set: 'JP-M6',
    number: '62',
    name: 'Talonflame ex'
  });
  // The secret rare counts as the regular print.
  assert.deepEqual(resolveJpCard({ set: 'M6', number: '96', name: 'Talonflame ex' }, unreleased), {
    set: 'JP-M6',
    number: '62',
    name: 'Talonflame ex'
  });
  // The print map's name wins over a list cached under an older translation.
  assert.equal(resolveJpCard({ set: 'M6', number: '62', name: 'Talonflame-ex' }, unreleased).name, 'Talonflame ex');
  // Lowercase Japanese codes are uppercased like every set code.
  assert.equal(resolveJpCard({ set: 'M6a', number: '15', name: 'Greninja ex' }, emptyPrintMap()).set, 'JP-M6A');
});

test('the flip: once an English print exists, both Japanese prints become it', () => {
  const map = released();
  for (const number of ['62', '96']) {
    assert.deepEqual(resolveJpCard({ set: 'M6', number, name: 'Talonflame ex' }, map), {
      set: 'DLR',
      number: '120',
      name: 'Talonflame ex'
    });
  }
});

test('the flip applies to cached lists at build time, merging prints that become one card', () => {
  const list = parseDecklistPage(fixture('decklist-76771.html'), '76771');
  list.cards.push({ count: 1, name: 'Talonflame ex', set: 'M6', number: '96', category: 'pokemon', jp: true });

  const before = toCardEntries(list, unreleased);
  const talonflame = before.filter(card => card.name === 'Talonflame ex');
  assert.deepEqual(
    talonflame.map(card => [card.set, card.number, card.count]),
    [['JP-M6', '62', 4]]
  );
  // Lava Cave 75 and 76 are not prints of one card on Limitless, so they stay apart.
  assert.deepEqual(
    before.filter(card => card.name === 'Legendary Lava Cave').map(card => `${card.set}/${card.number}`),
    ['JP-M6/75', 'JP-M6/76']
  );

  const after = toCardEntries(list, released());
  assert.deepEqual(
    after.filter(card => card.name === 'Talonflame ex').map(card => [card.set, card.number, card.count]),
    [['DLR', '120', 4]]
  );
  assert.equal(
    after.reduce((total, card) => total + card.count, 0),
    61
  );
  // English cards are untouched either way.
  assert.deepEqual(after[0], before[0]);
});

test('refresh: an unreleased print is recorded and rechecked only when due', async () => {
  const map = emptyPrintMap();
  const site = fixtureSite('');
  const options = { map, prints: [{ set: 'M6', number: '62' }], fetchText: site.fetchText, recheckDays: 7 };

  assert.deepEqual(await refreshPrintMap({ ...options, today: '2026-10-27' }), { checked: 1, flipped: 0 });
  assert.deepEqual(map.prints['M6/62'], {
    canonicalNumber: '62',
    name: 'Talonflame ex',
    en: null,
    checkedAt: '2026-10-27'
  });

  await refreshPrintMap({ ...options, today: '2026-11-02' });
  assert.equal(site.requests.length, 1, 'not due yet');
  await refreshPrintMap({ ...options, today: '2026-11-03' });
  assert.equal(site.requests.length, 2, 'due after a week');
});

test('refresh: a released print records its English print and official name', async () => {
  const map = emptyPrintMap();
  const requests: string[] = [];
  const pages: Record<string, string> = {
    // Saved without `translate=en`, so its name is the Japanese one.
    [`${LIMITLESS}/cards/jp/M6a/15?translate=en`]: fixture('card-jp-M6a-15.html'),
    [`${LIMITLESS}/cards/en/30C/21`]: fixture('card-en-30C-21.html')
  };
  const fetchText = async (url: string) => {
    requests.push(url);
    return pages[url] ?? Promise.reject(new NotFoundError(url));
  };
  const result = await refreshPrintMap({
    map,
    prints: [{ set: 'M6a', number: '15' }],
    fetchText,
    today: '2026-10-27',
    recheckDays: 7
  });
  assert.deepEqual(result, { checked: 1, flipped: 1 });
  assert.deepEqual(map.prints['M6a/15'], {
    canonicalNumber: '15',
    name: 'ゲッコウガex',
    en: { set: '30C', number: '21', name: 'Greninja ex' },
    checkedAt: '2026-10-27'
  });
  assert.deepEqual(resolveJpCard({ set: 'M6a', number: '15', name: 'Greninja ex' }, map), {
    set: '30C',
    number: '21',
    name: 'Greninja ex'
  });
  // A released print is never read again.
  await refreshPrintMap({
    map,
    prints: [{ set: 'M6a', number: '15' }],
    fetchText,
    today: '2027-01-01',
    recheckDays: 7
  });
  assert.equal(requests.length, 2);
});

// --- decks ------------------------------------------------------------------

test('a placing becomes a deck shaped like the online producer’s', async () => {
  const event = event5150();
  const list = parseDecklistPage(fixture('decklist-76771.html'), '76771');
  const deck = await buildDeck({ event, placing: event.placings[0], list, printMap: unreleased });
  assert.equal(deck.id, await hashDeck(deck.cards));
  assert.deepEqual(
    { ...deck, id: undefined, cards: undefined },
    {
      id: undefined,
      cards: undefined,
      player: 'みぞれ',
      playerId: 'jp:0052099566',
      country: 'JP',
      placement: 1,
      archetype: 'Mega Kangaskhan Talonflame',
      archetypeId: 'kangaskhan-mega talonflame',
      archetypeSource: 'limitless-icons',
      hasDecklist: true,
      tournamentId: 'jp-5150',
      tournamentName: 'City League Kanagawa 10/27',
      tournamentDate: '2026-10-27T00:00:00.000Z',
      tournamentPlayers: 16,
      tournamentFormat: 'STANDARD-JP',
      tournamentPlatform: null,
      tournamentOrganizer: '【CARDBOX】青馬堂矢向店',
      deckSource: 'limitless-jp',
      successTags: ['winner', 'top2', 'top4', 'top8', 'top25', 'top50']
    }
  );
  const lantern = deck.cards.find(card => card.name === 'Adventuring Lantern');
  assert.deepEqual(lantern, {
    count: 1,
    name: 'Adventuring Lantern',
    set: 'JP-M6',
    number: '64',
    category: 'trainer',
    trainerType: lantern?.trainerType
  });
});

test('success tags against a top-16 field: exact placement tags, percentage tags as a lower bound', async () => {
  const event = event5150();
  const tags = async (index: number) =>
    (await buildDeck({ event, placing: event.placings[index], list: null, printMap: unreleased })).successTags;
  assert.deepEqual(await tags(4), ['top8', 'top50']);
  assert.deepEqual(await tags(8), []);
  assert.deepEqual(await tags(15), []);
});

// --- gatherCityLeagues ------------------------------------------------------

const NOW = new Date('2026-11-04T03:00:00Z');

test('gather: reads the window, caches events, lists and prints, and builds decks', async () => {
  const store = memoryStore();
  const site = fixtureSite(listingWith(1));
  const result = await gatherCityLeagues({ store, fetchText: site.fetchText, now: NOW, windowDays: 14, settleDays: 7 });

  assert.deepEqual(result.tournaments, [
    {
      id: 'jp-5150',
      name: 'City League Kanagawa 10/27',
      date: '2026-10-27T00:00:00.000Z',
      format: 'STANDARD-JP',
      platform: null,
      game: 'PTCG',
      players: 16,
      organizer: '【CARDBOX】青馬堂矢向店',
      organizerId: null
    }
  ]);
  assert.equal(result.decks.length, 16);
  assert.deepEqual(
    result.decks.map(deck => deck.placement),
    Array.from({ length: 16 }, (_, index) => index + 1)
  );
  assert.ok(result.decks.every(deck => deck.cards.some(card => card.set === 'JP-M6' && card.number === '62')));

  const keys = [...store.data.keys()].sort();
  assert.ok(keys.includes('sources/city-leagues/events/5150.json'));
  assert.ok(keys.includes('sources/city-leagues/lists/76771.json'));
  assert.ok(keys.includes('sources/city-leagues/print-map.json'));
  // Fifteen distinct lists: two finishers share 74842.
  assert.equal(keys.filter(key => key.startsWith('sources/city-leagues/lists/')).length, 15);
  // Listing, event, 15 lists, and the five Japanese prints' card pages (four of them 404 here).
  assert.equal(site.requests.length, 1 + 1 + 15 + 5);
});

test('gather: a second run fetches only the listing', async () => {
  const store = memoryStore();
  const first = fixtureSite(listingWith(1));
  await gatherCityLeagues({ store, fetchText: first.fetchText, now: NOW });

  // The four prints whose pages failed are retried; the one that was read is not due.
  const second = fixtureSite(listingWith(1));
  const result = await gatherCityLeagues({ store, fetchText: second.fetchText, now: NOW });
  assert.equal(result.decks.length, 16);
  assert.deepEqual(
    second.requests.filter(url => !url.includes('/cards/jp/')),
    [`${LIMITLESS}/tournaments/jp?show=100&page=1`]
  );
  assert.ok(!second.requests.includes(`${LIMITLESS}/cards/jp/M6/62?translate=en`));
});

test('gather: leaves out events outside the window', async () => {
  const store = memoryStore();
  const site = fixtureSite(listingWith(1));
  const result = await gatherCityLeagues({ store, fetchText: site.fetchText, now: new Date('2026-10-30T00:00:00Z') });
  assert.deepEqual(result, { tournaments: [], decks: [], pending: 0 });
  assert.deepEqual(site.requests, [`${LIMITLESS}/tournaments/jp?show=100&page=1`]);
});

test('gather: refuses to publish when too many events fail', async () => {
  const store = memoryStore();
  const site = fixtureSite(listingWith(4));
  // Only 5150's page exists; the other three of 10-27 and 10-26 fail.
  await assert.rejects(
    gatherCityLeagues({ store, fetchText: site.fetchText, now: NOW, windowDays: 14, settleDays: 7 }),
    /failed for 3\/4 events/
  );
});

test('gather: a spent fetch budget leaves the rest pending, not failed, for the next run to finish', async () => {
  const store = memoryStore();
  // The event page plus five of its fifteen lists.
  const first = await gatherCityLeagues({
    store,
    fetchText: fixtureSite(listingWith(1)).fetchText,
    now: NOW,
    fetchBudget: 6
  });
  assert.deepEqual(first.tournaments, []);
  assert.equal(first.pending, 1);
  assert.equal([...store.data.keys()].filter(key => key.startsWith('sources/city-leagues/lists/')).length, 5);

  const site = fixtureSite(listingWith(1));
  const second = await gatherCityLeagues({ store, fetchText: site.fetchText, now: NOW, fetchBudget: 100 });
  assert.equal(second.pending, 0);
  assert.equal(second.decks.length, 16);
  assert.equal(site.requests.filter(url => url.includes('/decks/list/jp/')).length, 10);
});

// --- polite fetcher ---------------------------------------------------------

test('fetcher: one request at a time, spaced, identified, retried with backoff', async () => {
  let clock = 0;
  const sleeps: number[] = [];
  const calls: Array<{ url: string; at: number; agent: string | null }> = [];
  const statuses = [500, 200, 200, 404];
  const fetcher = createPoliteFetcher({
    minGapMs: 1000,
    backoffMs: 50,
    now: () => clock,
    sleep: async ms => {
      sleeps.push(ms);
      clock += ms;
    },
    fetchImpl: (async (url: string, init?: RequestInit) => {
      calls.push({ url, at: clock, agent: new Headers(init?.headers).get('User-Agent') });
      return new Response('body', { status: statuses.shift() ?? 200 });
    }) as typeof fetch
  });

  const [first, second] = await Promise.all([fetcher.fetchText('https://a/1'), fetcher.fetchText('https://a/2')]);
  assert.equal(first, 'body');
  assert.equal(second, 'body');
  await assert.rejects(fetcher.fetchText('https://a/3'), NotFoundError);

  assert.deepEqual(
    calls.map(call => call.url),
    ['https://a/1', 'https://a/1', 'https://a/2', 'https://a/3']
  );
  for (let index = 1; index < calls.length; index += 1) {
    assert.ok(calls[index].at - calls[index - 1].at >= 1000, `gap before call ${index}`);
  }
  assert.ok(calls.every(call => call.agent?.startsWith('ciphermaniac-city-leagues/')));
  assert.ok(sleeps.includes(50), 'backed off before the retry');
});
