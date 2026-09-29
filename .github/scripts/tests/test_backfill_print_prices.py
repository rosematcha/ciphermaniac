"""Unit tests for backfill-print-prices' pure helpers (no network/credentials).

Covers the decision points a bad backfill would corrupt silently: which dates
to process, which prints make up the universe, and the artifact shape. Set-code
to TCGCSV-group resolution is update-prices' resolve_group_ids, tested there.
"""

import importlib.util
import unittest
from datetime import datetime, timezone
from pathlib import Path


def _load_module():
    script_path = Path(__file__).resolve().parents[1] / "backfill-print-prices.py"
    spec = importlib.util.spec_from_file_location("backfill_print_prices", script_path)
    if not spec or not spec.loader:
        raise RuntimeError(f"Unable to load module from {script_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


bpp = _load_module()


class ExtractEventDatesTest(unittest.TestCase):
    def test_reads_sorted_unique_dates_and_splits_off_pre_archive_ones(self):
        cases = [
            (
                "strings, dicts and undated entries",
                [
                    "2025-09-13, Regional Championship Monterrey",
                    {"folder": "2025-05-17, Some Regional"},
                    {"name": "2025-05-17, Duplicate Date Event"},  # dedupes with above
                    {"path": "2024-06-01, Path-keyed Event"},
                    "No date at the front of this one",
                    {"folder": "malformed"},
                    42,  # non-string/dict entry is ignored
                ],
                ["2024-06-01", "2025-05-17", "2025-09-13"],
                [],
            ),
            (
                "pre-archive floor",
                [
                    "2024-02-07, One day before the floor",
                    "2024-02-08, On the floor (kept)",
                    "2023-11-01, Well before",
                ],
                ["2024-02-08"],
                ["2023-11-01", "2024-02-07"],
            ),
            ("wrapped object form", {"tournaments": ["2025-01-01, New Year Cup"]}, ["2025-01-01"], []),
            # A ten-char prefix that isn't a real date must not slip through.
            ("impossible date", ["2025-13-99, Impossible date"], [], []),
        ]
        for label, tournaments, dates, skipped_old in cases:
            with self.subTest(label):
                self.assertEqual(bpp.extract_event_dates(tournaments), (dates, skipped_old))


class BuildUidUniverseTest(unittest.TestCase):
    def test_adds_every_cluster_an_archived_event_reported(self):
        # The synonym universe itself is update-prices' build_print_universe
        # (tested there); the backfill adds whole clusters for archived prints.
        synonyms_data = {
            "synonyms": {"Iono::PAL::185": "Iono::PAF::237"},
            "canonicals": {"Professor's Research": "Professor's Research::SVI::189"},
        }
        universe = bpp.build_uid_universe(synonyms_data, {"Iono::PAL::185", "Nest Ball::SVI::181"})
        self.assertEqual(
            universe,
            {"Iono::PAL::185", "Iono::PAF::237", "Professor's Research::SVI::189", "Nest Ball::SVI::181"},
        )

    def test_groups_by_set_middle_segment(self):
        universe = {
            "Pikachu::BRS::049",
            "Raichu::BRS::050",
            "Iono::PAL::185",
            "malformed-no-set",
        }
        by_set = bpp.group_uids_by_set(universe)
        self.assertEqual(sorted(by_set["BRS"]), ["Pikachu::BRS::049", "Raichu::BRS::050"])
        self.assertEqual(by_set["PAL"], ["Iono::PAL::185"])
        self.assertNotIn("", by_set)


class AssembleArtifactTest(unittest.TestCase):
    def test_output_shape_and_rounding(self):
        now = datetime(2026, 7, 14, 12, 0, 0, tzinfo=timezone.utc)
        artifact = bpp.assemble_artifact(
            "2025-09-13",
            {"Pikachu::SVI::050": 1.234, "Iono::PAF::237": 12.5},
            now=now,
        )
        self.assertEqual(artifact["schemaVersion"], 1)
        self.assertEqual(artifact["date"], "2025-09-13")
        self.assertEqual(artifact["source"], "tcgcsv.com archive")
        self.assertEqual(artifact["generated"], "2026-07-14T12:00:00+00:00")
        self.assertEqual(
            artifact["prices"],
            {"Pikachu::SVI::050": 1.23, "Iono::PAF::237": 12.5},
        )


class BuildDatePricesTest(unittest.TestCase):
    def test_joins_products_and_prices_for_one_group(self):
        # One synthetic group: a Normal + Reverse Holo variant; Normal wins.
        products = [
            {
                "productId": 555,
                "name": "Pikachu - 050/198",
                "extendedData": [{"name": "Number", "value": "050/198"}],
            }
        ]
        prices_by_group = {
            42: [
                {"productId": 555, "subTypeName": "Reverse Holofoil", "marketPrice": 3.0},
                {"productId": 555, "subTypeName": "Normal", "marketPrice": 0.5},
            ]
        }
        group_products = {42: (products, "SVI", ["Pikachu::SVI::050"])}
        prices = bpp.build_date_prices(group_products, prices_by_group)
        self.assertEqual(prices, {"Pikachu::SVI::050": 0.5})


if __name__ == "__main__":
    unittest.main()
