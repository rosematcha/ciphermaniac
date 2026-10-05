/**
 * Stores from the browser: each call goes to its endpoint with the body the
 * functions read, and the pages' readings of store data (a listing as the
 * setup it fills, a league lookup as store details, league nights and their
 * changes in words, an invite as a link and the name the server lists it
 * under) come out as the pages show them.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { afterEach, test } from 'node:test';

import type { LeagueFound, Listing } from '../../shared/accounts/types.ts';
import {
  addressOf,
  bareLink,
  blankNight,
  byWeek,
  cleanDetails,
  clock,
  createInvite,
  detailsFromLeague,
  detailsProblems,
  emptyDetails,
  exceptionChange,
  fetchLeague,
  fetchListings,
  fetchPeople,
  fetchStore,
  inviteId,
  inviteLink,
  joinCommunity,
  joinStore,
  listingFill,
  removeMember,
  saveLeagueNights,
  saveStoreDetails,
  setMemberRole,
  shortDay,
  storeEventWhen,
  timeZones,
  withdrawInvite,
  zoneName
} from '../../src/lib/tournament/stores.ts';

interface Sent {
  url: string;
  method: string;
  body: unknown;
}

const realFetch = globalThis.fetch;
let sent: Sent[] = [];

function answer(status: number, body: unknown) {
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    sent.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : null });
    return status === 204 ? new Response(null, { status }) : Response.json(body, { status });
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  sent = [];
});

const night = { id: 'wed', weekday: 3, time: '19:30', name: 'League night', fee: '$5' };

test('each store call goes to its endpoint with the body the functions read', async () => {
  answer(200, {});
  await fetchLeague(' https://www.pokemon.com/us/play-pokemon/pokemon-events/leagues/6238620/ ');
  await joinCommunity();
  await fetchStore('s 1');
  await saveStoreDetails('s1', { details: emptyDetails(), timeZone: 'America/Chicago', place: null });
  await saveLeagueNights('s1', [night], []);
  await fetchPeople('s1');
  await createInvite('s1', 'staff');
  await setMemberRole('s1', 'u2', 'manager');
  await joinStore('tok');
  await fetchListings('s1');
  answer(204, null);
  await removeMember('s1', 'u2');
  await withdrawInvite('s1', 'abc');
  assert.deepEqual(
    sent.map(s => `${s.method} ${s.url}`),
    [
      'GET /api/leagues/https%3A%2F%2Fwww.pokemon.com%2Fus%2Fplay-pokemon%2Fpokemon-events%2Fleagues%2F6238620%2F',
      'POST /api/community',
      'GET /api/stores/s%201',
      'PATCH /api/stores/s1',
      'PUT /api/stores/s1/nights',
      'GET /api/stores/s1/members',
      'POST /api/stores/s1/members',
      'PATCH /api/stores/s1/members',
      'POST /api/stores/join',
      'GET /api/stores/s1/listings',
      'DELETE /api/stores/s1/members?user=u2',
      'DELETE /api/stores/s1/members?invite=abc'
    ]
  );
  assert.deepEqual(sent[4]?.body, { nights: [night], exceptions: [] });
  assert.deepEqual(sent[6]?.body, { invite: 'staff' });
  assert.deepEqual(sent[7]?.body, { user: 'u2', role: 'manager' });
  assert.deepEqual(sent[8]?.body, { token: 'tok' });
});

const listing = (kind: Listing['kind'], time = '11:00'): Listing => ({
  sanctionId: '26-10-007710',
  kind,
  name: 'Combat Power League Cup',
  date: '2026-10-11',
  time
});

test('a Cup or Challenge listing fills a sanctioned event of its kind; others carry the ID unsanctioned', () => {
  assert.deepEqual(listingFill(listing('cup')), {
    name: 'Combat Power League Cup',
    startsAt: '2026-10-11T11:00',
    sanctionId: '26-10-007710',
    sanctioned: true,
    eventType: 'cup'
  });
  assert.equal(listingFill(listing('challenge')).eventType, 'challenge');
  assert.equal(listingFill(listing('prerelease')).sanctioned, false);
  assert.equal(listingFill(listing('local')).sanctioned, false);
  assert.equal(listingFill(listing('cup', '')).startsAt, '');
});

test('a league the locator lists becomes store details, its upper-case listing in title case', () => {
  const found: LeagueFound = {
    leagueId: '6238620',
    shop: 'COMBAT POWER GAMING',
    address: '4522 FREDERICKSBURG RD #B64',
    city: 'SAN ANTONIO',
    region: 'tx',
    cc: 'us',
    lat: 29.49,
    lon: -98.55,
    timeZone: 'America/Chicago'
  };
  assert.deepEqual(detailsFromLeague(found), {
    name: 'Combat Power Gaming',
    address: '4522 Fredericksburg Rd #B64',
    city: 'San Antonio',
    region: 'TX',
    country: 'US'
  });
  assert.equal(detailsFromLeague({ ...found, region: 'NEW SOUTH WALES' }).region, 'New South Wales');
});

test('store details say which fields the server would refuse, and are cleaned as it keeps them', () => {
  assert.deepEqual(Object.keys(detailsProblems(emptyDetails())).sort(), ['address', 'name']);
  const typed = {
    ...emptyDetails(),
    name: ' Combat Power ',
    address: '4522 Fredericksburg Rd',
    country: 'usa',
    website: 'http://combat.example',
    discord: 'discord.gg/x',
    email: 'not-mail'
  };
  assert.deepEqual(Object.keys(detailsProblems(typed)).sort(), ['country', 'discord', 'email', 'website']);
  // An address the server's URL reading refuses is refused here too, not only one without https.
  assert.ok(detailsProblems({ ...emptyDetails(), name: 'a', address: 'b', website: 'https://%' }).website);
  const fine = { ...typed, country: ' us', website: 'https://combat.example', discord: '', email: 'a@b.co' };
  assert.deepEqual(detailsProblems(fine), {});
  assert.deepEqual(cleanDetails(fine), { ...fine, name: 'Combat Power', country: 'US' });
});

test('times, dates, nights and their changes read as the pages show them', () => {
  assert.equal(clock('19:30'), '7:30 PM');
  assert.equal(clock('00:05'), '12:05 AM');
  assert.equal(clock('12:00'), '12:00 PM');
  assert.equal(shortDay('2026-10-11'), 'Sun, Oct 11');
  assert.equal(storeEventWhen('10/07/2026', '2026-10-07T19:30'), 'Wed, Oct 7, 7:30 PM');
  assert.equal(storeEventWhen('10/07/2026', ''), 'Wed, Oct 7');
  assert.equal(exceptionChange({ date: '2026-10-11', nightId: null, time: null, note: '' }), 'Off');
  assert.equal(exceptionChange({ date: '2026-10-11', nightId: 'wed', time: '16:00', note: '' }), 'Moved to 4:00 PM');
  const sunday = { ...night, id: 'sun', weekday: 0, time: '15:00' };
  const late = { ...night, id: 'late', time: '21:00' };
  assert.deepEqual(
    byWeek([late, night, sunday]).map(item => item.id),
    ['sun', 'wed', 'late']
  );
  assert.equal(
    addressOf({ address: '1 Main St', city: 'Austin', region: 'TX', postal: '78701' }),
    '1 Main St, Austin, TX 78701'
  );
  assert.equal(addressOf({ address: '1 Main St', city: '', region: '', postal: '' }), '1 Main St');
  assert.equal(bareLink('https://combat.example/'), 'combat.example');
});

test('a new league night takes a weekday the store has none on', () => {
  const first = blankNight([]);
  assert.equal(first.weekday, 3);
  assert.equal(first.time, '18:00');
  assert.match(first.id, /^[\w-]{1,24}$/);
  assert.equal(blankNight([night]).weekday, 4);
  assert.notEqual(blankNight([]).id, first.id);
});

test('time zones name themselves, and a zone the browser lacks stays listed', () => {
  assert.equal(zoneName('America/Chicago'), 'Central Time');
  assert.equal(zoneName('Not/AZone'), 'Not/AZone');
  assert.ok(timeZones('America/Chicago').includes('America/Chicago'));
  assert.equal(timeZones('Mars/Olympus')[0], 'Mars/Olympus');
});

test('an invite is a join link, listed under the start of its token’s SHA-256', async () => {
  assert.equal(inviteLink('https://ciphermaniac.com', 'a b'), 'https://ciphermaniac.com/stores/join?invite=a+b');
  const token = 'k3QwP9zXr2';
  assert.equal(await inviteId(token), createHash('sha256').update(token).digest('hex').slice(0, 16));
});
