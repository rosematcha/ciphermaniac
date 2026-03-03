import importlib.util
import json
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


class _FakeBody:
    def __init__(self, payload: str):
        self._payload = payload

    def read(self):
        return self._payload.encode("utf-8")


class _FakeNoSuchKey(Exception):
    pass


class _FakeR2Client:
    class exceptions:
        NoSuchKey = _FakeNoSuchKey

    def __init__(self, objects):
        self._objects = dict(objects)
        self.put_calls = []

    def get_object(self, Bucket, Key):
        if Key not in self._objects:
            raise self.exceptions.NoSuchKey(Key)
        return {"Body": _FakeBody(self._objects[Key])}

    def put_object(self, Bucket, Key, Body, ContentType):
        body_text = Body if isinstance(Body, str) else Body.decode("utf-8")
        self._objects[Key] = body_text
        self.put_calls.append(
            {
                "Bucket": Bucket,
                "Key": Key,
                "Body": body_text,
                "ContentType": ContentType,
            }
        )


class DownloadTournamentTests(unittest.TestCase):
    def test_parse_start_date_supports_cross_month_ranges(self):
        iso, raw = download_tournament.parse_start_date("February 27–March 1, 2026")
        self.assertEqual(iso, "2026-02-27")
        self.assertEqual(raw, "February 27–March 1, 2026")

        iso2, _ = download_tournament.parse_start_date("November 30–December 1, 2024")
        self.assertEqual(iso2, "2024-11-30")

        iso3, _ = download_tournament.parse_start_date("May 31–June 1, 2025")
        self.assertEqual(iso3, "2025-05-31")

    def test_sort_tournament_names_by_recency_mixed_entries(self):
        tournaments = [
            "Special Event Bologna",
            "2025-11-29, Regional Championship Stuttgart",
            "2026-02-13, International Championship London",
            "Regional Championship Stuttgart",
        ]
        meta_map = {
            "Special Event Bologna": {"date": "May 31–June 1, 2025", "startDate": None},
            "Regional Championship Stuttgart": {"date": "November 30–December 1, 2024", "startDate": None},
        }

        sorted_names = download_tournament.sort_tournament_names_by_recency(tournaments, meta_map)
        self.assertEqual(
            sorted_names,
            [
                "2026-02-13, International Championship London",
                "2025-11-29, Regional Championship Stuttgart",
                "Special Event Bologna",
                "Regional Championship Stuttgart",
            ],
        )

    def test_update_tournaments_json_uses_date_aware_ordering(self):
        existing = [
            "Special Event Bologna",
            "2026-02-13, International Championship London",
            "Regional Championship Stuttgart",
        ]
        objects = {
            "reports/tournaments.json": json.dumps(existing),
            "reports/Special Event Bologna/meta.json": json.dumps(
                {"date": "May 31–June 1, 2025", "startDate": None}
            ),
            "reports/Regional Championship Stuttgart/meta.json": json.dumps(
                {"date": "November 30–December 1, 2024", "startDate": None}
            ),
        }
        client = _FakeR2Client(objects)

        download_tournament.update_tournaments_json(
            client,
            "bucket",
            "2026-02-27, Regional Championship Seattle",
        )

        uploaded = json.loads(client._objects["reports/tournaments.json"])
        self.assertEqual(
            uploaded,
            [
                "2026-02-27, Regional Championship Seattle",
                "2026-02-13, International Championship London",
                "Special Event Bologna",
                "Regional Championship Stuttgart",
            ],
        )


if __name__ == "__main__":
    unittest.main()
