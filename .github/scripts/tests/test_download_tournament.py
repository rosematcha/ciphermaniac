import importlib.util
import unittest
from pathlib import Path


def _load_download_module():
    script_path = Path(__file__).resolve().parents[1] / "download-tournament.py"
    spec = importlib.util.spec_from_file_location("download_tournament", script_path)
    if not spec or not spec.loader:
        raise RuntimeError(f"Unable to load download-tournament module from {script_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


download_tournament = _load_download_module()


class DownloadTournamentTests(unittest.TestCase):
    def test_parse_start_date_supports_cross_month_ranges(self):
        cases = [
            ("February 27–March 1, 2026", "2026-02-27"),
            ("November 30–December 1, 2024", "2024-11-30"),
            ("May 31–June 1, 2025", "2025-05-31"),
        ]
        for text, expected in cases:
            with self.subTest(text=text):
                self.assertEqual(download_tournament.parse_start_date(text), (expected, text))


if __name__ == "__main__":
    unittest.main()
