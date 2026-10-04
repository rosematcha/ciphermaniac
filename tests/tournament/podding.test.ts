/** TOM's age-pod rules, including empty divisions in category selection. */

import assert from 'node:assert/strict';
import test from 'node:test';

import { categoryFor, divisionsOf, poddingFor } from '../../shared/tournament/podding.ts';
import { POD_CATEGORIES } from '../../shared/tournament/types.ts';

const pods = (junior: number, senior: number, masters: number) =>
  Object.fromEntries(poddingFor({ junior, senior, masters }));

test('six or more in every division plays each apart', () => {
  assert.deepEqual(pods(6, 6, 6), { junior: 'junior', senior: 'senior', masters: 'masters' });
});

test('Juniors under six join the Seniors, and both join the Masters if still under six', () => {
  assert.deepEqual(pods(5, 6, 6), { junior: 'junior-senior', senior: 'junior-senior', masters: 'masters' });
  assert.deepEqual(pods(2, 3, 10), { junior: 'mixed', senior: 'mixed', masters: 'mixed' });
  assert.deepEqual(pods(3, 0, 10), { junior: 'mixed', masters: 'mixed' }, 'with no Seniors, straight to the Masters');
});

test('with six Juniors, Seniors under six join the Masters', () => {
  assert.deepEqual(pods(6, 5, 6), { junior: 'junior', senior: 'senior-masters', masters: 'senior-masters' });
});

test('Masters under six join the Seniors', () => {
  assert.deepEqual(pods(6, 6, 5), { junior: 'junior', senior: 'senior-masters', masters: 'senior-masters' });
  assert.deepEqual(
    pods(4, 8, 3),
    { junior: 'mixed', senior: 'mixed', masters: 'mixed' },
    'Seniors already with Juniors'
  );
});

test('where the handbook stops short, a pod still under six joins the Juniors', () => {
  assert.deepEqual(pods(8, 2, 3), { junior: 'mixed', senior: 'mixed', masters: 'mixed' });
  assert.deepEqual(pods(7, 0, 4), { junior: 'mixed', masters: 'mixed' });
});

test('a division with nobody in it has no pod, and one alone keeps its own however small', () => {
  assert.deepEqual(pods(0, 0, 4), { masters: 'masters' });
  assert.deepEqual(pods(0, 0, 0), {});
});

test('a category names exactly the divisions its pod plays', () => {
  for (const category of POD_CATEGORIES) {
    assert.equal(categoryFor(divisionsOf(category)), category);
  }
  assert.equal(categoryFor(['junior', 'masters']), 'mixed', 'TOM has no pod for Juniors and Masters alone');
});

test('TOM includes empty divisions in combined category choices without creating empty roster entries', () => {
  assert.deepEqual(pods(5, 10, 0), { junior: 'mixed', senior: 'mixed' });
  assert.deepEqual(pods(0, 3, 22), { senior: 'mixed', masters: 'mixed' });
  assert.deepEqual(pods(0, 6, 22), { senior: 'junior-senior', masters: 'masters' });
  assert.deepEqual(pods(6, 0, 22), { junior: 'junior', masters: 'senior-masters' });
});
