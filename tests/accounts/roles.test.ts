/** What each account role may do, and how a stored role is read. */

import assert from 'node:assert/strict';
import test from 'node:test';

import { canCreateEvents, isAdmin, readAccountRole } from '../../shared/accounts/roles.ts';

test('organizers and admins start events; a player and a revoked organizer do not', () => {
  assert.equal(canCreateEvents('organizer'), true);
  assert.equal(canCreateEvents('admin'), true);
  assert.equal(canCreateEvents('revoked'), false);
  assert.equal(canCreateEvents(null), false);
});

test('only an admin is an admin', () => {
  assert.equal(isAdmin('admin'), true);
  assert.equal(isAdmin('organizer'), false);
  assert.equal(isAdmin('revoked'), false);
  assert.equal(isAdmin(null), false);
});

test('a stored role the code does not know reads as no role', () => {
  assert.equal(readAccountRole('organizer'), 'organizer');
  assert.equal(readAccountRole('revoked'), 'revoked');
  assert.equal(readAccountRole('admin'), 'admin');
  assert.equal(readAccountRole('Admin'), null);
  assert.equal(readAccountRole('owner'), null);
  assert.equal(readAccountRole(''), null);
  assert.equal(readAccountRole(null), null);
  assert.equal(readAccountRole(1), null);
});
