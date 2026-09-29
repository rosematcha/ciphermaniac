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
    def test_picks_the_preferred_priced_variant(self):
        cases = [
            # Crispin SCR 133: the reverse holo must not win just because it
            # appears later in the feed.
            ("normal over reverse holo",
             [_price(567390, "Reverse Holofoil", 1.08), _price(567390, "Normal", 0.23)], (0.23, "Normal")),
            ("holo-only card", [_price(1, "Holofoil", 10.11)], (10.11, "Holofoil")),
            # A Normal row with no market price must not shadow a priced holo.
            ("unpriced preferred variant", [_price(1, "Normal", None), _price(1, "Holofoil", 2.5)], (2.5, "Holofoil")),
            ("any positive price",
             [_price(1, "Normal", None), _price(1, "Reverse Holofoil", 0.4)], (0.4, "Reverse Holofoil")),
            ("nothing priced", [_price(1, "Normal", None), _price(1, "Reverse Holofoil", "")], None),
            ("no variants", [], None),
        ]
        for label, variants, expected in cases:
            with self.subTest(label):
                self.assertEqual(update_prices.select_market_price(variants), expected)


class ParseProductTest(unittest.TestCase):
    def test_splits_the_name_from_its_number(self):
        cases = [
            ("name - number/total", _product(567390, "Crispin - 133/142", "133/142"), (567390, "Crispin", "133")),
            ("pads to three digits", _product(1, "Pikachu - 5/102", "5/102"), (1, "Pikachu", "005")),
            ("non-numeric number", _product(2, "Gardevoir - TG05/TG30", "TG05/TG30"), (2, "Gardevoir", "TG05")),
            # Sealed product (booster boxes etc.) has no Number in extendedData.
            ("sealed product", _product(3, "Stellar Crown Booster Box", None), None),
            # Promo groups name products "CardName - Number" with no "/total".
            ("promo without a total", _product(4, "Pikachu ex - 106", "106"), (4, "Pikachu ex", "106")),
            ("promo with a variant parenthetical",
             _product(5, "Pikachu - 225 (World Championship 2025)", "225"), (5, "Pikachu", "225")),
            ("set-prefixed promo number", _product(6, "Hop's Zacian ex - SVP193", "SVP193"),
             (6, "Hop's Zacian ex", "SVP193")),
            ("dash that is not a number suffix", _product(7, "Ho-Oh - Reshiram", "045"), (7, "Ho-Oh - Reshiram", "045")),
            ("hyphenated name", _product(8, "Porygon-Z - 155/182", "155/182"), (8, "Porygon-Z", "155")),
            ("no space before the number", _product(9, "Charizard ex -196", "196"), (9, "Charizard ex", "196")),
            ("name omits the set prefix the number field carries",
             _product(10, "Espeon ex - 175", "SVP 175"), (10, "Espeon ex", "SVP175")),
        ]
        for label, product, expected in cases:
            with self.subTest(label):
                self.assertEqual(update_prices.parse_product(product), expected)

    def test_strips_a_set_prefix_only_when_it_is_the_set_code(self):
        self.assertEqual(update_prices.strip_set_prefix("SVP193", "SVP"), "193")
        self.assertEqual(update_prices.strip_set_prefix(update_prices.normalize_product_number("SVP 200"), "SVP"), "200")
        # TG05 is the card number, not a set code — never strip it.
        self.assertIsNone(update_prices.strip_set_prefix("TG05", "SCR"))


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

    def test_bridges_naming_differences_between_tcgcsv_and_our_uids(self):
        cases = [
            ("set-prefixed promo number", _product(30, "Hop's Zacian ex - SVP193", "SVP193"),
             "SVP", "Hop's Zacian ex::SVP::193"),
            ("typographic apostrophe", _product(31, "Marnie’s Morpeko", "206"), "SVP", "Marnie's Morpeko::SVP::206"),
            # TCGPlayer names special prints "Name (Full Art)" / "Name (Secret)";
            # our UIDs carry the bare name plus the print's own number.
            ("parenthesized variant suffix", _product(40, "Adaman (Full Art) - 181/189", "181/189"),
             "ASR", "Adaman::ASR::181"),
            ("basic energy prefix", _product(41, "Basic Grass Energy - 001", "001"), "SVE", "Grass Energy::SVE::001"),
            # SWSH promos ("SP" to us) number their cards "SWSH001".."SWSH307".
            ("aliased promo number prefix", _product(42, "Arceus V - SWSH204", "SWSH204"), "SP", "Arceus V::SP::204"),
            # Our UIDs say GG1 where TCGCSV says GG01 (and vice versa for TG05).
            ("unpadded gallery uid", _product(43, "Hisuian Voltorb - GG01/GG70", "GG01/GG70"),
             "CRZ", "Hisuian Voltorb::CRZ::GG1"),
            ("padded gallery uid", _product(44, "Gardevoir - TG5/TG30", "TG5/TG30"), "SIT", "Gardevoir::SIT::TG05"),
        ]
        for label, product, set_code, uid in cases:
            with self.subTest(label):
                out = update_prices.extract_set_prices(
                    [product], [_price(product["productId"], "Holofoil", 2.5)], set_code, [uid]
                )
                self.assertEqual(out.get(uid, {}).get("price"), 2.5)

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

    def test_any_other_failure_aborts_instead_of_starting_fresh(self):
        cases = [
            ("transport", _FakeR2Client(error=ConnectionError("connection reset"))),
            ("permission", _FakeR2Client(error=_FakeS3Error("AccessDenied"))),
            ("corrupt json", _FakeR2Client(payload=b"{not json")),
        ]
        for label, client in cases:
            with self.subTest(label), self.assertRaises(update_prices.PriceHistoryReadError):
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

    def test_unpriced_sibling_falls_back_to_the_scraped_print_price(self):
        # Pikachu ex as shipped: SVP 106 is the cheap playable print but TCGCSV
        # never returned it, so the $1,141 ASC 276 looked like its own cluster's
        # floor and rode into the "standard" movers list.
        synonyms = {
            "synonyms": {"Pikachu ex::SVP::106": "Pikachu ex::ASC::276"},
            "canonicals": {"Pikachu ex": "Pikachu ex::ASC::276"},
            "prints": {"Pikachu ex::SVP::106": 11.92, "Pikachu ex::ASC::276": 1141.18},
        }
        prices = {"Pikachu ex::ASC::276": {"price": 1141.18}}
        standard = update_prices.classify_standard_prints(prices, synonyms)
        self.assertNotIn("Pikachu ex::ASC::276", standard)

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
    NAME_INDEX = update_prices.build_catalog_name_index(
        {"sets": [{"code": "BRS", "name": "Brilliant Stars"}, {"code": "SCR", "name": "Stellar Crown"}]}
    )

    def test_resolves_by_abbreviation_then_manual_map_then_catalog_name(self):
        cases = [
            ("abbreviation match", ["SCR"], {}, {"SCR": 100}, []),
            # Our code BRS never matches the group's "SWSH09" abbreviation; the group
            # name tail "Brilliant Stars" bridges it.
            ("catalog name fallback", ["BRS"], {}, {"BRS": 200}, []),
            ("manual map beats name fallback", ["BRS"], {"BRS": 999}, {"BRS": 999}, []),
            ("unmapped is reported, not fatal", ["ZZZ"], {}, {}, ["ZZZ"]),
        ]
        for label, codes, manual, expected, unmapped in cases:
            with self.subTest(label):
                self.assertEqual(
                    update_prices.resolve_group_ids(codes, self.GROUPS, self.NAME_INDEX, manual), (expected, unmapped)
                )

    def test_shared_abbreviation_prefers_the_group_named_like_the_set(self):
        groups = [
            {"groupId": 24722, "abbreviation": "30C", "name": "ME: 30th Celebration"},
            {"groupId": 24837, "abbreviation": "30C", "name": "ME: 30th Celebration Classic Collection"},
        ]
        mappings, _ = update_prices.resolve_group_ids(["30C"], groups, {"30th celebration": "30C"}, {})
        self.assertEqual(mappings["30C"], 24722)


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
        self.assertEqual(update_prices.build_print_universe({}), set())


class ExpandToClustersTest(unittest.TestCase):
    SYNONYMS = {
        "synonyms": {
            "Iono::PAL::185": "Iono::PAF::237",
            "Iono::PAF::080": "Iono::PAF::237",
        },
        "canonicals": {"Iono": "Iono::PAF::237"},
    }

    def test_any_print_pulls_in_its_whole_cluster(self):
        cluster = {"Iono::PAL::185", "Iono::PAF::080", "Iono::PAF::237"}
        cases = [
            # A 2023 event names PAL/185; the collector prints that make the
            # "All printings" scope interesting are the rest of the cluster.
            ("an archive print", {"Iono::PAL::185"}, cluster),
            ("a canonical", {"Iono::PAF::237"}, cluster),
            ("an unclustered print", {"Hero's Cape::TEF::152"}, {"Hero's Cape::TEF::152"}),
            ("nothing", set(), set()),
        ]
        for label, uids, expected in cases:
            with self.subTest(label):
                self.assertEqual(update_prices.expand_to_clusters(uids, self.SYNONYMS), expected)


class CurrentMetaCanonicalsTest(unittest.TestCase):
    SYNONYMS = {
        "synonyms": {"Iono::PAL::185": "Iono::PAF::237"},
        "canonicals": {"Iono": "Iono::PAF::237"},
    }

    def test_resolves_report_cards_to_their_canonical_print(self):
        report = {"items": [{"uid": "Iono::PAL::185"}]}
        out = update_prices.extract_current_meta_canonicals(report, self.SYNONYMS)
        self.assertIn("Iono::PAF::237", out)
        self.assertNotIn("Iono::PAL::185", out)

    def test_excludes_cards_absent_from_the_current_report(self):
        # The whole point of the narrower set: an archive-only card must not
        # qualify for the "Standard only" scope.
        out = update_prices.extract_current_meta_canonicals({"items": []}, self.SYNONYMS)
        self.assertNotIn("Iono::PAF::237", out)


class _RecordingR2Client:
    """Captures put_object bodies by key."""

    def __init__(self):
        self.puts = {}

    def put_object(self, Bucket=None, Key=None, Body=None, **_kwargs):  # noqa: N803
        self.puts[Key] = Body


class StandardScopeTest(unittest.TestCase):
    HISTORY = {
        # In the current meta, cheap: belongs in both scopes.
        "Iono::PAF::237": [{"d": "2026-07-01", "p": 2.0}, {"d": "2026-07-09", "p": 3.0}],
        # Archive-only card, equally cheap: "all printings" only.
        "Lost Vacuum::CRZ::162": [{"d": "2026-07-01", "p": 1.5}, {"d": "2026-07-09", "p": 2.5}],
    }

    def test_archive_cards_reach_all_printings_but_not_standard_only(self):
        client = _RecordingR2Client()
        price_data = {uid: {"price": pts[-1]["p"]} for uid, pts in self.HISTORY.items()}
        update_prices.upload_derived_artifacts(
            client,
            "bucket",
            self.HISTORY,
            price_data,
            {"synonyms": {}, "canonicals": {}, "prints": {}},
            date(2026, 7, 9),
            {"Iono::PAF::237"},
        )
        movers = json.loads(client.puts[update_prices.PRICE_MOVERS_KEY])["scopes"]
        rising = lambda scope: [r["uid"] for r in movers[scope]["pct"]["rising"]]  # noqa: E731
        self.assertEqual(
            sorted(rising("all")), ["Iono::PAF::237", "Lost Vacuum::CRZ::162"]
        )
        self.assertEqual(rising("standard"), ["Iono::PAF::237"])


if __name__ == "__main__":
    unittest.main()
