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

    def test_classic_collection_reprints_never_name_a_card_with_another_print(self):
        cases = [
            ("Rocket's Admin.", [("CEL", "CC12", 0.5), ("TRR", "086", 21.96)], ("TRR", "086")),
            ("Dark Tyranitar", [("30C", "CC9", 12.42), ("TRR", "019", 79.67)], ("TRR", "019")),
            ("Some Classic", [("30C", "CC30", 1.5)], ("30C", "CC30")),
        ]
        for name, prints, expected in cases:
            with self.subTest(name=name):
                variations = [{"set": s, "number": n, "price_usd": p} for s, n, p in prints]
                chosen = download_tournament.choose_canonical_print(variations, name)
                self.assertEqual((chosen["set"], chosen["number"]), expected)

    def test_print_table_keeps_letter_only_numbers_unpadded(self):
        page = """
            <table class="card-prints-versions">
              <tr><th>Int. Prints</th></tr>
              <tr>
                <td><a href="/cards/MEE/4">Mega Evolution Energy</a>
                  <span class="prints-table-card-number">#4</span></td>
                <td><a class="card-price">$0.19</a></td>
              </tr>
              <tr>
                <td><a>Brilliant Stars</a><span class="prints-table-card-number">#L</span></td>
                <td></td>
              </tr>
            </table>
        """

        class Response:
            text = page

            def raise_for_status(self):
                return None

        class Session:
            def request(self, method, url, **kwargs):
                return Response()

        variations = download_tournament.scrape_card_print_variations(Session(), "BRS", "L")
        self.assertEqual(
            [(v["set"], v["number"]) for v in variations],
            [("MEE", "004"), ("BRS", "L")],
        )


if __name__ == "__main__":
    unittest.main()
