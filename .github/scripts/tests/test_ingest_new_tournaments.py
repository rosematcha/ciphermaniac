"""Unit tests for ingest-new-tournaments' pure helpers (no network/credentials).

Covers the two decisions that decide whether an event is ever ingested: which
codes the labs index publishes, and which codes R2 already holds. Getting either
wrong reproduces the original failure — tournaments published upstream that no
scheduled job ever notices.
"""

import importlib.util
import json
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


class _Body:
    def __init__(self, value):
        self._value = value

    def read(self):
        return json.dumps(self._value).encode()


class _FakeClient:
    def __init__(self, values):
        self._values = values

    def get_object(self, Bucket, Key):  # noqa: ARG002
        if Key not in self._values:
            error = Exception("missing")
            error.response = {"Error": {"Code": "NoSuchKey"}}
            raise error
        return {"Body": _Body(self._values[Key])}


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
        client = self.client_with_metas([{"labsCode": "0054"}, {"labsCode": " 0031 "}])
        codes = ingest_module.fetch_ingested_codes(client, "bucket")
        self.assertEqual(codes, {"0054", "0031"})

    def test_ignores_folders_without_a_usable_code(self):
        client = self.client_with_metas([{}, {"labsCode": ""}, {"labsCode": 58}])
        self.assertEqual(ingest_module.fetch_ingested_codes(client, "bucket"), set())

    @staticmethod
    def client_with_metas(metas):
        events = {
            f"2026-01-{index + 1:02d}, Event {index}": (
                f"/releases/v1/events/2026-01-{index + 1:02d}, Event {index}/abc123def45{index}"
            )
            for index in range(len(metas))
        }
        manifest = {"releaseId": "release_1", "roots": {}, "events": events}
        values = {
            "current.json": {"releaseId": "release_1"},
            "build/v1/releases/release_1.json": manifest,
        }
        values.update(
            {f"{root.lstrip('/')}/meta.json": meta for root, meta in zip(events.values(), metas)}
        )
        return _FakeClient(values)


class ParseEnvTest(unittest.TestCase):
    def test_max_ingest_falls_back_on_junk_and_non_positive(self):
        import os

        for raw, expected in [("", 5), ("nope", 5), ("0", 5), ("-3", 5), ("12", 12)]:
            os.environ["MAX_INGEST_TEST"] = raw
            self.assertEqual(ingest_module.parse_int_env("MAX_INGEST_TEST", 5), expected)
        del os.environ["MAX_INGEST_TEST"]


if __name__ == "__main__":
    unittest.main()
