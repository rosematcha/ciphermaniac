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


backfill = _load("backfill_worlds_decks", "backfill-worlds-decks.py")


def _deck(player_id, placement, archetype="Dragapult"):
    return {
        "playerId": str(player_id),
        "placement": placement,
        "archetype": archetype,
        "deckId": "dragapult-ex",
        "player": f"Player {player_id}",
        "cards": [{"count": 60, "name": "Dreepy", "set": "ASC", "number": "158"}],
    }


def _player(tp_id, placement):
    return {"tpId": tp_id, "placement": placement, "decklistPublished": False, "deckName": None}


class PayloadTest(unittest.TestCase):
    def test_committed_payload_is_23_complete_60_card_decks(self):
        payload = backfill.load_payload()
        self.assertEqual(len(payload["decks"]), 23)
        self.assertEqual(payload["event"], "2026-08-28, World Championship San Francisco")
        for deck in payload["decks"]:
            self.assertEqual(sum(c["count"] for c in deck["cards"]), 60, deck["playerId"])
            self.assertTrue(deck["archetype"])
            self.assertEqual(deck["deckSource"], "rk9")

    def test_every_payload_deck_cites_its_rk9_source(self):
        payload = backfill.load_payload()
        for deck in payload["decks"]:
            self.assertIn(deck["playerId"], payload["sources"])


class PreconditionTest(unittest.TestCase):
    def setUp(self):
        self.decks = [_deck(i, i) for i in range(1, backfill.EXPECTED_EXISTING_DECKS + 1)]
        self.players = [_player(i, i) for i in range(1, backfill.EXPECTED_PLAYERS + 1)]
        self.incoming = [_deck(900 + i, 800 + i) for i in range(3)]
        # The synthetic incoming players must exist in the standings.
        for i in range(3):
            self.players[i] = _player(900 + i, 800 + i)

    def test_accepts_the_expected_pre_state(self):
        backfill.check_preconditions(self.decks, self.players, self.incoming)

    def test_refuses_when_the_backfill_already_ran(self):
        # Re-merging would double-count every incoming deck.
        already = self.decks + self.incoming
        with self.assertRaises(SystemExit) as ctx:
            backfill.check_preconditions(already, self.players, self.incoming)
        self.assertIn("expected 774", str(ctx.exception))

    def test_refuses_when_a_player_already_has_a_deck(self):
        decks = self.decks[:-1] + [_deck(900, 800)]
        with self.assertRaises(SystemExit) as ctx:
            backfill.check_preconditions(decks, self.players, self.incoming)
        self.assertIn("already have a deck", str(ctx.exception))

    def test_refuses_a_deck_for_someone_not_in_the_standings(self):
        incoming = self.incoming + [_deck(5000, 999)]
        with self.assertRaises(SystemExit) as ctx:
            backfill.check_preconditions(self.decks, self.players, incoming)
        self.assertIn("not in the standings", str(ctx.exception))


class MergeTest(unittest.TestCase):
    def test_merge_adds_decks_and_marks_only_the_backfilled_players(self):
        decks = [_deck(1, 1)]
        players = [_player(1, 1), _player(900, 800)]
        incoming = [_deck(900, 800, archetype="Basic Box")]
        merged, updated, touched = backfill.merge(decks, players, incoming)

        self.assertEqual(len(merged), 2)
        self.assertEqual(touched, 1)
        self.assertEqual([d["placement"] for d in merged], [1, 800])

        backfilled = next(p for p in updated if p["tpId"] == 900)
        self.assertTrue(backfilled["decklistPublished"])
        self.assertEqual(backfilled["deckName"], "Basic Box")

        untouched = next(p for p in updated if p["tpId"] == 1)
        self.assertFalse(untouched["decklistPublished"])

    def test_decks_without_a_placement_sort_last_rather_than_crashing(self):
        merged, _, _ = backfill.merge([_deck(1, None)], [_player(1, None)], [_deck(2, 5)])
        self.assertEqual([d["playerId"] for d in merged], ["2", "1"])


if __name__ == "__main__":
    unittest.main()
