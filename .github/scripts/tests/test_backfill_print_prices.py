"""Unit tests for backfill-print-prices' pure helpers (no network/credentials).

Covers the four decision points a bad backfill would corrupt silently: which
dates to process, which prints make up the universe, how set codes resolve to
TCGCSV groups (including the catalog-name fallback), and the artifact shape.
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
    def test_strings_dicts_and_undated_entries(self):
        tournaments = [
            "2025-09-13, Regional Championship Monterrey",
            {"folder": "2025-05-17, Some Regional"},
            {"name": "2025-05-17, Duplicate Date Event"},  # dedupes with above
            {"path": "2024-06-01, Path-keyed Event"},
            "No date at the front of this one",
            {"folder": "malformed"},
            42,  # non-string/dict entry is ignored
        ]
        dates, skipped_old = bpp.extract_event_dates(tournaments)
        self.assertEqual(dates, ["2024-06-01", "2025-05-17", "2025-09-13"])
        self.assertEqual(skipped_old, [])

    def test_skips_pre_archive_floor_dates(self):
        tournaments = [
            "2024-02-07, One day before the floor",
            "2024-02-08, On the floor (kept)",
            "2023-11-01, Well before",
        ]
        dates, skipped_old = bpp.extract_event_dates(tournaments)
        self.assertEqual(dates, ["2024-02-08"])
        self.assertEqual(skipped_old, ["2023-11-01", "2024-02-07"])

    def test_accepts_wrapped_object_form(self):
        wrapped = {"tournaments": ["2025-01-01, New Year Cup"]}
        dates, _ = bpp.extract_event_dates(wrapped)
        self.assertEqual(dates, ["2025-01-01"])

    def test_rejects_non_date_leading_digits(self):
        # A ten-char prefix that isn't a real date must not slip through.
        dates, _ = bpp.extract_event_dates(["2025-13-99, Impossible date"])
        self.assertEqual(dates, [])


class BuildUidUniverseTest(unittest.TestCase):
    def test_includes_aliases_canonicals_and_base_canonicals(self):
        synonyms_data = {
            "synonyms": {
                "Pikachu::BRS::049": "Pikachu::SVI::050",
                "Iono::PAL::185": "Iono::PAF::237",
            },
            "canonicals": {
                "Professor's Research": "Professor's Research::SVI::189",
            },
        }
        universe = bpp.build_uid_universe(synonyms_data)
        self.assertEqual(
            universe,
            {
                "Pikachu::BRS::049",    # alias key
                "Pikachu::SVI::050",    # its canonical
                "Iono::PAL::185",
                "Iono::PAF::237",
                "Professor's Research::SVI::189",  # base-name canonical
            },
        )

    def test_tolerates_empty_and_missing_sections(self):
        self.assertEqual(bpp.build_uid_universe({}), set())
        self.assertEqual(bpp.build_uid_universe({"synonyms": {}}), set())

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


class MapSetsToGroupIdsTest(unittest.TestCase):
    def setUp(self):
        # Minimal catalog: name → code, exercising the fallback path.
        catalog = {
            "sets": [
                {"code": "BRS", "name": "Brilliant Stars"},
                {"code": "SVI", "name": "Scarlet & Violet"},
            ]
        }
        self.name_index = bpp.build_catalog_name_index(catalog)

    def test_abbreviation_match_wins(self):
        groups = [{"groupId": 100, "abbreviation": "SVI", "name": "SV01: Scarlet & Violet"}]
        mappings, unmapped = bpp.map_sets_to_group_ids(
            ["SVI"], groups, self.name_index, manual_map={}
        )
        self.assertEqual(mappings, {"SVI": 100})
        self.assertEqual(unmapped, [])

    def test_name_fallback_resolves_when_abbreviation_differs(self):
        # TCGCSV abbreviation is "SWSH09", our code is "BRS"; the group name tail
        # "Brilliant Stars" matches the catalog name, so BRS resolves via fallback.
        groups = [{"groupId": 200, "abbreviation": "SWSH09", "name": "SWSH09: Brilliant Stars"}]
        mappings, unmapped = bpp.map_sets_to_group_ids(
            ["BRS"], groups, self.name_index, manual_map={}
        )
        self.assertEqual(mappings, {"BRS": 200})
        self.assertEqual(unmapped, [])

    def test_manual_map_beats_name_fallback(self):
        groups = [{"groupId": 200, "abbreviation": "SWSH09", "name": "SWSH09: Brilliant Stars"}]
        mappings, _ = bpp.map_sets_to_group_ids(
            ["BRS"], groups, self.name_index, manual_map={"BRS": 999}
        )
        self.assertEqual(mappings["BRS"], 999)

    def test_unmapped_set_reported_not_fatal(self):
        groups = [{"groupId": 100, "abbreviation": "SVI", "name": "SV01: Scarlet & Violet"}]
        mappings, unmapped = bpp.map_sets_to_group_ids(
            ["SVI", "ZZZ"], groups, self.name_index, manual_map={}
        )
        self.assertEqual(mappings, {"SVI": 100})
        self.assertEqual(unmapped, ["ZZZ"])


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
