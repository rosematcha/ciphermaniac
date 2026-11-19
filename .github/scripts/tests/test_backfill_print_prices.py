"""Unit tests for backfill-print-prices' pure helpers (no network/credentials).

Covers the decision points a bad backfill would corrupt silently: which dates
to process, which prints make up the universe, and the artifact shape. Set-code
to TCGCSV-group resolution is update-prices' resolve_group_ids, tested there.
"""

import importlib.util
import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import Mock, patch


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


class RepairRetryTest(unittest.TestCase):
    MARKER = "build/v1/producers/repair-print-prices.json"

    def run_main(self, dates, previous_marker, present):
        puts = self.puts = []
        client = Mock()
        client.put_object.side_effect = lambda **kw: puts.append((kw["Key"], json.loads(kw["Body"])))
        found = bpp.r2.ReadResult("found", previous_marker, None)
        with tempfile.TemporaryDirectory() as cache_dir, \
                patch.object(sys, "argv", ["bpp", "--dates", ",".join(dates), "--marker", self.MARKER,
                                           "--cache-dir", cache_dir]), \
                patch.multiple(bpp, find_7z=Mock(return_value="7z"), load_synonyms=Mock(return_value={}),
                               map_sets_to_group_ids=Mock(return_value=({}, [])),
                               download_archive=Mock(return_value=Path("archive.7z")),
                               extract_group_prices=Mock(return_value={})), \
                patch.multiple(bpp.up, initialize_r2_client=Mock(return_value=client),
                               load_all_event_cards=Mock(return_value=set()),
                               fetch_tcgcsv_results=Mock(return_value=[])), \
                patch.multiple(bpp.r2, load_production_release=Mock(return_value={"events": {}}),
                               read_json=Mock(return_value=found),
                               object_exists=Mock(side_effect=lambda _c, _b, key: key in present)):
            bpp.main()
        return puts

    def test_a_retry_finishes_the_dates_an_interrupted_run_left_pending(self):
        interrupted = {"status": "building", "pending": ["2026-11-01", "2026-11-02"]}
        present = {"assets/print-prices/2026-11-01.json"}
        puts = self.run_main(["2026-11-03"], interrupted, present)
        pending = ["2026-11-01", "2026-11-02", "2026-11-03"]
        self.assertEqual(puts[0], (self.MARKER, {"status": "building", "pending": pending}))
        self.assertEqual([key for key, _ in puts[1:]],
                         ["assets/print-prices/2026-11-02.json", "assets/print-prices/2026-11-03.json"])

    def test_a_malformed_requested_date_rejects_the_run_before_any_write(self):
        for malformed in ["2026-02-30", "2026-1-05", "2026-11-09" + "9" * 250]:
            with self.subTest(malformed=malformed[:12]):
                with self.assertRaises(SystemExit), redirect_stderr(io.StringIO()):
                    self.run_main(["2026-11-01", malformed], None, set())
                self.assertEqual(self.puts, [])

    def test_a_retry_drops_malformed_pending_dates_with_a_warning(self):
        interrupted = {"status": "building", "pending": ["2026-11-02", "2026-11-0" + "9" * 250, 7]}
        output = io.StringIO()
        with redirect_stdout(output):
            puts = self.run_main(["2026-11-03"], interrupted, set())
        self.assertEqual(puts[0], (self.MARKER, {"status": "building", "pending": ["2026-11-02", "2026-11-03"]}))
        self.assertIn("Warning: dropping malformed pending dates", output.getvalue())


if __name__ == "__main__":
    unittest.main()
