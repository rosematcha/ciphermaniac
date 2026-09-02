/**
 * The tournament side of the Fraudulent graphic.
 *
 * The behavior that carries the mode is keying the event's rows onto the SAME
 * canonical UIDs the online window uses — a rebaked event files a card under
 * its event-date print, and an unmapped join turns a widely played card into a
 * phantom 0%.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildEventField } from '../../src/pages/socialGraphics/eventField.ts';
import type { MasterPayload } from '../../src/lib/data/reports.ts';
import type { SynonymDatabase } from '../../shared/data/cardIdentity.ts';

function master(rows: [uid: string, found: number][], deckTotal: number): MasterPayload {
  return {
    deckTotal,
    items: rows.map(([uid, found], idx) => {
      const [name, set, number] = uid.split('::');
      return { rank: idx + 1, name, set, number, uid, found, total: deckTotal, pct: (found / deckTotal) * 100 };
    })
  } as MasterPayload;
}

test('the field carries the deck total and every card count', () => {
  const field = buildEventField(
    master(
      [
        ['Switch::MEG::130', 139],
        ['Boss::DRI::176', 93]
      ],
      797
    ),
    null
  );
  assert.equal(field.deckTotal, 797);
  assert.equal(field.found.get('Switch::MEG::130'), 139);
  assert.equal(field.found.get('Boss::DRI::176'), 93);
});

test("the field re-keys the event's own canonical print onto today's", () => {
  // Worlds keys Dudunsparce as TEF 129 (the canonical print as of its own
  // date); the online window keys it as PRE 080. Left unmapped, a card in a
  // fifth of both fields reads as never played at the event.
  const db = { synonyms: { 'Dudunsparce::TEF::129': 'Dudunsparce::PRE::080' }, canonicals: {} } as SynonymDatabase;
  const field = buildEventField(master([['Dudunsparce::TEF::129', 159]], 797), db);
  assert.equal(field.found.get('Dudunsparce::PRE::080'), 159);
  assert.equal(field.found.has('Dudunsparce::TEF::129'), false);
});

test('two prints of one card land on a single count', () => {
  const db = { synonyms: { 'Switch::SVI::194': 'Switch::MEG::130' }, canonicals: {} } as SynonymDatabase;
  const field = buildEventField(
    master(
      [
        ['Switch::MEG::130', 100],
        ['Switch::SVI::194', 39]
      ],
      797
    ),
    db
  );
  assert.equal(field.found.get('Switch::MEG::130'), 139);
});

test('the field records which sets the event actually saw', () => {
  const field = buildEventField(
    master(
      [
        ['Switch::MEG::130', 100],
        ['Boss::DRI::176', 50]
      ],
      800
    ),
    null
  );
  assert.deepEqual([...field.sets].sort(), ['DRI', 'MEG']);
});
