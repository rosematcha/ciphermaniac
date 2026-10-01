/** Which saved profiles are complete enough to apply to run events with. */

import assert from 'node:assert/strict';
import test from 'node:test';

import { profileComplete } from '../../shared/accounts/applications.ts';

const COMPLETE = { popId: '1234567', firstName: 'Pat', lastName: 'Player', birthDate: '02/27/2001' };

test('a profile with every field a sanctioned event asks for is complete', () => {
  assert.equal(profileComplete(COMPLETE), true);
});

test('a profile missing any field, the POP ID above all, is not', () => {
  for (const field of Object.keys(COMPLETE) as (keyof typeof COMPLETE)[]) {
    assert.equal(profileComplete({ ...COMPLETE, [field]: null }), false, `without ${field}`);
    assert.equal(profileComplete({ ...COMPLETE, [field]: '' }), false, `with an empty ${field}`);
  }
});

test('a field saved in a shape the profile form would refuse is not complete', () => {
  assert.equal(profileComplete({ ...COMPLETE, popId: '12345678901' }), false);
  assert.equal(profileComplete({ ...COMPLETE, popId: 'P-123' }), false);
  assert.equal(profileComplete({ ...COMPLETE, birthDate: '2001-02-27' }), false);
  assert.equal(profileComplete({ ...COMPLETE, firstName: 'x'.repeat(41) }), false);
});
