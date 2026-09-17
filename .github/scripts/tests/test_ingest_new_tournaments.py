"""Unit tests for ingest-new-tournaments' pure helpers (no network/credentials).

Covers the decisions that decide whether an event is ever ingested: which codes
the labs index publishes, which codes R2 already holds, and how the two are
reconciled. Getting either
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


def _entry(code: str, name: str, dates: str) -> str:
    """One labs index card, shaped like the live markup."""
    return (
        f'<li><a href="/{code}/standings" class="flex"><img src="regional.png" alt="regional logo"/>'
        f'<div class="flex flex-col gap-1"><div class="font-bold text-xl">{name}</div>'
        f'<div class="flex gap-2 items-center"><!--[--><img src="PL.png" title="PL" alt="PL"/><!--]-->'
        f" {dates} <!--[!--><!--]--></div></div></a></li>"
    )


class ParsePublishedEventsTest(unittest.TestCase):
    def test_extracts_codes_ascending_and_deduped(self):
        html = (
            '<a href="/0071/standings">Worlds</a>'
            '<a href="/0058/standings">Houston</a>'
            '<a href="/0058/standings">Houston again</a>'
            '<a href="/tournaments/517">not a labs code</a>'
        )
        self.assertEqual(list(ingest_module.parse_published_events(html)), ["0058", "0071"])

    def test_returns_empty_when_index_has_no_links(self):
        self.assertEqual(ingest_module.parse_published_events("<html></html>"), {})

    def test_names_each_entry_the_way_download_tournament_names_its_folder(self):
        html = (
            _entry("0007", "Regional Championship Gdańsk", "November 2–3, 2024")
            + _entry("0012", "Special Event Bogot&aacute;", "May 31–June 1, 2025")
            + _entry("0013", "Regional Championship Lille", "sometime soon")
        )
        self.assertEqual(
            ingest_module.parse_published_events(html),
            {
                "0007": "2024-11-02, Regional Championship Gdańsk",
                "0012": "2025-05-31, Special Event Bogotá",
                "0013": None,
            },
        )

    def test_fetch_reads_the_labs_index(self):
        html = _entry("0071", "World Championship San Francisco", "August 28–30, 2026")
        self.assertEqual(
            ingest_module.fetch_published_events(_FakeSession(html)),
            {"0071": "2026-08-28, World Championship San Francisco"},
        )


class FetchEventCodesTest(unittest.TestCase):
    def test_reads_labs_code_from_every_folder_meta(self):
        client = self.client_with_metas([{"labsCode": "0054"}, {"labsCode": " 0031 "}])
        codes = ingest_module.fetch_event_codes(client, "bucket")
        self.assertEqual(codes, {"2026-01-01, Event 0": "0054", "2026-01-02, Event 1": "0031"})

    def test_maps_folders_without_a_usable_code_to_none(self):
        client = self.client_with_metas([{}, {"labsCode": ""}, {"labsCode": 58}])
        self.assertEqual(set(ingest_module.fetch_event_codes(client, "bucket").values()), {None})

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
            {f"{root.lstrip('/')}/meta.json": meta for root, meta in zip(events.values(), metas, strict=True)}
        )
        return _FakeClient(values)


class PlanIngestTest(unittest.TestCase):
    def test_skips_events_held_under_their_real_code(self):
        plan = ingest_module.plan_ingest({"0001": "2024-09-13, Baltimore"}, {"2024-09-13, Baltimore": "0001"})
        self.assertEqual(plan, ingest_module.IngestPlan(missing=[], refresh=[], renamed={}))

    def test_queues_new_events_ahead_of_converted_refreshes(self):
        published = {
            "0006": "2024-10-19, Lille",
            "0072": "2026-09-19, Pittsburgh",
            "0073": None,
        }
        events = {"2024-10-19, Lille": "hipLille"}
        plan = ingest_module.plan_ingest(published, events)
        self.assertEqual(plan.missing, ["0072", "0073"])
        self.assertEqual(plan.refresh, ["0006"])

    def test_matches_a_renamed_converted_event_by_start_date_without_refreshing_it(self):
        published = {"0035": "2025-08-15, World Championship Anaheim"}
        events = {"2025-08-15, World Championships 2025": "hips2025"}
        plan = ingest_module.plan_ingest(published, events)
        self.assertEqual(plan.renamed, {"0035": "2025-08-15, World Championships 2025"})
        self.assertEqual(plan.missing + plan.refresh, [])

    def test_a_shared_start_date_is_not_enough_to_claim_a_converted_event(self):
        published = {"0002": "2024-09-28, Dortmund", "0003": "2024-09-28, Joinville Renamed"}
        events = {"2024-09-28, Dortmund Old": None, "2024-09-28, Joinville": None}
        plan = ingest_module.plan_ingest(published, events)
        self.assertEqual(plan.missing, ["0002", "0003"])
        self.assertEqual(plan.renamed, {})

    def test_an_exact_folder_match_outranks_a_date_match(self):
        published = {"0002": "2024-09-28, Dortmund Renamed", "0003": "2024-09-28, Joinville"}
        events = {"2024-09-28, Joinville": "Joinville"}
        plan = ingest_module.plan_ingest(published, events)
        self.assertEqual(plan.refresh, ["0003"])
        self.assertEqual(plan.missing, ["0002"])


class ParseEnvTest(unittest.TestCase):
    def test_max_ingest_falls_back_on_junk_and_non_positive(self):
        import os

        for raw, expected in [("", 5), ("nope", 5), ("0", 5), ("-3", 5), ("12", 12)]:
            os.environ["MAX_INGEST_TEST"] = raw
            self.assertEqual(ingest_module.parse_int_env("MAX_INGEST_TEST", 5), expected)
        del os.environ["MAX_INGEST_TEST"]


if __name__ == "__main__":
    unittest.main()
