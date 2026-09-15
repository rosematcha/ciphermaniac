/* eslint-disable camelcase -- Pokedata's API field names are snake_case; the fixtures mirror them exactly */

/**
 * Pokedata record normalization.
 *
 * Every string here ends up on the page, and the URLs end up in `href`s, so
 * the tests lean on what gets refused as much as on what gets kept.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { details, eventKindOf, normalizeEvent, safeUrl } from '../../shared/events/normalize.ts';
import { rawEvent } from '../__utils__/pokedata.ts';

function normalized(overrides = {}) {
  const result = normalizeEvent(rawEvent(overrides));
  assert.ok(result.ok, `expected the record to normalize, got ${JSON.stringify(result)}`);
  return result.event;
}

function skipReason(overrides: Record<string, unknown>) {
  const result = normalizeEvent(rawEvent(overrides));
  assert.equal(result.ok, false);
  return result.ok ? null : result.reason;
}

test('a complete listing keeps every field the locator shows', () => {
  const event = normalized();
  assert.deepEqual(event, {
    id: '26-09-000001',
    kind: 'cup',
    name: 'Test Games League Cup',
    date: '2026-09-20',
    time: '11:00',
    shop: 'TEST GAMES',
    address: '100 MAIN ST, AUSTIN, TX 78701, US',
    city: 'Austin',
    region: 'Texas',
    cc: 'US',
    lat: 30.2672,
    lon: -97.7431,
    url: 'https://www.pokemon.com/us/pokemon-trainer-club/play-pokemon-tournaments/26-09-000001/',
    fee: '$15',
    regOpens: '2026-09-20T10:00',
    regCloses: '2026-09-20T11:00',
    website: 'https://www.example.com/',
    email: 'events@example.com',
    phone: '5125550100',
    details: 'Standard format. Best of three swiss.\n\nBring a deck list.'
  });
});

test('empty optional fields are omitted rather than kept blank', () => {
  const event = normalized({
    Admission: '',
    Event_website: '',
    contact_email: '',
    contact_phone: '',
    Details: '   ',
    Registration_start: '',
    Registration_end: ''
  });
  for (const key of ['fee', 'website', 'email', 'phone', 'details', 'regOpens', 'regCloses', 'registrationUrl']) {
    assert.equal(key in event, false, `${key} should be absent`);
  }
});

test('event kinds come from the Pokedata type', () => {
  assert.equal(eventKindOf('League Cup'), 'cup');
  assert.equal(eventKindOf('League Challenge'), 'challenge');
  assert.equal(eventKindOf('Prerelease'), 'prerelease');
  assert.equal(eventKindOf('TCG Pre-Release'), 'prerelease');
  assert.equal(eventKindOf('nonpremier TCG'), null);
  assert.equal(eventKindOf(undefined), null);
});

test('records the locator cannot place or name are skipped with a reason', () => {
  assert.equal(skipReason({ type: 'nonpremier TCG' }), 'kind');
  assert.equal(skipReason({ Status: 'Cancelled' }), 'cancelled');
  assert.equal(skipReason({ Display_id: 'abc' }), 'id');
  assert.equal(skipReason({ name: '', Name: '' }), 'name');
  assert.equal(skipReason({ date: '20/09/2026' }), 'date');
  assert.equal(skipReason({ date: '2026-99-99' }), 'date');
  assert.equal(skipReason({ date: '2026-02-30' }), 'date');
  assert.equal(skipReason({ latitude: '0', longitude: '0' }), 'coordinates');
  assert.equal(skipReason({ latitude: '91', longitude: '10' }), 'coordinates');
  assert.equal(skipReason({ latitude: 'n/a' }), 'coordinates');
  assert.equal(skipReason({ country_code: 'USA' }), 'country');
});

test('the capitalized Name stands in when the lowercase name is missing', () => {
  assert.equal(normalized({ name: '', Name: 'Fallback Cup' }).name, 'Fallback Cup');
});

test('only http(s) URLs survive, and bare domains become https', () => {
  assert.equal(safeUrl('www.example.com'), 'https://www.example.com/');
  assert.equal(safeUrl('example.co.uk/events'), 'https://example.co.uk/events');
  assert.equal(safeUrl('http://example.com/x'), 'http://example.com/x');
  // eslint-disable-next-line no-script-url -- asserting script URLs are refused
  assert.equal(safeUrl('javascript:alert(1)'), undefined);
  // eslint-disable-next-line no-script-url -- asserting script URLs are refused, whatever their case
  assert.equal(safeUrl('JAVASCRIPT:alert(1)'), undefined);
  assert.equal(safeUrl('mailto:someone@example.com'), undefined);
  assert.equal(safeUrl('data:text/html,hi'), undefined);
  assert.equal(safeUrl('see our facebook'), undefined);
  assert.equal(safeUrl(''), undefined);
  assert.equal(safeUrl(42), undefined);
});

test('the registration site is kept separately from the store website', () => {
  const event = normalized({ Third_party_registration_website: 'https://register.example.com/cup' });
  assert.equal(event.registrationUrl, 'https://register.example.com/cup');
  assert.equal(event.website, 'https://www.example.com/');
});

test('the event page falls back to its canonical pokemon.com address', () => {
  const canonical = 'https://www.pokemon.com/us/pokemon-trainer-club/play-pokemon-tournaments/26-09-000001/';
  assert.equal(normalized({ pokemon_url: 'https://evil.example.com/phish' }).url, canonical);
  assert.equal(normalized({ pokemon_url: 'https://evilpokemon.com/phish' }).url, canonical, 'lookalike domain');
  assert.equal(normalized({ pokemon_url: 'https://pokemon.com.evil.net/x' }).url, canonical);
  assert.equal(normalized({ pokemon_url: '' }).url, canonical);
  // eslint-disable-next-line no-script-url -- asserting script URLs are refused
  assert.equal(normalized({ pokemon_url: 'javascript:alert(1)' }).url, canonical);
  assert.equal(
    normalized({ pokemon_url: 'http://www.pokemon.com/us/x/' }).url,
    'https://www.pokemon.com/us/x/',
    'http pokemon.com links are upgraded'
  );
});

test('fees keep what the store typed, and a zero reads as unlisted', () => {
  assert.equal(normalized({ Admission: '10.00' }).fee, '10.00');
  assert.equal(normalized({ Admission: '7€' }).fee, '7€');
  assert.equal('fee' in normalized({ Admission: '0' }), false);
  assert.equal('fee' in normalized({ Admission: '$0.00' }), false);
});

test('per-division fees are grouped when a store lists them', () => {
  const event = normalized({ Admission_Juniors: '5', Admission_Masters: '10', Admission_Seniors: '' });
  assert.deepEqual(event.divisionFees, { juniors: '5', masters: '10' });
  assert.equal('divisionFees' in normalized(), false);
});

test('registration times drop the misleading zone suffix', () => {
  const event = normalized({
    Registration_start: '2026-09-01 19:00:00',
    Registration_end: '2026-09-20T10:45:00+00:00'
  });
  assert.equal(event.regOpens, '2026-09-01T19:00');
  assert.equal(event.regCloses, '2026-09-20T10:45');
});

test('contact details that do not look like contact details are dropped', () => {
  assert.equal('email' in normalized({ contact_email: 'not an email' }), false);
  assert.equal('email' in normalized({ contact_email: '<script>@x.y' }), false);
  assert.equal('phone' in normalized({ contact_phone: 'call the store' }), false);
  assert.equal('phone' in normalized({ contact_phone: '123' }), false);
  assert.equal(normalized({ contact_phone: '+44 (0)20 7946 0000' }).phone, '+44 (0)20 7946 0000');
});

test('the start time is trimmed to hours and minutes', () => {
  assert.equal(normalized({ time: '18:30:00' }).time, '18:30');
  assert.equal(normalized({ time: '' }).time, '');
  assert.equal(normalized({ time: 'evening' }).time, '');
  assert.equal(normalized({ time: '29:75:00' }).time, '');
  assert.equal('regOpens' in normalized({ Registration_start: '2026-13-01T10:00:00Z' }), false);
});

test('coordinates are rounded to five places and whitespace in names is collapsed', () => {
  const event = normalized({ latitude: ' 30.123456789 ', longitude: '-97.987654321', name: '  Big   Cup  ' });
  assert.equal(event.lat, 30.12346);
  assert.equal(event.lon, -97.98765);
  assert.equal(event.name, 'Big Cup');
});

test('store descriptions keep paragraphs and are capped near 600 characters', () => {
  assert.equal(details('One\r\n\r\n\r\nTwo  words'), 'One\n\nTwo words');
  assert.equal(details(12), undefined);
  const long = details('word '.repeat(200));
  assert.ok(long);
  assert.ok(long.length <= 601, `length ${long.length}`);
  assert.ok(long.endsWith('…'));
  assert.ok(!long.includes('wor…'), 'cuts at a word boundary');
});
