import importlib.util
import json
import unittest
from pathlib import Path


def _load(name, filename):
    path = Path(__file__).resolve().parents[1] / filename
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


reprocess = _load("reprocess_event_indexes", "reprocess-event-indexes.py")


class _FakeClient:
    """Minimal S3/R2 stand-in backed by an in-memory {key: json-string} store."""

    def __init__(self, objects):
        self._objects = dict(objects)
        self.puts = {}
        self.deleted = []

    def get_object(self, Bucket, Key):
        if Key not in self._objects:
            from botocore.exceptions import ClientError

            raise ClientError({"Error": {"Code": "NoSuchKey"}}, "GetObject")
        body = self._objects[Key]

        class _Body:
            def read(self_inner):
                return body.encode("utf-8")

        return {"Body": _Body()}

    def put_object(self, Bucket, Key, Body, **kwargs):
        self._objects[Key] = Body
        self.puts[Key] = json.loads(Body)

    def delete_object(self, Bucket, Key):
        self._objects.pop(Key, None)
        self.deleted.append(Key)

    def list_objects_v2(self, Bucket, Prefix, Delimiter, ContinuationToken=None):
        prefixes = set()
        for key in self._objects:
            if not key.startswith(Prefix):
                continue
            rest = key[len(Prefix):]
            if Delimiter in rest:
                prefixes.add(Prefix + rest.split(Delimiter, 1)[0] + Delimiter)
        return {"IsTruncated": False, "CommonPrefixes": [{"Prefix": p} for p in sorted(prefixes)]}


def _decks():
    # Two decks; one made Day 2. Both play Dreepy, but under different raw prints.
    return [
        {"madePhase2": True, "cards": [{"name": "Dreepy", "set": "PRE", "number": "071", "count": 2}]},
        {"madePhase2": False, "cards": [{"name": "Dreepy", "set": "ASC", "number": "158", "count": 2}]},
    ]


def _cards_json():
    # A per-archetype cards.json as download-tournament writes it: raw prints,
    # two separate items for the two Dreepy printings.
    return {
        "deckTotal": 2,
        "items": [
            {"uid": "Dreepy::PRE::071", "name": "Dreepy", "found": 1,
             "dist": [{"copies": 2, "players": 1}]},
            {"uid": "Dreepy::ASC::158", "name": "Dreepy", "found": 1,
             "dist": [{"copies": 2, "players": 1}]},
        ],
    }


class ReprocessEventTests(unittest.TestCase):
    def _store(self):
        folder = "2026-01-01, Test Event"
        base = f"reports/{folder}"
        return folder, {
            f"{base}/decks.json": json.dumps(_decks()),
            f"{base}/archetypes/Dragapult/cards.json": json.dumps(_cards_json()),
            # Stale indexes keyed to an OLD canonical that no longer applies.
            f"{base}/cardUsage.json": json.dumps({"usage": {"Dreepy::PRE::071": []}}),
            f"{base}/conversion.json": json.dumps(
                {"day1Total": 2, "day2Total": 1, "cards": {"Dreepy::PRE::071": {"day1": 2, "day2": 1}}}
            ),
        }

    # New synonyms collapse both Dreepy printings onto TWM::128.
    SYNONYMS = {"Dreepy::PRE::071": "Dreepy::TWM::128", "Dreepy::ASC::158": "Dreepy::TWM::128"}
    CANONICALS = {"Dreepy": "Dreepy::TWM::128"}

    def test_rebakes_both_indexes_to_new_canonical(self):
        folder, store = self._store()
        client = _FakeClient(store)
        summary = reprocess.reprocess_event(client, "b", folder, self.SYNONYMS, self.CANONICALS)

        base = f"reports/{folder}"
        usage = client.puts[f"{base}/cardUsage.json"]["usage"]
        conv = client.puts[f"{base}/conversion.json"]["cards"]

        # Both raw printings merged onto the new canonical, old key gone.
        self.assertIn("Dreepy::TWM::128", usage)
        self.assertNotIn("Dreepy::PRE::071", usage)
        self.assertEqual(usage["Dreepy::TWM::128"][0]["found"], 2)  # merged 1 + 1

        self.assertIn("Dreepy::TWM::128", conv)
        self.assertNotIn("Dreepy::PRE::071", conv)
        # Deck 1 (Day 2) played PRE, deck 2 (Day 1) played ASC — both count once.
        self.assertEqual(conv["Dreepy::TWM::128"], {"day1": 2, "day2": 1})
        self.assertEqual(summary["errors"], [])

    def test_dry_run_writes_nothing(self):
        folder, store = self._store()
        client = _FakeClient(store)
        reprocess.reprocess_event(client, "b", folder, self.SYNONYMS, self.CANONICALS, dry_run=True)
        self.assertEqual(client.puts, {})

    def test_stale_conversion_deleted_when_cut_disappears(self):
        # Event previously had a Day 2 cut (old conversion.json exists) but the
        # corrected decks have none → the stale index must be deleted (P-08).
        folder = "2026-01-01, Test Event"
        base = f"reports/{folder}"
        store = {
            f"{base}/decks.json": json.dumps(
                [{"madePhase2": False, "cards": [{"name": "Dreepy", "set": "PRE", "number": "071", "count": 2}]}]
            ),
            f"{base}/archetypes/Dragapult/cards.json": json.dumps(_cards_json()),
            f"{base}/conversion.json": json.dumps(
                {"day1Total": 2, "day2Total": 1, "cards": {"Dreepy::PRE::071": {"day1": 2, "day2": 1}}}
            ),
        }
        client = _FakeClient(store)
        summary = reprocess.reprocess_event(client, "b", folder, self.SYNONYMS, self.CANONICALS)
        self.assertIn(f"{base}/conversion.json", client.deleted)
        self.assertEqual(summary["conversion"], {"deleted": "no Day 2 cut"})

    def test_absent_conversion_not_deleted_when_no_cut(self):
        # No prior conversion.json and no cut → nothing to delete, no error.
        folder = "2026-01-02, No Cut Event"
        base = f"reports/{folder}"
        store = {
            f"{base}/decks.json": json.dumps(
                [{"madePhase2": False, "cards": [{"name": "Dreepy", "set": "PRE", "number": "071", "count": 2}]}]
            ),
            f"{base}/archetypes/Dragapult/cards.json": json.dumps(_cards_json()),
        }
        client = _FakeClient(store)
        summary = reprocess.reprocess_event(client, "b", folder, self.SYNONYMS, self.CANONICALS)
        self.assertEqual(client.deleted, [])
        self.assertEqual(summary["conversion"], {"skipped": "no Day 2 cut"})

    def test_missing_data_is_reported_not_raised(self):
        folder = "empty"
        client = _FakeClient({})
        summary = reprocess.reprocess_event(client, "b", folder, self.SYNONYMS, self.CANONICALS)
        self.assertIn("no archetype cards.json found", summary["errors"])
        self.assertIn("no decks.json found", summary["errors"])


if __name__ == "__main__":
    unittest.main()
