/**
 * Listing presentation: each event in its own country's conventions.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addressLine,
  countryName,
  dayHeading,
  daysBetween,
  formatClock,
  formatFee,
  formatWallTime,
  isoDate,
  isWeekend,
  monthDay,
  relativeDay,
  titleCase,
  usStateCode
} from '../../src/lib/events/format.ts';

test('the clock follows the country', () => {
  assert.equal(formatClock('19:30', 'US'), '7:30 pm');
  assert.equal(formatClock('09:05', 'US'), '9:05 am');
  assert.equal(formatClock('00:15', 'CA'), '12:15 am');
  assert.equal(formatClock('12:00', 'AU'), '12:00 pm');
  assert.equal(formatClock('19:30', 'IT'), '19:30');
  assert.equal(formatClock('9:05', 'DE'), '09:05');
  assert.equal(formatClock('', 'US'), '');
});

test('fees are shown in the currency of the event, whatever the store typed', () => {
  assert.equal(formatFee('10', 'US'), '$10');
  assert.equal(formatFee('$10.00', 'US'), '$10');
  assert.equal(formatFee('10.50', 'GB'), '£10.50');
  assert.equal(formatFee('7€', 'DE'), '€7');
  assert.equal(formatFee('10,50', 'FR'), '€10.50');
  assert.equal(formatFee('20', 'BR'), 'R$20');
  assert.equal(formatFee('1,000', 'CL'), '$1,000');
  assert.equal(formatFee('5 or 2 packs', 'US'), '5 or 2 packs');
  assert.equal(formatFee('10', 'ZZ'), '10');
});

test('names typed in capitals are title-cased; anything else is left alone', () => {
  assert.equal(titleCase("DRAGON'S LAIR AUSTIN"), "Dragon's Lair Austin");
  assert.equal(titleCase('HOUSE OF CARDS'), 'House of Cards');
  assert.equal(titleCase('THE GOBLINS DEN'), 'The Goblins Den');
  assert.equal(titleCase('TCG PLAYGROUND LLC'), 'TCG Playground LLC');
  assert.equal(titleCase('STORE 42B'), 'Store 42B');
  assert.equal(titleCase('CAFÉ ÉCLAIR'), 'Café Éclair');
  assert.equal(titleCase('iPlay Games'), 'iPlay Games');
  assert.equal(titleCase('McKinney Comics'), 'McKinney Comics');
  assert.equal(titleCase('lowercase store'), 'lowercase store');
  assert.equal(titleCase(''), '');
});

test('addresses drop the country and keep region codes in capitals', () => {
  assert.equal(addressLine('100 MAIN ST, AUSTIN, TX 78701, US', 'US'), '100 Main St, Austin, TX 78701');
  assert.equal(addressLine("ST JOHN'S RD, ISLEWORTH TW7 6NB, UK", 'GB'), "St John's Rd, Isleworth TW7 6NB");
  assert.equal(
    addressLine('SHOP 20/171 DANDENONG RD, MOUNT OMMANEY QLD 4074, AUSTRALIA', 'AU'),
    'Shop 20/171 Dandenong Rd, Mount Ommaney QLD 4074'
  );
  assert.equal(
    addressLine('HILDESHEIMER STR. 54A, 30880 LAATZEN, GERMANY', 'DE'),
    'Hildesheimer Str. 54A, 30880 Laatzen'
  );
  assert.equal(addressLine('Via Roma 1, Milano, Italy', 'IT'), 'Via Roma 1, Milano');
});

test('country names and US state codes', () => {
  assert.equal(countryName('IT'), 'Italy');
  assert.equal(countryName('gb'), 'United Kingdom');
  assert.equal(usStateCode('Texas'), 'TX');
  assert.equal(usStateCode('texas'), 'TX');
  assert.equal(usStateCode('tx'), 'TX');
  assert.equal(usStateCode('Ontario'), null);
});

test('dates read as short headings, relative days, and weekends', () => {
  assert.equal(isoDate(new Date(2026, 8, 5)), '2026-09-05');
  assert.equal(monthDay('2026-09-01'), 'Sep 1');
  assert.equal(dayHeading('2026-09-16'), 'Wed, Sep 16');
  assert.equal(formatWallTime('2026-09-01T19:00', 'US'), 'Sep 1, 7:00 pm');
  assert.equal(formatWallTime('2026-09-01T19:00', 'FR'), 'Sep 1, 19:00');
  assert.equal(isWeekend('2026-09-19'), true);
  assert.equal(isWeekend('2026-09-20'), true);
  assert.equal(isWeekend('2026-09-16'), false);
  assert.equal(daysBetween('2026-09-15', '2026-10-15'), 30);
  assert.equal(daysBetween('2026-03-07', '2026-03-09'), 2, 'across a DST change');
});

test('relative days', () => {
  const today = '2026-09-15';
  assert.equal(relativeDay(today, '2026-09-15'), 'Today');
  assert.equal(relativeDay(today, '2026-09-14'), 'Today');
  assert.equal(relativeDay(today, '2026-09-16'), 'Tomorrow');
  assert.equal(relativeDay(today, '2026-09-19'), 'In 4 days');
  assert.equal(relativeDay(today, '2026-09-22'), 'Next week');
  assert.equal(relativeDay(today, '2026-09-28'), 'Next week');
  assert.equal(relativeDay(today, '2026-09-29'), 'In 2 weeks');
});
