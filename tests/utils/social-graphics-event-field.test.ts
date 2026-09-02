/**
 * The live-event side of the Fraudulent graphic.
 *
 * Two behaviors carry the mode: picking the events that belong to the online
 * window (with the offseason fallback, since events stop for months at a time),
 * and pooling them onto the SAME canonical UIDs the online window uses — a
 * rebaked event keys a card by its event-date print, and an unmapped join turns
 * a widely played card into a phantom 0%.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  eventFieldLabel,
  eventsInWindow,
  poolEventField,
  selectFieldEvents
} from '../../src/pages/socialGraphics/eventField.ts';
import type { MasterPayload } from '../../src/lib/data/reports.ts';
import type { SynonymDatabase } from '../../shared/data/cardIdentity.ts';

const WORLDS = '2026-08-28, World Championship San Francisco';
const NEW_ORLEANS = '2026-06-12, International Championship New Orleans';
const TURIN = '2026-06-06, Special Event Turin';
const LIST = [WORLDS, NEW_ORLEANS, TURIN, 'Online - Last 14 Days', 'Some Cup With No Date'];

function win(start: string, end: string): [Date, Date] {
  return [new Date(start), new Date(end)];
}

function master(rows: [uid: string, found: number][], deckTotal: number): MasterPayload {
  return {
    deckTotal,
    items: rows.map(([uid, found], idx) => {
      const [name, set, number] = uid.split('::');
      return { rank: idx + 1, name, set, number, uid, found, total: deckTotal, pct: (found / deckTotal) * 100 };
    })
  } as MasterPayload;
}

// ---------------------------------------------------------------------------
// Which events the field pools
// ---------------------------------------------------------------------------

test('the window keeps the events inside it, most recent first', () => {
  const [start, end] = win('2026-06-01', '2026-06-30');
  assert.deepEqual(eventsInWindow(LIST, start, end), [NEW_ORLEANS, TURIN]);
});

test('the window ignores the online report and anything it cannot date', () => {
  const [start, end] = win('2020-01-01', '2030-01-01');
  assert.deepEqual(eventsInWindow(LIST, start, end), [WORLDS, NEW_ORLEANS, TURIN]);
});

test('an empty window falls back to the most recent event, and says so', () => {
  // Events cluster on weekends and then stop: nothing was played between
  // June 12 and August 28 this year, which is most of the offseason.
  const [start, end] = win('2026-07-10', '2026-07-24');
  assert.deepEqual(selectFieldEvents(LIST, start, end), { events: [WORLDS], fellBack: true });
});

test('a populated window is used as-is', () => {
  const [start, end] = win('2026-08-18', '2026-09-01');
  assert.deepEqual(selectFieldEvents(LIST, start, end), { events: [WORLDS], fellBack: false });
});

test('a list with no dated events yields no field rather than a fallback', () => {
  const [start, end] = win('2026-08-18', '2026-09-01');
  assert.deepEqual(selectFieldEvents(['Online - Last 14 Days'], start, end), { events: [], fellBack: false });
});

// ---------------------------------------------------------------------------
// Pooling
// ---------------------------------------------------------------------------

test('pooling sums decks and card counts across every event', () => {
  const field = poolEventField(
    [WORLDS, NEW_ORLEANS],
    [master([['Switch::MEG::130', 100]], 800), master([['Switch::MEG::130', 60]], 400)],
    null,
    false
  );
  assert.equal(field.deckTotal, 1200);
  assert.equal(field.found.get('Switch::MEG::130'), 160);
  assert.deepEqual(field.events, [WORLDS, NEW_ORLEANS]);
});

test("pooling re-keys an event's own canonical print onto today's", () => {
  // Worlds keys Dudunsparce as TEF 129 (the canonical print as of its own
  // date); the online window keys it as PRE 080. Left unmapped, a card in a
  // fifth of both fields reads as never played at the event.
  const db = { synonyms: { 'Dudunsparce::TEF::129': 'Dudunsparce::PRE::080' }, canonicals: {} } as SynonymDatabase;
  const field = poolEventField([WORLDS], [master([['Dudunsparce::TEF::129', 159]], 797)], db, false);
  assert.equal(field.found.get('Dudunsparce::PRE::080'), 159);
  assert.equal(field.found.has('Dudunsparce::TEF::129'), false);
});

test('pooling records which sets those events actually saw', () => {
  const field = poolEventField(
    [WORLDS],
    [
      master(
        [
          ['Switch::MEG::130', 100],
          ['Boss::DRI::176', 50]
        ],
        800
      )
    ],
    null,
    false
  );
  assert.deepEqual([...field.sets].sort(), ['DRI', 'MEG']);
});

test('an event whose master failed to load drops out of the pool entirely', () => {
  const field = poolEventField([WORLDS, NEW_ORLEANS], [master([['Switch::MEG::130', 100]], 800), null], null, false);
  assert.equal(field.deckTotal, 800);
  assert.deepEqual(field.events, [WORLDS]);
});

// ---------------------------------------------------------------------------
// Labeling
// ---------------------------------------------------------------------------

test('one event is named, several are counted', () => {
  const one = poolEventField([WORLDS], [master([], 800)], null, false);
  assert.equal(eventFieldLabel(one), 'World Championship San Francisco');
  const many = poolEventField([WORLDS, NEW_ORLEANS], [master([], 800), master([], 400)], null, false);
  assert.equal(eventFieldLabel(many), '2 events');
});
