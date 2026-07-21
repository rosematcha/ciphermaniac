import importlib.util
import json
import unittest
from datetime import date, timedelta
from pathlib import Path


def _load_update_prices_module():
    script_path = Path(__file__).resolve().parents[1] / "update-prices.py"
    spec = importlib.util.spec_from_file_location("update_prices", script_path)
    if not spec or not spec.loader:
        raise RuntimeError(f"Unable to load update-prices module from {script_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


update_prices = _load_update_prices_module()


def _product(product_id, name, number, **extra):
    ext = [{"name": "Number", "value": number}] if number is not None else []
    return {"productId": product_id, "name": name, "extendedData": ext, **extra}


def _price(product_id, subtype, market):
    return {"productId": product_id, "subTypeName": subtype, "marketPrice": market}


class SelectMarketPriceTest(unittest.TestCase):
    def test_prefers_normal_over_reverse_holo(self):
        # Crispin SCR 133: the reverse holo must not win just because it
        # appears later in the feed.
        variants = [
            _price(567390, "Reverse Holofoil", 1.08),
            _price(567390, "Normal", 0.23),
        ]
        self.assertEqual(
            update_prices.select_market_price(variants), (0.23, "Normal")
        )

    def test_holo_only_cards_use_holofoil(self):
        variants = [_price(1, "Holofoil", 10.11)]
        self.assertEqual(
            update_prices.select_market_price(variants), (10.11, "Holofoil")
        )

    def test_skips_unpriced_preferred_variant(self):
        # A Normal row with no market price must not shadow a priced holo.
        variants = [
            _price(1, "Normal", None),
            _price(1, "Holofoil", 2.5),
        ]
        self.assertEqual(
            update_prices.select_market_price(variants), (2.5, "Holofoil")
        )

    def test_falls_back_to_any_positive_price(self):
        variants = [
            _price(1, "Normal", None),
            _price(1, "Reverse Holofoil", 0.4),
        ]
        self.assertEqual(
            update_prices.select_market_price(variants), (0.4, "Reverse Holofoil")
        )

    def test_returns_none_when_nothing_priced(self):
        variants = [_price(1, "Normal", None), _price(1, "Reverse Holofoil", "")]
        self.assertIsNone(update_prices.select_market_price(variants))
        self.assertIsNone(update_prices.select_market_price([]))


class ParseProductTest(unittest.TestCase):
    def test_parses_name_number_suffix(self):
        parsed = update_prices.parse_product(
            _product(567390, "Crispin - 133/142", "133/142")
        )
        self.assertEqual(parsed, (567390, "Crispin", "133"))

    def test_pads_number_to_three_digits(self):
        parsed = update_prices.parse_product(_product(1, "Pikachu - 5/102", "5/102"))
        self.assertEqual(parsed, (1, "Pikachu", "005"))

    def test_keeps_non_numeric_numbers(self):
        parsed = update_prices.parse_product(
            _product(2, "Gardevoir - TG05/TG30", "TG05/TG30")
        )
        self.assertEqual(parsed, (2, "Gardevoir", "TG05"))

    def test_rejects_products_without_number(self):
        # Sealed product (booster boxes etc.) has no Number in extendedData.
        self.assertIsNone(
            update_prices.parse_product(_product(3, "Stellar Crown Booster Box", None))
        )


class ExtractSetPricesTest(unittest.TestCase):
    def test_joins_products_and_prices_by_preference(self):
        products = [_product(567390, "Crispin - 133/142", "133/142")]
        price_records = [
            _price(567390, "Normal", 0.23),
            _price(567390, "Reverse Holofoil", 1.08),
        ]
        out = update_prices.extract_set_prices(
            products, price_records, "SCR", ["Crispin::SCR::133"]
        )
        self.assertEqual(
            out, {"Crispin::SCR::133": {"price": 0.23, "tcgPlayerId": "567390"}}
        )

    def test_fuzzy_matches_accents_and_brackets(self):
        products = [_product(10, "Boss's Orders (Ghetsis) - 172/193", "172/193")]
        # UID side carries bracketed disambiguation; product side may not match
        # exactly, so the normalized name::number lookup has to bridge it.
        uid = "Boss's Orders [Ghetsis]::PAL::172"
        price_records = [_price(10, "Normal", 1.5)]
        products[0]["name"] = "Boss's Orders [Ghetsis] - 172/193"
        out = update_prices.extract_set_prices(products, price_records, "PAL", [uid])
        self.assertEqual(out[uid]["price"], 1.5)

    def test_unpriced_products_are_omitted(self):
        products = [_product(11, "Snorlax - 51/68", "51/68")]
        out = update_prices.extract_set_prices(
            products, [_price(11, "Normal", None)], "SET", ["Snorlax::SET::051"]
        )
        self.assertEqual(out, {})

    def test_first_priced_product_wins_for_duplicate_uid(self):
        products = [
            _product(20, "Pikachu - 25/100", "25/100"),
            _product(21, "Pikachu - 25/100", "25/100"),
        ]
        price_records = [_price(20, "Normal", 0.5), _price(21, "Normal", 9.9)]
        out = update_prices.extract_set_prices(
            products, price_records, "SET", ["Pikachu::SET::025"]
        )
        self.assertEqual(
            out["Pikachu::SET::025"], {"price": 0.5, "tcgPlayerId": "20"}
        )


class UpdatePriceHistoryTest(unittest.TestCase):
    def test_seeds_empty_history(self):
        out = update_prices.update_price_history(
            {}, {"A::SET::001": {"price": 5.0}}, date(2026, 7, 7)
        )
        self.assertEqual(out, {"A::SET::001": [{"d": "2026-07-07", "p": 5.0}]})

    def test_appends_only_when_price_moves(self):
        existing = {"A::SET::001": [{"d": "2026-07-06", "p": 5.0}]}
        # Same price -> no new point (flat run collapses).
        flat = update_prices.update_price_history(
            existing, {"A::SET::001": {"price": 5.0}}, date(2026, 7, 7)
        )
        self.assertEqual(flat["A::SET::001"], [{"d": "2026-07-06", "p": 5.0}])
        # Changed price -> appended.
        moved = update_prices.update_price_history(
            existing, {"A::SET::001": {"price": 6.5}}, date(2026, 7, 7)
        )
        self.assertEqual(
            moved["A::SET::001"],
            [{"d": "2026-07-06", "p": 5.0}, {"d": "2026-07-07", "p": 6.5}],
        )

    def test_same_day_rerun_is_idempotent(self):
        existing = {"A::SET::001": [{"d": "2026-07-07", "p": 5.0}]}
        out = update_prices.update_price_history(
            existing, {"A::SET::001": {"price": 6.0}}, date(2026, 7, 7)
        )
        # The stale same-day point is replaced, not duplicated.
        self.assertEqual(out["A::SET::001"], [{"d": "2026-07-07", "p": 6.0}])

    def test_trims_points_outside_window(self):
        today = date(2026, 7, 7)
        old = (today - timedelta(days=200)).isoformat()
        recent = (today - timedelta(days=10)).isoformat()
        existing = {"A::SET::001": [{"d": old, "p": 1.0}, {"d": recent, "p": 4.0}]}
        out = update_prices.update_price_history(
            existing, {"A::SET::001": {"price": 4.0}}, today, window_days=90
        )
        self.assertEqual(out["A::SET::001"], [{"d": recent, "p": 4.0}])

    def test_drops_cards_absent_today(self):
        existing = {"GONE::SET::002": [{"d": "2026-07-06", "p": 9.0}]}
        out = update_prices.update_price_history(
            existing, {"A::SET::001": {"price": 5.0}}, date(2026, 7, 7)
        )
        self.assertNotIn("GONE::SET::002", out)
        self.assertIn("A::SET::001", out)

    def test_skips_unpriced_cards(self):
        out = update_prices.update_price_history(
            {}, {"A::SET::001": {"price": None}, "B::SET::002": {}}, date(2026, 7, 7)
        )
        self.assertEqual(out, {})


class _FakeS3Error(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.response = {"Error": {"Code": code}}


class _FakeBody:
    def __init__(self, payload):
        self._payload = payload

    def read(self):
        return self._payload


class _FakeR2Client:
    def __init__(self, error=None, payload=None):
        self._error = error
        self._payload = payload

    def get_object(self, Bucket, Key):
        if self._error is not None:
            raise self._error
        return {"Body": _FakeBody(self._payload)}


class LoadPriceHistoryTest(unittest.TestCase):
    def test_missing_object_starts_fresh(self):
        client = _FakeR2Client(error=_FakeS3Error("NoSuchKey"))
        self.assertEqual(update_prices.load_price_history(client, "bucket"), {})

    def test_transport_error_aborts_instead_of_starting_fresh(self):
        client = _FakeR2Client(error=ConnectionError("connection reset"))
        with self.assertRaises(update_prices.PriceHistoryReadError):
            update_prices.load_price_history(client, "bucket")

    def test_permission_error_aborts(self):
        client = _FakeR2Client(error=_FakeS3Error("AccessDenied"))
        with self.assertRaises(update_prices.PriceHistoryReadError):
            update_prices.load_price_history(client, "bucket")

    def test_corrupt_json_aborts(self):
        client = _FakeR2Client(payload=b"{not json")
        with self.assertRaises(update_prices.PriceHistoryReadError):
            update_prices.load_price_history(client, "bucket")

    def test_valid_history_loads(self):
        payload = json.dumps(
            {"history": {"A::SET::001": [{"d": "2026-07-06", "p": 1.5}]}}
        ).encode("utf-8")
        client = _FakeR2Client(payload=payload)
        self.assertEqual(
            update_prices.load_price_history(client, "bucket"),
            {"A::SET::001": [{"d": "2026-07-06", "p": 1.5}]},
        )


class ClassifyStandardPrintsTest(unittest.TestCase):
    # Umbreon ex as shipped: the synonyms map's canonical for the cluster is
    # PRE/161, the $1,500 special illustration rare, while the playable print is
    # the cheap sibling. Classifying on "is the canonical" keeps the wrong one.
    SYNONYMS = {
        "synonyms": {
            "Umbreon ex::PRE::060": "Umbreon ex::PRE::161",
            "Umbreon ex::SVP::176": "Umbreon ex::PRE::161",
        },
        "canonicals": {"Umbreon ex": "Umbreon ex::PRE::161"},
    }

    def test_collector_print_is_excluded_even_when_canonical(self):
        prices = {
            "Umbreon ex::PRE::161": {"price": 1503.91},
            "Umbreon ex::PRE::060": {"price": 7.81},
            "Umbreon ex::SVP::176": {"price": 12.0},
        }
        standard = update_prices.classify_standard_prints(prices, self.SYNONYMS)
        self.assertNotIn("Umbreon ex::PRE::161", standard)
        self.assertIn("Umbreon ex::PRE::060", standard)

    def test_single_print_cards_are_standard(self):
        prices = {"Hero's Cape::TEF::152": {"price": 16.76}}
        self.assertIn(
            "Hero's Cape::TEF::152",
            update_prices.classify_standard_prints(prices, self.SYNONYMS),
        )

    def test_absolute_slack_keeps_penny_reprints_together(self):
        synonyms = {"synonyms": {"Bulbasaur::MEG::133": "Bulbasaur::MEG::001"}, "canonicals": {}}
        prices = {
            "Bulbasaur::MEG::001": {"price": 0.22},
            "Bulbasaur::MEG::133": {"price": 0.60},
        }
        self.assertIn(
            "Bulbasaur::MEG::133",
            update_prices.classify_standard_prints(prices, synonyms),
        )


class BuildPriceMoversTest(unittest.TestCase):
    TODAY = date(2026, 7, 20)

    def test_baseline_carries_forward_from_before_the_cutoff(self):
        # Flat runs collapse to one point when written, so the price entering the
        # window is the last observation at or before the cutoff (July 13).
        history = {
            "Blastoise ex::SCR::030": [
                {"d": "2026-07-02", "p": 2.51},
                {"d": "2026-07-19", "p": 3.23},
            ]
        }
        movers = update_prices.build_price_movers(history, set(), self.TODAY)
        row = movers["all"]["pct"]["rising"][0]
        self.assertEqual((row["start"], row["current"], row["delta"]), (2.51, 3.23, 0.72))
        self.assertEqual(row["pct"], 28.7)
        self.assertEqual((row["name"], row["set"], row["number"]), ("Blastoise ex", "SCR", "030"))

    def test_movement_older_than_the_window_is_excluded(self):
        history = {
            "Old::SVI::001": [
                {"d": "2026-06-01", "p": 2.0},
                {"d": "2026-06-05", "p": 20.0},
            ]
        }
        movers = update_prices.build_price_movers(history, set(), self.TODAY)
        self.assertEqual(movers["all"]["pct"]["rising"], [])
        self.assertEqual(movers["all"]["value"]["rising"], [])

    def test_percent_and_value_rank_differently(self):
        # The cheap card wins on percent; the expensive card wins on raw dollars.
        history = {
            "Cheap::SVI::001": [{"d": "2026-07-01", "p": 2.51}, {"d": "2026-07-19", "p": 3.23}],
            "Pricey::SVI::002": [{"d": "2026-07-01", "p": 22.54}, {"d": "2026-07-19", "p": 25.0}],
        }
        movers = update_prices.build_price_movers(history, set(), self.TODAY)
        self.assertEqual([r["name"] for r in movers["all"]["pct"]["rising"]], ["Cheap", "Pricey"])
        self.assertEqual([r["name"] for r in movers["all"]["value"]["rising"]], ["Pricey", "Cheap"])

    def test_percent_gate_drops_penny_moves_and_cheap_cards(self):
        history = {
            "Penny::SVI::001": [{"d": "2026-07-01", "p": 0.10}, {"d": "2026-07-19", "p": 0.90}],
            "Flat::SVI::002": [{"d": "2026-07-01", "p": 10.0}, {"d": "2026-07-19", "p": 10.30}],
            "Tiny::SVI::003": [{"d": "2026-07-01", "p": 1.00}, {"d": "2026-07-19", "p": 1.09}],
        }
        movers = update_prices.build_price_movers(history, set(), self.TODAY)
        self.assertEqual(movers["all"]["pct"]["rising"], [])

    def test_value_gate_drops_sub_quarter_moves(self):
        # A 10% move on a cheap card clears the percent gate but not the $0.25
        # value floor, so it appears by percent and not by value.
        history = {
            "Small::SVI::001": [{"d": "2026-07-01", "p": 1.50}, {"d": "2026-07-19", "p": 1.65}],
        }
        movers = update_prices.build_price_movers(history, set(), self.TODAY)
        self.assertEqual([r["number"] for r in movers["all"]["pct"]["rising"]], ["001"])
        self.assertEqual(movers["all"]["value"]["rising"], [])

    def test_standard_scope_is_a_subset(self):
        history = {
            "Card::SVI::001": [{"d": "2026-07-01", "p": 4.0}, {"d": "2026-07-19", "p": 9.0}],
            "Card::SVI::200": [{"d": "2026-07-01", "p": 4.0}, {"d": "2026-07-19", "p": 40.0}],
        }
        movers = update_prices.build_price_movers(history, {"Card::SVI::001"}, self.TODAY)
        self.assertEqual([r["number"] for r in movers["all"]["pct"]["rising"]], ["200", "001"])
        self.assertEqual([r["number"] for r in movers["standard"]["pct"]["rising"]], ["001"])

    def test_lists_are_capped(self):
        history = {
            f"Card::SVI::{i:03d}": [{"d": "2026-07-01", "p": 10.0}, {"d": "2026-07-19", "p": 11.0 + i}]
            for i in range(20)
        }
        movers = update_prices.build_price_movers(history, set(), self.TODAY)
        self.assertEqual(len(movers["all"]["pct"]["rising"]), update_prices.MOVER_LIMIT)
        self.assertEqual(len(movers["all"]["value"]["rising"]), update_prices.MOVER_LIMIT)


class HistoryShardTest(unittest.TestCase):
    def test_splits_by_set_code(self):
        history = {
            "A::SCR::001": [{"d": "2026-07-01", "p": 1.0}],
            "B::SCR::002": [{"d": "2026-07-01", "p": 2.0}],
            "C::TWM::003": [{"d": "2026-07-01", "p": 3.0}],
        }
        shards = update_prices.shard_history_by_set(history)
        self.assertEqual(sorted(shards), ["SCR", "TWM"])
        self.assertEqual(sorted(shards["SCR"]), ["A::SCR::001", "B::SCR::002"])

    def test_span_days_spans_the_whole_corpus(self):
        history = {
            "A::SCR::001": [{"d": "2026-06-01", "p": 1.0}],
            "B::TWM::002": [{"d": "2026-07-11", "p": 2.0}],
        }
        self.assertEqual(update_prices.history_span_days(history), 40)
        self.assertEqual(update_prices.history_span_days({}), 0)


class ResolveGroupIdsTest(unittest.TestCase):
    GROUPS = [
        {"groupId": 100, "abbreviation": "SCR", "name": "Stellar Crown"},
        {"groupId": 200, "abbreviation": "SWSH09", "name": "SWSH09: Brilliant Stars"},
    ]
    NAME_INDEX = {"brilliant stars": "BRS"}

    def test_abbreviation_match_wins(self):
        mappings, unmapped = update_prices.resolve_group_ids(["SCR"], self.GROUPS, self.NAME_INDEX, {})
        self.assertEqual(mappings["SCR"], 100)
        self.assertEqual(unmapped, [])

    def test_catalog_name_fallback_when_abbreviation_differs(self):
        # Our code BRS never matches the group's "SWSH09" abbreviation; the group
        # name tail "Brilliant Stars" bridges it.
        mappings, unmapped = update_prices.resolve_group_ids(["BRS"], self.GROUPS, self.NAME_INDEX, {})
        self.assertEqual(mappings["BRS"], 200)
        self.assertEqual(unmapped, [])

    def test_manual_map_beats_name_fallback(self):
        mappings, _ = update_prices.resolve_group_ids(["BRS"], self.GROUPS, self.NAME_INDEX, {"BRS": 999})
        self.assertEqual(mappings["BRS"], 999)

    def test_unmapped_is_reported_not_fatal(self):
        mappings, unmapped = update_prices.resolve_group_ids(["ZZZ"], self.GROUPS, self.NAME_INDEX, {})
        self.assertEqual(mappings, {})
        self.assertEqual(unmapped, ["ZZZ"])


class BuildPrintUniverseTest(unittest.TestCase):
    def test_includes_aliases_and_canonicals(self):
        universe = update_prices.build_print_universe(
            {
                "synonyms": {"Umbreon ex::PRE::060": "Umbreon ex::PRE::161"},
                "canonicals": {"Pikachu ex": "Pikachu ex::SSP::057"},
            }
        )
        self.assertEqual(
            universe,
            {"Umbreon ex::PRE::060", "Umbreon ex::PRE::161", "Pikachu ex::SSP::057"},
        )

    def test_tolerates_empty_input(self):
        self.assertEqual(update_prices.build_print_universe({}), set())


if __name__ == "__main__":
    unittest.main()
