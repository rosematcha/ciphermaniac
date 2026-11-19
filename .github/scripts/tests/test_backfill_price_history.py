"""The price-history repair reads the online master it is told to, and marks itself unfinished before writing."""

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import ANY, Mock, patch


def _load_module():
    script_path = Path(__file__).resolve().parents[1] / "backfill-price-history.py"
    spec = importlib.util.spec_from_file_location("backfill_price_history", script_path)
    if not spec or not spec.loader:
        raise RuntimeError(f"Unable to load module from {script_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


bph = _load_module()


class OnlineMasterTest(unittest.TestCase):
    def test_reads_the_staged_online_master_it_is_given(self):
        staged_key = "reports/Online - Last 14 Days/master.json"
        load = Mock(side_effect=RuntimeError("stop after the master read"))
        with tempfile.TemporaryDirectory() as cache_dir, \
                patch.object(sys, "argv", ["backfill", "--cache-dir", cache_dir, "--online-master", staged_key]), \
                patch.object(bph, "find_7z", return_value="7z"), \
                patch.multiple(bph.up, initialize_r2_client=Mock(), load_online_meta_report=load), \
                patch.object(bph.up.r2, "load_production_release", return_value={}):
            with self.assertRaisesRegex(RuntimeError, "stop after the master read"):
                bph.main()
        load.assert_called_once_with(ANY, ANY, {}, staged_key)


class RepairMarkerOrderTest(unittest.TestCase):
    def test_marks_the_repair_unfinished_before_its_first_upload(self):
        marker = "build/v1/producers/repair-price-history.json"
        client = Mock()
        empty = Mock(return_value=set())
        with tempfile.TemporaryDirectory() as cache_dir, \
                patch.object(sys, "argv", ["backfill", "--days", "1", "--cache-dir", cache_dir, "--marker", marker]), \
                patch.multiple(bph, find_7z=Mock(return_value="7z"), download_archive=Mock(return_value=None)), \
                patch.multiple(bph.up, initialize_r2_client=Mock(return_value=client),
                               load_online_meta_report=Mock(return_value={}),
                               load_card_synonyms=Mock(return_value={}), extract_current_meta_canonicals=empty,
                               load_all_event_cards=empty, expand_to_clusters=empty, extract_unique_cards=empty,
                               build_print_universe=empty, map_sets_to_group_ids=Mock(return_value={}),
                               upload_derived_artifacts=Mock()), \
                patch.object(bph.up.r2, "load_production_release", return_value={}):
            bph.main()
        puts = [call.kwargs for call in client.put_object.call_args_list]
        self.assertEqual([put["Key"] for put in puts], [marker, bph.up.PRICES_HISTORY_KEY])
        self.assertEqual(json.loads(puts[0]["Body"])["status"], "building")


if __name__ == "__main__":
    unittest.main()
