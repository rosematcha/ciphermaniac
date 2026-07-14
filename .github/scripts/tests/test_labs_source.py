import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


def _load_labs_source():
    path = Path(__file__).resolve().parents[1] / "lib" / "labs_source.py"
    spec = importlib.util.spec_from_file_location("labs_source", path)
    if not spec or not spec.loader:
        raise RuntimeError("cannot load labs_source")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


labs_source = _load_labs_source()
REPO_ROOT = Path(__file__).resolve().parents[3]


def _metadata():
    return {
        "name": "Test Regional",
        "startDate": "2026-07-01",
        "date": "July 1, 2026",
        "players": 2,
        "division": "MA",
        "fetchedAt": "2026-07-13T00:00:00.000Z",
        "tournamentId": 555,
        "country": "US",
        "city": "Dallas",
        "type": "regional",
        "updatedAt": "2026-07-02T00:00:00Z",
        "completed": 1,
        "started": 1,
        "playersRound1": 2,
        "decklists": 2,
        "rk9Id": None,
        "playlatamId": None,
    }


def _participants():
    return [
        {
            "tpId": 1, "playerId": "p-a", "name": "Alice", "country": "US", "placement": 1,
            "points": 9, "wins": 3, "losses": 0, "ties": 0, "opw": 0.6, "oopw": 0.55,
            "madePhase2": True, "madeTopCut": True, "decklistPublished": True,
            "deckId": "labs-deck-1", "deckName": "Gardevoir ex", "icons": ["gardevoir"],
            "dropRound": None, "dropped": False, "dqed": False, "late": False,
        },
        {
            "tpId": 2, "playerId": "p-b", "name": "Bob", "country": "CA", "placement": 2,
            "points": 6, "wins": 2, "losses": 1, "ties": 0, "opw": 0.5, "oopw": 0.48,
            "madePhase2": True, "madeTopCut": False, "decklistPublished": True,
            "deckId": "labs-deck-2", "deckName": "Charizard Pidgeot", "icons": [],
            "dropRound": None, "dropped": False, "dqed": False, "late": False,
        },
    ]


def _decklists():
    return {
        1: [{"name": "Gardevoir ex", "set": "SVI", "number": "086", "count": 4, "category": "pokemon"}],
        2: [{"name": "Charizard ex", "set": "OBF", "number": "125", "count": 3, "category": "pokemon"}],
    }


def _matches():
    return [
        {"round": 1, "phase": 1, "table": 1, "completed": 1, "p1_id": 1, "p2_id": 2, "winner": 1},
        {"round": 2, "phase": 2, "table": None, "completed": 1, "p1_id": 1, "p2_id": None, "winner": 1},
    ]


class BuildLabsSourceTest(unittest.TestCase):
    def test_shapes_standings_decklists_and_matches(self):
        event = labs_source.build_labs_source_event("0555", _metadata(), _participants(), _decklists(), _matches())
        self.assertEqual(event["labsCode"], "0555")
        self.assertEqual(len(event["standings"]), 2)
        self.assertEqual(event["standings"][0]["labsDeckId"], "labs-deck-1")
        self.assertEqual(event["meta"]["sourceTournamentId"], "555")
        self.assertTrue(event["meta"]["hasDay2"])
        self.assertIn("1", event["decklists"])
        # bye match (solo, no p2) is retained; unusable rows dropped
        self.assertEqual(len(event["matches"]), 2)
        self.assertIsNone(event["matches"][1]["p2Id"])

    def test_drops_matches_without_round_or_p1(self):
        bad = [{"round": None, "p1_id": 1}, {"round": 1, "p1_id": None}, {"round": 1, "p1_id": 5, "p2_id": 6, "winner": 5}]
        event = labs_source.build_labs_source_event("0555", _metadata(), _participants(), {}, bad)
        self.assertEqual(len(event["matches"]), 1)


class SourceValidatesThroughTsAdapterTest(unittest.TestCase):
    """The emitted source must validate through the real TS adapter + contract."""

    def test_roundtrip_through_event_cli(self):
        if subprocess.run(["npx", "--no-install", "tsx", "--version"], cwd=REPO_ROOT,
                          capture_output=True).returncode != 0:
            self.skipTest("tsx not available")
        event = labs_source.build_labs_source_event("0555", _metadata(), _participants(), _decklists(), _matches())
        with tempfile.TemporaryDirectory() as tmp:
            src_path = Path(tmp) / "source.json"
            out_dir = Path(tmp) / "out"
            src_path.write_text(json.dumps(event))
            result = subprocess.run(
                ["npx", "--no-install", "tsx", ".github/scripts/event-cli.ts", "build",
                 "--from", "labs-source", "--input", str(src_path), "--out-dir", str(out_dir)],
                cwd=REPO_ROOT, capture_output=True, text=True,
            )
            self.assertEqual(result.returncode, 0, f"event-cli failed: {result.stderr}")
            self.assertTrue((out_dir / "master.json").exists())
            self.assertTrue((out_dir / "matches.json").exists())


if __name__ == "__main__":
    unittest.main()
