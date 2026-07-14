/**
 * Rolling (per-event) canonical resolution.
 *
 * The canonical print for a historical event is chosen with that event's
 * date: the oldest print that was standard-legal and reasonably priced THEN.
 * The synonym DB's flat maps stay the stable cross-event identity — every
 * rolling canonical is itself a variant UID that resolves back to the same
 * global canonical, so usage aggregation never splits when the canonical
 * changes across events. Acceptance cases agreed with Reese (2026-07-14).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildClusterIndex,
  isSetLegalAt,
  resolveCanonicalUidAt,
  SET_CATALOG,
  STANDARD_LEGAL_SETS,
  type SynonymDatabase
} from '../../shared/data/canonicalPrint.ts';

const MEG_UID = "Boss's Orders::MEG::114";

// Boss's Orders cluster as the synonym producer would emit it today: every
// variant maps to the current global canonical (MEG 114), prices alongside.
const DB: SynonymDatabase = {
  synonyms: {
    "Boss's Orders::SP::251": MEG_UID,
    "Boss's Orders::RCL::154": MEG_UID,
    "Boss's Orders::RCL::189": MEG_UID,
    "Boss's Orders::RCL::200": MEG_UID,
    "Boss's Orders::SHF::058": MEG_UID,
    "Boss's Orders::BRS::132": MEG_UID,
    "Boss's Orders::LOR::TG24": MEG_UID,
    "Boss's Orders::PAL::172": MEG_UID,
    "Boss's Orders::PAL::248": MEG_UID,
    "Boss's Orders::PAL::265": MEG_UID,
    "Boss's Orders::ASC::183": MEG_UID,
    "Boss's Orders::ASC::256": MEG_UID
  },
  canonicals: { "Boss's Orders": MEG_UID },
  prints: {
    "Boss's Orders::SP::251": 13.57,
    "Boss's Orders::RCL::154": 1.35,
    "Boss's Orders::RCL::189": 67.04,
    "Boss's Orders::RCL::200": 46.56,
    "Boss's Orders::SHF::058": 0.31,
    "Boss's Orders::BRS::132": 0.44,
    "Boss's Orders::LOR::TG24": 10.96,
    "Boss's Orders::PAL::172": 0.32,
    "Boss's Orders::PAL::248": 11.18,
    "Boss's Orders::PAL::265": 19.95,
    "Boss's Orders::MEG::114": 0.25,
    "Boss's Orders::ASC::183": 0.23,
    "Boss's Orders::ASC::256": 8.05
  }
};

const INDEX = buildClusterIndex(DB);

describe('resolveCanonicalUidAt', () => {
  it("rolls Boss's Orders through three canonicals across the dataset's events", () => {
    const rawUid = "Boss's Orders::PAL::248";
    // Baltimore 2023 → Monterrey 2025 → NAIC 2026.
    assert.equal(resolveCanonicalUidAt(rawUid, DB, INDEX, '2023-07-15'), "Boss's Orders::BRS::132");
    assert.equal(resolveCanonicalUidAt(rawUid, DB, INDEX, '2025-05-17'), "Boss's Orders::PAL::172");
    assert.equal(resolveCanonicalUidAt(rawUid, DB, INDEX, '2026-06-13'), "Boss's Orders::MEG::114");
  });

  it('every rolling canonical resolves back to one stable global identity', () => {
    // Usage stays attached to the card: whatever canonical an event stores,
    // the flat synonym map sends it to the same cluster identity.
    for (const date of ['2023-07-15', '2025-05-17', '2026-06-13']) {
      const rolling = resolveCanonicalUidAt("Boss's Orders::RCL::154", DB, INDEX, date);
      assert.equal(DB.synonyms[rolling] ?? rolling, MEG_UID);
    }
  });

  it('resolves any cluster member to the same rolling canonical', () => {
    const members = [...(INDEX.get(MEG_UID) ?? [])];
    assert.equal(members.length, 13);
    const resolved = new Set(members.map(uid => resolveCanonicalUidAt(uid, DB, INDEX, '2025-05-17')));
    assert.deepEqual([...resolved], ["Boss's Orders::PAL::172"]);
  });

  it('resolves a name-only identifier through canonicals first', () => {
    assert.equal(resolveCanonicalUidAt("Boss's Orders", DB, INDEX, '2023-07-15'), "Boss's Orders::BRS::132");
  });

  it('passes unknown UIDs through unchanged', () => {
    assert.equal(resolveCanonicalUidAt('Nonexistent::XXX::001', DB, INDEX, '2025-05-17'), 'Nonexistent::XXX::001');
  });
});

describe('set catalog legality windows', () => {
  // Pinned to the date the windows were authored. When a rotation or set
  // release updates standardLegalSets, the windows must move with it (and
  // this pin date advances) — the two views of legality may never diverge.
  const PINNED_TODAY = '2026-07-14';

  it('derive standardLegalSets exactly', () => {
    const derived = SET_CATALOG.filter(entry => isSetLegalAt(entry.code, PINNED_TODAY)).map(entry => entry.code);
    assert.deepEqual(new Set(derived), STANDARD_LEGAL_SETS);
  });

  it('windows are well-formed', () => {
    for (const entry of SET_CATALOG) {
      if (entry.legalFrom === undefined) {
        assert.equal(entry.legalUntil, undefined, `${entry.code} has legalUntil without legalFrom`);
        continue;
      }
      assert.match(entry.legalFrom, /^\d{4}-\d{2}-\d{2}$/, `${entry.code} legalFrom`);
      if (entry.legalUntil != null) {
        assert.match(entry.legalUntil, /^\d{4}-\d{2}-\d{2}$/, `${entry.code} legalUntil`);
        assert.ok(entry.legalFrom < entry.legalUntil, `${entry.code} window is inverted`);
      }
    }
  });
});
