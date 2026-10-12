/** The age rules: who may hold an account, and what a birth year says about a player. */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  accountYear,
  birthYearOfDate,
  mayBeMinor,
  mayBeUnder13,
  oldEnoughForAccount
} from '../../shared/accounts/age.ts';
import { birthDateOfYear, yearOnlyBirthDate } from '../../shared/tournament/divisions.ts';

const NOW = new Date(Date.UTC(2026, 9, 4, 20));

test('an account is for someone 16 or older on the day, by their full birth date', () => {
  assert.equal(oldEnoughForAccount('2010-10-04', NOW), true, 'sixteen today');
  assert.equal(oldEnoughForAccount('2010-10-05', NOW), false, 'sixteen tomorrow');
  assert.equal(oldEnoughForAccount('1990-06-15', NOW), true);
  assert.equal(oldEnoughForAccount('2015-01-01', NOW), false);
  assert.equal(oldEnoughForAccount('2008-02-30', NOW), false, 'no such day');
  assert.equal(oldEnoughForAccount('10/04/2000', NOW), false, 'only YYYY-MM-DD');
  assert.equal(oldEnoughForAccount('', NOW), false);
});

test('a birth date gives its year only when it is a real day in the past', () => {
  assert.equal(birthYearOfDate('1990-06-15', NOW), 1990);
  assert.equal(birthYearOfDate('2026-10-05', NOW), null, 'tomorrow');
  assert.equal(birthYearOfDate('1899-12-31', NOW), null);
  assert.equal(birthYearOfDate('1990-13-01', NOW), null);
  assert.equal(birthYearOfDate('nope', NOW), null);
});

test('a birth year is judged by the youngest its holder could be', () => {
  assert.equal(mayBeMinor(2008, NOW), true, 'born in 2008, still 17 until their birthday');
  assert.equal(mayBeMinor(2007, NOW), false);
  assert.equal(mayBeUnder13(2013, NOW), true, 'born in 2013, still 12 until their birthday');
  assert.equal(mayBeUnder13(2012, NOW), false);
  assert.equal(mayBeMinor(null, NOW), false, 'an unknown year says nothing');
  assert.equal(mayBeUnder13(null, NOW), false);
});

test('an account may name a year someone 16 or older can have been born in', () => {
  assert.equal(accountYear(2010, NOW), true, 'the age check already saw the full date');
  assert.equal(accountYear(2011, NOW), false);
  assert.equal(accountYear(1899, NOW), false);
  assert.equal(accountYear(null, NOW), false);
});

test('a birth date is kept as its year alone, on the day TOM files use', () => {
  assert.equal(yearOnlyBirthDate('06/15/2012'), '02/27/2012');
  assert.equal(yearOnlyBirthDate(' 1/2/1990 '), '02/27/1990');
  assert.equal(yearOnlyBirthDate('02/27/1990'), '02/27/1990');
  assert.equal(yearOnlyBirthDate(''), '');
  assert.equal(yearOnlyBirthDate('1990'), '', 'a bare year is not TOM’s format');
  assert.equal(birthDateOfYear(2001), '02/27/2001');
});
