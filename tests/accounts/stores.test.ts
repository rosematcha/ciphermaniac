/** What a store says about itself, checked the same way on the page and in the functions. */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  dateIn,
  isTimeZone,
  readExceptions,
  readLeagueId,
  readNights,
  readStoreApplication,
  readStoreDetails
} from '../../shared/accounts/stores.ts';
import { storeApplication } from '../__utils__/storeApplication.ts';

test('a league ID is the number, or the number in its pokemon.com league page', () => {
  assert.equal(readLeagueId('6238620'), '6238620');
  assert.equal(readLeagueId(' 6238620 '), '6238620');
  assert.equal(readLeagueId('https://www.pokemon.com/us/play-pokemon/pokemon-events/leagues/6238620/'), '6238620');
  assert.equal(readLeagueId('https://www.pokemon.com/us/play-pokemon/pokemon-events/leagues/6238620'), '6238620');
  assert.equal(readLeagueId('https://example.com/leagues/6238620/?ref=x'), '6238620');
  assert.equal(readLeagueId('123'), null, 'too short to be one');
  assert.equal(readLeagueId('62386201234'), null, 'too long');
  assert.equal(readLeagueId('Combat Power'), null);
});

test('store details need a name, an address and a country; links are https, an email is an email', () => {
  const { details } = storeApplication();
  assert.deepEqual(readStoreDetails(details), details);
  assert.equal(readStoreDetails({ ...details, name: '' }), null);
  assert.equal(readStoreDetails({ ...details, address: ' ' }), null);
  assert.equal(readStoreDetails({ ...details, country: 'USA' }), null);
  assert.equal(readStoreDetails({ ...details, country: 'us' })?.country, 'US');
  assert.equal(readStoreDetails({ ...details, website: 'http://insecure.example' }), null);
  assert.equal(readStoreDetails({ ...details, website: ['javascript', 'alert(1)'].join(':') }), null);
  assert.equal(readStoreDetails({ ...details, discord: 'https://discord.gg/abc' })?.discord, 'https://discord.gg/abc');
  assert.equal(readStoreDetails({ ...details, email: 'not-an-email' }), null);
  assert.equal(readStoreDetails({ ...details, email: '' })?.email, '');
  assert.equal(readStoreDetails({ ...details, name: 'x'.repeat(81) }), null);
  assert.equal(readStoreDetails({ ...details, phone: 7 }), null);
  assert.equal(readStoreDetails(null), null);
});

test('league nights are a weekday, a time and an ID each, no two alike', () => {
  const { nights } = storeApplication();
  assert.deepEqual(readNights(nights), nights);
  assert.deepEqual(readNights([]), []);
  assert.equal(readNights([{ ...nights[0], weekday: 7 }]), null);
  assert.equal(readNights([{ ...nights[0], time: '7:30' }]), null);
  assert.equal(readNights([{ ...nights[0], time: '24:00' }]), null);
  assert.equal(readNights([{ ...nights[0], id: 'has space' }]), null);
  assert.equal(readNights([nights[0], nights[0]]), null, 'two with one ID');
  assert.equal(readNights(Array.from({ length: 15 }, (_, i) => ({ ...nights[0], id: `n${i}` }))), null);
  assert.equal(readNights('sundays'), null);
});

test('an exception names a date, the night it changes or the whole day, and a new time or none', () => {
  const { nights } = storeApplication();
  const off = { date: '2026-12-27', nightId: 'sun', time: null, note: 'League Cup' };
  const moved = { date: '2026-12-30', nightId: null, time: '18:00', note: '' };
  assert.deepEqual(readExceptions([off, moved], nights), [off, moved]);
  assert.equal(readExceptions([{ ...off, nightId: 'fri' }], nights), null, 'a night the store does not run');
  assert.equal(readExceptions([{ ...off, date: '12/27/2026' }], nights), null);
  assert.equal(readExceptions([{ ...moved, time: '6pm' }], nights), null);
  assert.equal(readExceptions([{ ...off, note: 'x'.repeat(121) }], nights), null);
  assert.equal(readExceptions({}, nights), null);
});

test('a store application holds together, or says the first thing wrong with it', () => {
  const app = storeApplication();
  assert.deepEqual(readStoreApplication(app), app);
  assert.deepEqual(readStoreApplication({ ...app, nights: undefined }), { ...app, nights: [] });
  assert.equal(readStoreApplication({ ...app, place: null }).constructor, Object, 'a place is optional');
  assert.equal(
    readStoreApplication({ ...app, place: { lat: 200, lon: 0, timeZone: 'UTC' } }),
    'Pick the store’s time zone'
  );
  assert.equal(
    readStoreApplication({ ...app, certified: 'yes' }),
    'Confirm you are a certified organizer, or work with one'
  );
  assert.equal(readStoreApplication(null), 'Enter the store’s league ID');
});

test('a time zone is one the runtime knows; a date is the store’s own', () => {
  assert.equal(isTimeZone('America/Chicago'), true);
  assert.equal(isTimeZone('Mars/Olympus'), false);
  assert.equal(isTimeZone(''), false);
  const lateSaturdayInTexas = Date.parse('2026-10-04T03:30:00Z');
  assert.equal(dateIn('America/Chicago', lateSaturdayInTexas), '2026-10-03');
  assert.equal(dateIn('UTC', lateSaturdayInTexas), '2026-10-04');
});
