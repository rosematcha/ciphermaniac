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

    def list_objects_v2(self, Bucket, Prefix, Delimiter, ContinuationToken=None):
        folders = []
        for key in self._objects.keys():
            if not key.startswith("reports/"):
                continue
            remainder = key[len("reports/") :]
            if "/" not in remainder:
                continue
            folder = remainder.split("/", 1)[0]
            if folder:
                folders.append(folder)

        unique_sorted = sorted(set(folders))
        return {
            "IsTruncated": False,
            "CommonPrefixes": [{"Prefix": f"reports/{name}/"} for name in unique_sorted],
        }


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
            "Regional Championship Seattle",
        ]
        objects = {
            "reports/tournaments.json": json.dumps(existing),
            "reports/Special Event Bologna/meta.json": json.dumps(
                {"date": "May 31–June 1, 2025", "startDate": None}
            ),
            "reports/Regional Championship Stuttgart/meta.json": json.dumps(
                {"date": "November 30–December 1, 2024", "startDate": None}
            ),
            "reports/Regional Championship Seattle/meta.json": json.dumps(
                {"date": "February 27–March 1, 2026", "startDate": None}
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
            ],
        )

    def test_dedupe_tournament_names_removes_undated_alias_when_dated_exists(self):
        tournaments = [
            "2026-02-27, Regional Championship Seattle",
            "Regional Championship Seattle",
            "2025-11-29, Regional Championship Stuttgart",
            "Regional Championship Stuttgart",
        ]
        meta_map = {
            "Regional Championship Seattle": {"date": "February 27–March 1, 2026", "startDate": None},
            "Regional Championship Stuttgart": {"date": "November 30–December 1, 2024", "startDate": None},
        }

        deduped = download_tournament.dedupe_tournament_names(tournaments, meta_map)
        self.assertEqual(
            deduped,
            [
                "2026-02-27, Regional Championship Seattle",
                "2025-11-29, Regional Championship Stuttgart",
                "Regional Championship Stuttgart",
            ],
        )

    def test_filter_dated_tournament_names_drops_undated_entries(self):
        tournaments = [
            "2026-02-27, Regional Championship Seattle",
            "Regional Championship Seattle",
            "2025-11-29, Regional Championship Stuttgart",
            "Regional Championship Stuttgart",
        ]
        filtered = download_tournament.filter_dated_tournament_names(tournaments)
        self.assertEqual(
            filtered,
            [
                "2026-02-27, Regional Championship Seattle",
                "2025-11-29, Regional Championship Stuttgart",
            ],
        )

    def test_rebuild_tournaments_json_from_reports_dry_run_does_not_upload(self):
        objects = {
            "reports/2026-02-13, International Championship London/meta.json": json.dumps(
                {"date": "February 13–15, 2026", "startDate": "2026-02-13"}
            ),
            "reports/Regional Championship Seattle/meta.json": json.dumps(
                {"date": "February 27–March 1, 2026", "startDate": None}
            ),
            "reports/tournaments.json": json.dumps([]),
        }
        client = _FakeR2Client(objects)

        rebuilt = download_tournament.rebuild_tournaments_json_from_reports(client, "bucket", dry_run=True)
        self.assertEqual(rebuilt, ["2026-02-13, International Championship London"])
        self.assertEqual(client.put_calls, [])


if __name__ == "__main__":
    unittest.main()
