import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { synonymObjects } from '../../.github/scripts/lib/synonymObjects.ts';
import { buildPrintingRows, withPrintOrder } from '../../src/utils/printings.ts';
import type { SynonymDatabase } from '../../shared/data/cardIdentity.ts';

test('the browser parts are written before the whole database the next run compares against', () => {
  const data = {
    synonyms: { 'Iono::PAL::269': 'Iono::PAL::185' },
    canonicals: { Iono: 'Iono::PAL::185' },
    prints: { 'Iono::PAL::269': 12, 'Iono::PAL::185': 0.25 }
  };
  const objects = synonymObjects(data);
  assert.deepEqual(
    objects.map(([key]) => key),
    [
      'assets/card-synonyms-slim.json',
      'assets/card-routes.json',
      'assets/card-prints.json',
      'assets/card-synonyms.json'
    ]
  );
  assert.deepEqual(JSON.parse(objects[1][1] as string), { 'PAL::269': 'PAL/185' });
  assert.deepEqual(JSON.parse(objects[0][1] as string), {
    synonyms: data.synonyms,
    canonicals: data.canonicals,
    canonicalAt: { 'Iono::PAL::185': 1 }
  });
  assert.deepEqual(JSON.parse(objects[2][1] as string), { prints: data.prints });
  assert.equal(objects[3][1], data);
});

test('the slim database orders every strip as the full one does, before and after its prices load', () => {
  const fixtures = new URL('../fixtures/e2e/assets/', import.meta.url);
  const full = JSON.parse(readFileSync(new URL('card-synonyms.json', fixtures), 'utf8')) as SynonymDatabase;
  const { prints } = JSON.parse(readFileSync(new URL('card-prints.json', fixtures), 'utf8')) as SynonymDatabase;
  const data = { ...full, prints };
  const slim = JSON.parse(synonymObjects(data)[0][1] as string) as SynonymDatabase;
  const order = (db: SynonymDatabase | null, uid: string) => buildPrintingRows(db, uid).map(row => row.uid);
  const clustered = Object.keys(full.synonyms);
  assert.ok(clustered.includes("Boss's Orders::SP::251"), 'covers a cluster whose canonical is not first');
  for (const uid of clustered) {
    const expected = order(data, uid);
    assert.deepEqual(order(withPrintOrder(slim, undefined), uid), expected, `${uid} before prices`);
    assert.deepEqual(order(withPrintOrder(slim, prints), uid), expected, `${uid} after prices`);
  }
});
