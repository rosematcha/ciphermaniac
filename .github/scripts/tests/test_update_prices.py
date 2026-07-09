import importlib.util
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


if __name__ == "__main__":
    unittest.main()
