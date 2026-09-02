/**
 * The tournament side of the Fraudulent graphic.
 *
 * The behavior that carries the mode is keying both of the event's reports onto
 * the SAME canonical UIDs the online window uses — a rebaked event files a card
 * under its event-date print, and an unmapped join turns a widely played card
 * into a phantom 0%.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildEventField } from '../../src/pages/socialGraphics/eventField.ts';
import type { MasterPayload } from '../../src/lib/data/reports.ts';
import type { ConversionPayload } from '../../src/lib/data/events.ts';
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

function conversion(cards: Record<string, [day1: number, day2: number]>, totals: [number, number]): ConversionPayload {
  return {
    day1Total: totals[0],
    day2Total: totals[1],
    cards: Object.fromEntries(Object.entries(cards).map(([uid, [day1, day2]]) => [uid, { day1, day2 }]))
  };
}

test('the field carries the deck total, card counts and the cut', () => {
  const field = buildEventField(
    master(
      [
        ['Switch::MEG::130', 139],
        ['Boss::DRI::176', 93]
      ],
      797
    ),
    conversion({ 'Switch::MEG::130': [139, 12] }, [797, 143]),
    null
  );
  assert.equal(field.deckTotal, 797);
  assert.deepEqual(field.cards.get('Switch::MEG::130'), { found: 139, day1: 139, day2: 12 });
  assert.deepEqual(field.cards.get('Boss::DRI::176'), { found: 93, day1: 0, day2: 0 });
  assert.equal(Math.round(field.fieldConversion ?? 0), 18);
});

test('an event with no published cut has no conversion to weigh', () => {
  const field = buildEventField(master([['Switch::MEG::130', 139]], 797), null, null);
  assert.equal(field.fieldConversion, null);
  assert.deepEqual(field.cards.get('Switch::MEG::130'), { found: 139, day1: 0, day2: 0 });
});

test("both reports re-key the event's own canonical print onto today's", () => {
  // Worlds keys Dudunsparce as TEF 129 (the canonical print as of its own
  // date); the online window keys it as PRE 080. Left unmapped, a card in a
  // fifth of both fields reads as never played at the event.
  const db = { synonyms: { 'Dudunsparce::TEF::129': 'Dudunsparce::PRE::080' }, canonicals: {} } as SynonymDatabase;
  const field = buildEventField(
    master([['Dudunsparce::TEF::129', 159]], 797),
    conversion({ 'Dudunsparce::TEF::129': [159, 30] }, [797, 143]),
    db
  );
  assert.deepEqual(field.cards.get('Dudunsparce::PRE::080'), { found: 159, day1: 159, day2: 30 });
  assert.equal(field.cards.has('Dudunsparce::TEF::129'), false);
});

test('two prints of one card land on a single row', () => {
  const db = { synonyms: { 'Switch::SVI::194': 'Switch::MEG::130' }, canonicals: {} } as SynonymDatabase;
  const field = buildEventField(
    master(
      [
        ['Switch::MEG::130', 100],
        ['Switch::SVI::194', 39]
      ],
      797
    ),
    null,
    db
  );
  assert.equal(field.cards.get('Switch::MEG::130')?.found, 139);
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
    null,
    null
  );
  assert.deepEqual([...field.sets].sort(), ['DRI', 'MEG']);
});
