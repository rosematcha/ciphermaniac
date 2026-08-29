"""Unit tests for ingest-new-tournaments' pure helpers (no network/credentials).

Covers the two decisions that decide whether an event is ever ingested: which
codes the labs index publishes, and which codes R2 already holds. Getting either
wrong reproduces the original failure — tournaments published upstream that no
scheduled job ever notices.
"""

import importlib.util
import unittest
from pathlib import Path


def _load_module():
    script_path = Path(__file__).resolve().parents[1] / "ingest-new-tournaments.py"
    spec = importlib.util.spec_from_file_location("ingest_new_tournaments", script_path)
    if not spec or not spec.loader:
        raise RuntimeError(f"Unable to load module from {script_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


ingest_module = _load_module()


class _FakeResponse:
    def __init__(self, text: str):
        self.text = text

    def raise_for_status(self) -> None:
        return None


class _FakeSession:
    def __init__(self, text: str):
        self._text = text

    def get(self, _url: str, timeout: int = 0) -> _FakeResponse:  # noqa: ARG002
        return _FakeResponse(self._text)


class _FakeDownloadModule:
    """Stands in for download-tournament.py's R2 helpers."""

    def __init__(self, folders, metas):
        self._folders = folders
        self._metas = metas

    def list_report_folders(self, _client, _bucket):
        return self._folders

    def fetch_tournament_meta(self, _client, _bucket, folder):
        return self._metas.get(folder, {})


class FetchPublishedCodesTest(unittest.TestCase):
    def test_extracts_codes_ascending_and_deduped(self):
        html = (
            '<a href="/0071/standings">Worlds</a>'
            '<a href="/0058/standings">Houston</a>'
            '<a href="/0058/standings">Houston again</a>'
            '<a href="/tournaments/517">not a labs code</a>'
        )
        codes = ingest_module.fetch_published_codes(_FakeSession(html))
        self.assertEqual(codes, ["0058", "0071"])

    def test_returns_empty_when_index_has_no_links(self):
        self.assertEqual(ingest_module.fetch_published_codes(_FakeSession("<html></html>")), [])


class FetchIngestedCodesTest(unittest.TestCase):
    def test_reads_labs_code_from_every_folder_meta(self):
        download = _FakeDownloadModule(
            ["2026-02-13, International Championship London", "2025-06-13, IC New Orleans"],
            {
                "2026-02-13, International Championship London": {"labsCode": "0054"},
                "2025-06-13, IC New Orleans": {"labsCode": " 0031 "},
            },
        )
        codes = ingest_module.fetch_ingested_codes(download, None, "bucket")
        self.assertEqual(codes, {"0054", "0031"})

    def test_ignores_folders_without_a_usable_code(self):
        download = _FakeDownloadModule(
            ["Snapshots", "2026-02-13, Event", "2026-03-20, Event"],
            {
                "Snapshots": {},
                "2026-02-13, Event": {"labsCode": ""},
                "2026-03-20, Event": {"labsCode": 58},
            },
        )
        self.assertEqual(ingest_module.fetch_ingested_codes(download, None, "bucket"), set())


class ParseEnvTest(unittest.TestCase):
    def test_max_ingest_falls_back_on_junk_and_non_positive(self):
        import os

        for raw, expected in [("", 5), ("nope", 5), ("0", 5), ("-3", 5), ("12", 12)]:
            os.environ["MAX_INGEST_TEST"] = raw
            self.assertEqual(ingest_module.parse_int_env("MAX_INGEST_TEST", 5), expected)
        del os.environ["MAX_INGEST_TEST"]


if __name__ == "__main__":
    unittest.main()
