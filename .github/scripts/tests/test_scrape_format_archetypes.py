"""Unit tests for the format-archetype snapshot's pure helpers (no network).

Two decisions decide what the tier list offers: which rows clear the share
floor, and what a partial re-scrape does to formats it did not visit. The
second is the one with teeth — the monthly job refreshes Expanded alone, and a
merge that dropped the untouched past formats would empty the picker.
"""

import importlib.util
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))

import limitless_decks as decks  # noqa: E402
from r2 import ReadResult  # noqa: E402


def _deck(name: str, icons, count, share: float, slug: str = "") -> decks.DeckRow:
    return decks.DeckRow(name=name, slug=slug or name.lower().replace(" ", "-"), icons=icons, count=count, share=share)


def _load_module():
    script_path = Path(__file__).resolve().parents[1] / "scrape-format-archetypes.py"
    spec = importlib.util.spec_from_file_location("scrape_format_archetypes", script_path)
    if not spec or not spec.loader:
        raise RuntimeError(f"Unable to load module from {script_path}")
    module = importlib.util.module_from_spec(spec)
    # Registered before exec: @dataclass resolves annotations through
    # sys.modules[cls.__module__], which is None for a module loaded by spec
    # alone, and raises on the first field.
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


formats = _load_module()


def _entry(format_id: str, names) -> dict:
    return {"id": format_id, "label": format_id, "archetypes": [{"name": n} for n in names]}


class RankedArchetypeTests(unittest.TestCase):
    def test_drops_rows_at_or_below_the_share_floor(self):
        rows = [
            _deck("Kept", [], 8, 0.0076),
            _deck("Exactly", [], 7, 0.0075),
            _deck("Cut", [], 7, 0.0074),
        ]
        self.assertEqual([a["name"] for a in formats.ranked_archetypes(rows)], ["Kept"])

    def test_drops_the_other_bucket_however_popular(self):
        rows = [_deck("Other", ["substitute"], 300, 0.3), _deck("Real", [], 10, 0.1)]
        self.assertEqual([a["name"] for a in formats.ranked_archetypes(rows)], ["Real"])

    def test_orders_by_share_then_name(self):
        rows = [
            _deck("Beta", [], 5, 0.05),
            _deck("Alpha", [], 5, 0.05),
            _deck("Gamma", [], 9, 0.09),
        ]
        self.assertEqual([a["name"] for a in formats.ranked_archetypes(rows)], ["Gamma", "Alpha", "Beta"])

    def test_share_is_recorded_as_a_percentage(self):
        rows = [_deck("Lugia", ["lugia"], 10, 0.1234)]
        self.assertEqual(
            formats.ranked_archetypes(rows)[0],
            # The slug rides along for the arts pass and is dropped again before
            # the file is written.
            {"name": "Lugia", "slug": "lugia", "icons": ["lugia"], "share": 12.34},
        )


class MergeTests(unittest.TestCase):
    def test_untouched_formats_survive_a_partial_rescrape(self):
        existing = {"ex": _entry("ex", ["Dark Tyranitar"]), "expanded": _entry("expanded", ["stale"])}
        merged = formats.merge(existing, {"expanded": _entry("expanded", ["fresh"])})
        by_id = {entry["id"]: entry for entry in merged["formats"]}
        self.assertEqual([a["name"] for a in by_id["ex"]["archetypes"]], ["Dark Tyranitar"])
        self.assertEqual([a["name"] for a in by_id["expanded"]["archetypes"]], ["fresh"])

    def test_output_follows_the_catalog_order_not_the_scrape_order(self):
        scraped = {spec.id: _entry(spec.id, ["X"]) for spec in reversed(formats.FORMATS)}
        merged = formats.merge({}, scraped)
        self.assertEqual([entry["id"] for entry in merged["formats"]], [spec.id for spec in formats.FORMATS])

    def test_unknown_ids_are_dropped_rather_than_appended(self):
        merged = formats.merge({"retired": _entry("retired", ["X"])}, {"ex": _entry("ex", ["Y"])})
        self.assertEqual([entry["id"] for entry in merged["formats"]], ["ex"])

    def test_records_the_share_floor_it_was_built_with(self):
        self.assertEqual(formats.merge({}, {})["shareFloor"], formats.SHARE_FLOOR)


class CatalogTests(unittest.TestCase):
    def test_ids_are_unique(self):
        ids = [spec.id for spec in formats.FORMATS]
        self.assertEqual(len(ids), len(set(ids)))

    def test_every_format_is_current_or_past(self):
        self.assertEqual({spec.group for spec in formats.FORMATS}, {"current", "past"})

    def test_only_current_formats_aggregate_windows(self):
        # A past format's page already covers its whole history, so walking its
        # set windows would fetch six pages to rebuild the one we started from.
        self.assertEqual(
            {spec.id for spec in formats.FORMATS if spec.aggregate},
            {spec.id for spec in formats.FORMATS if spec.group == "current"},
        )


class LoadExistingTests(unittest.TestCase):
    """The merge input comes from the bucket, so absence and failure must differ."""

    def read_result(self, result):
        return patch.multiple(formats, r2_client=Mock(), read_json=Mock(return_value=result))

    def test_nothing_published_yet_is_not_an_error(self):
        with patch.dict(formats.os.environ, {"R2_BUCKET_NAME": "bucket"}):
            with self.read_result(ReadResult("missing")):
                self.assertEqual(formats.load_existing(), {})

    def test_a_read_failure_never_looks_like_an_empty_snapshot(self):
        with patch.dict(formats.os.environ, {"R2_BUCKET_NAME": "bucket"}):
            for status in ("transport", "corrupt"):
                with self.read_result(ReadResult(status, None, RuntimeError("boom"))):
                    with self.assertRaises(RuntimeError):
                        formats.load_existing()

    def test_published_snapshot_round_trips_through_merge_unchanged(self):
        entries = [{"id": spec.id, "archetypes": []} for spec in formats.FORMATS[:2]]
        document = {"version": 1, "shareFloor": formats.SHARE_FLOOR, "formats": entries}
        with patch.dict(formats.os.environ, {"R2_BUCKET_NAME": "bucket"}):
            with self.read_result(ReadResult("found", document)):
                existing = formats.load_existing()
        self.assertEqual(formats.merge(existing, {})["formats"], entries)


if __name__ == "__main__":
    unittest.main()
