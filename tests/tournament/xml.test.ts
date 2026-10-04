import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeEntities, encodeEntities } from '../../shared/tournament/xml.ts';

test('TOM escapes apostrophes along with the other XML delimiters in fictional names', () => {
  const name = `Robin O'Brien & <Finch> "Sky"`;
  const escaped = 'Robin O&apos;Brien &amp; &lt;Finch&gt; &quot;Sky&quot;';
  assert.equal(encodeEntities(name), escaped);
  assert.equal(decodeEntities(escaped), name);
});
