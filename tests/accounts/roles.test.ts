/** What each account role may do, and how a stored role is read. */

import assert from 'node:assert/strict';
import test from 'node:test';

import { canJoinCommunity, canRunCommunityEvents, isAdmin, readAccountRole } from '../../shared/accounts/roles.ts';
import { canCreateEvents } from '../../shared/accounts/stores.ts';

test('a Community organizer and an Admin start events of their own; a player and a revoked one do not', () => {
  assert.equal(canRunCommunityEvents('community'), true);
  assert.equal(canRunCommunityEvents('admin'), true);
  assert.equal(canRunCommunityEvents('revoked'), false);
  assert.equal(canRunCommunityEvents(null), false);
});

test('anyone in an active store starts its events, whatever their own role', () => {
  assert.equal(canCreateEvents(null, [{ status: 'active' }]), true);
  assert.equal(canCreateEvents('revoked', [{ status: 'revoked' }, { status: 'active' }]), true);
  assert.equal(canCreateEvents(null, [{ status: 'revoked' }]), false);
  assert.equal(canCreateEvents(null, []), false);
  assert.equal(canCreateEvents('community', []), true);
});

test('only a player becomes a Community organizer by asking', () => {
  assert.equal(canJoinCommunity(null), true);
  assert.equal(canJoinCommunity('revoked'), false, 'an Admin took it away');
  assert.equal(canJoinCommunity('community'), false);
  assert.equal(canJoinCommunity('admin'), false);
});

test('only an admin is an admin', () => {
  assert.equal(isAdmin('admin'), true);
  assert.equal(isAdmin('community'), false);
  assert.equal(isAdmin('revoked'), false);
  assert.equal(isAdmin(null), false);
});

test('a stored role the code does not know reads as no role', () => {
  assert.equal(readAccountRole('community'), 'community');
  assert.equal(readAccountRole('organizer'), null, 'the role before Community organizers');
  assert.equal(readAccountRole('superuser'), null);
  assert.equal(readAccountRole(7), null);
});
