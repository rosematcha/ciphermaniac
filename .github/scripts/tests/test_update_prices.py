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
