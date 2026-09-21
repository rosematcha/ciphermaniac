#!/usr/bin/env python3
"""
Ingest Limitless Labs tournaments that are not in the dataset yet.

Until this script existed, every event reached R2 through a manual
`download-tournament` dispatch, one URL at a time. Nothing noticed when nobody
ran it: labs published codes 0055-0071 while the dataset sat at 0054, so six
months of events were missing from the reports, the catalog, and every player
profile derived from them.

The scan is: read the labs index for published codes, read the `labsCode` of
every immutable production or pending event, and run `download-tournament.py`
for the difference (oldest first, so a partial run still leaves a
chronologically contiguous dataset). Each ingest registers an immutable event
for the next production release.

Events converted from the legacy reports carry a made-up `labsCode` and
placeholder metadata. They are matched to their labs entry by folder name
(start date + event name) and re-downloaded in place, but only after every
genuinely new event. A converted event whose name labs has since changed is
matched by start date alone and left as is, since re-downloading it would land
under a new folder and duplicate the event.

Environment:
  R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET_NAME
  DRY_RUN         - list what would be ingested without downloading (default false)
  MAX_INGEST      - cap per run so a first run cannot fan out unbounded (default 5)
  ANONYMIZE       - forwarded to download-tournament.py (default false)
"""

from __future__ import annotations

import html
import os
import re
import subprocess
import sys
from datetime import date
from pathlib import Path
from typing import NamedTuple

import requests

# Shared R2 helpers (retrying client + typed read results).
sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
import r2  # noqa: E402

LABS_INDEX_URL = "https://labs.limitlesstcg.com/"
LABS_CODE_PATTERN = re.compile(r'href="/(\d{4})/standings"')
LABS_NAME_PATTERN = re.compile(r'<div class="font-bold text-xl">(.*?)</div>', re.S)
# Start month and day, then the year that closes the range ("November 2–3, 2024").
LABS_DATE_PATTERN = re.compile(r"\b([A-Z][a-z]+) (\d{1,2})\b[^<]*?(\d{4})\b")
LABS_CODE_FORMAT = re.compile(r"\d{4}")
MONTHS = {
    name: index
    for index, name in enumerate(
        [
            "January",
            "February",
            "March",
            "April",
            "May",
            "June",
            "July",
            "August",
            "September",
            "October",
            "November",
            "December",
        ],
        start=1,
    )
}
DEFAULT_MAX_INGEST = 5


def parse_bool_env(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    normalized = raw.strip().lower()
    if normalized in {"1", "true", "yes", "y", "on"}:
        return True
    if normalized in {"0", "false", "no", "n", "off"}:
        return False
    return default


def parse_int_env(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        value = int(raw.strip())
    except ValueError:
        return default
    return value if value > 0 else default


def entry_folder(entry_html: str) -> str | None:
    """The folder download-tournament.py would name a labs index entry, or None."""
    name_match = LABS_NAME_PATTERN.search(entry_html)
    if not name_match:
        return None
    date_match = LABS_DATE_PATTERN.search(entry_html, name_match.end())
    month = MONTHS.get(date_match[1]) if date_match else None
    if not month:
        return None
    try:
        start = date(int(date_match[3]), month, int(date_match[2]))
    except ValueError:
        return None
    name = re.sub(r'[<>:"/\\|?*]', "", html.unescape(name_match[1]).strip())
    return f"{start.isoformat()}, {name}"


def parse_published_events(index_html: str) -> dict[str, str | None]:
    """Every 4-digit labs code linked from the labs index, ascending, with its folder name."""
    links = list(LABS_CODE_PATTERN.finditer(index_html))
    events: dict[str, str | None] = {}
    for position, link in enumerate(links):
        end = links[position + 1].start() if position + 1 < len(links) else len(index_html)
        folder = entry_folder(index_html[link.end() : end])
        if events.get(link[1]) is None:
            events[link[1]] = folder
    return dict(sorted(events.items()))


def fetch_published_events(session: requests.Session) -> dict[str, str | None]:
    """The labs index's codes and folder names; see `parse_published_events`."""
    response = session.get(LABS_INDEX_URL, timeout=30)
    response.raise_for_status()
    # Labs sends no charset, so requests would decode as Latin-1 and turn the
    # en dash in "September 18–20" into letters that hide every date.
    response.encoding = "utf-8"
    return parse_published_events(response.text)


def fetch_event_codes(r2_client, bucket_name: str) -> dict[str, str | None]:
    """
    Each immutable production or pending event's folder → the `labsCode` in its meta.

    Folder names carry no code, so the meta is the only authority. A missing or
    blank code maps to None.
    """
    _, sources = r2.load_event_sources(r2_client, bucket_name)
    codes: dict[str, str | None] = {}
    for folder, root in sources.items():
        result = r2.read_json(r2_client, bucket_name, f"{root.lstrip('/')}/meta.json")
        if result.status != "found":
            raise RuntimeError(f"Unable to read immutable event meta: {result.status}")
        meta = result.value
        code = meta.get("labsCode") if isinstance(meta, dict) else None
        codes[folder] = (code.strip() or None) if isinstance(code, str) else None
    return codes


class IngestPlan(NamedTuple):
    """What to download: new events first, then converted events to refresh in place."""

    missing: list[str]
    refresh: list[str]
    # labs code → converted folder it was matched to by start date alone.
    renamed: dict[str, str]


def unique_date_match(folder: str | None, candidates: set[str]) -> str | None:
    """The only candidate folder sharing `folder`'s start date, if exactly one does."""
    if not folder:
        return None
    start = folder.split(",", 1)[0]
    same_day = [candidate for candidate in candidates if candidate.split(",", 1)[0] == start]
    return same_day[0] if len(same_day) == 1 else None


def plan_ingest(published: dict[str, str | None], events: dict[str, str | None]) -> IngestPlan:
    """Classify each published code not yet held under its real labs code."""
    held = {code for code in events.values() if code and LABS_CODE_FORMAT.fullmatch(code)}
    converted = {folder for folder, code in events.items() if not (code and LABS_CODE_FORMAT.fullmatch(code))}
    plan = IngestPlan(missing=[], refresh=[], renamed={})
    unplaced: list[str] = []
    for code, folder in published.items():
        if code in held:
            continue
        if folder in converted:
            converted.discard(folder)
            plan.refresh.append(code)
        else:
            unplaced.append(code)
    # Exact folder matches go first so a renamed event can only claim a folder
    # no other labs entry already owns.
    for code in unplaced:
        match = unique_date_match(published[code], converted)
        if match:
            converted.discard(match)
            plan.renamed[code] = match
        else:
            plan.missing.append(code)
    return plan


def ingest(code: str, anonymize: bool) -> None:
    """Run download-tournament.py for one labs code, raising on failure."""
    script_path = os.path.join(".github", "scripts", "download-tournament.py")
    env = os.environ.copy()
    env["LIMITLESS_INPUT"] = code
    env["ANONYMIZE"] = "true" if anonymize else "false"
    subprocess.run([sys.executable, script_path], env=env, check=True)


def is_recent_event(folder: str | None, today: date | None = None) -> bool:
    """
    Daily discovery ingests recent majors; historical repair is explicit.

    An entry without a readable date is never recent: the ingestion scope cannot
    be judged, so it waits for Maintenance instead of failing the whole scan.
    """
    if not folder:
        return False
    age = ((today or date.today()) - date.fromisoformat(folder.split(",", 1)[0])).days
    return 0 <= age <= 30


def main() -> int:
    r2_account_id = os.environ.get("R2_ACCOUNT_ID")
    r2_access_key_id = os.environ.get("R2_ACCESS_KEY_ID")
    r2_secret_access_key = os.environ.get("R2_SECRET_ACCESS_KEY")
    bucket_name = os.environ.get("R2_BUCKET_NAME", "ciphermaniac-reports")
    dry_run = parse_bool_env("DRY_RUN", False)
    anonymize = parse_bool_env("ANONYMIZE", False)
    max_ingest = parse_int_env("MAX_INGEST", DEFAULT_MAX_INGEST)

    if not all([r2_account_id, r2_access_key_id, r2_secret_access_key]):
        print("[ingest] Error: R2 credentials not set")
        return 1

    r2_client = r2.make_r2_client(r2_account_id, r2_access_key_id, r2_secret_access_key)
    session = requests.Session()

    published = fetch_published_events(session)
    if not published:
        print("[ingest] Error: labs index returned no tournament codes")
        return 1
    plan = plan_ingest(published, fetch_event_codes(r2_client, bucket_name))
    reconcile = parse_bool_env("RECONCILE_EVENTS", False)
    recent = [code for code in plan.missing if is_recent_event(published.get(code))]
    pending = plan.missing + plan.refresh if reconcile else recent
    historical = len(plan.missing) - len(recent) + len(plan.refresh)
    if historical and not reconcile:
        print(f"[ingest] {historical} historical/reconciliation events deferred to Maintenance")

    print(f"[ingest] labs published: {len(published)} (latest {list(published)[-1]})")
    print(f"[ingest] missing: {len(plan.missing)}{' -> ' + ', '.join(plan.missing) if plan.missing else ''}")
    print(
        f"[ingest] converted, to refresh: {len(plan.refresh)}{' -> ' + ', '.join(plan.refresh) if plan.refresh else ''}"
    )
    for code, folder in plan.renamed.items():
        print(f"[ingest] {code} matched converted '{folder}' by start date; not refreshed")

    if not pending:
        print("[ingest] Nothing to ingest")
        return 0

    batch = pending[:max_ingest]
    if len(pending) > len(batch):
        print(f"[ingest] Ingesting {len(batch)} this run, new events first (MAX_INGEST={max_ingest})")

    if dry_run:
        print(f"[ingest] Dry run: would ingest {', '.join(batch)}")
        return 0

    failures: list[tuple[str, str]] = []
    for code in batch:
        print(f"[ingest] Downloading labs {code}...")
        try:
            ingest(code, anonymize)
        except subprocess.CalledProcessError as error:
            failures.append((code, f"exit code {error.returncode}"))
        except Exception as error:  # noqa: BLE001
            failures.append((code, str(error)))

    succeeded = len(batch) - len(failures)
    print(f"[ingest] ===== SUMMARY =====\n  ingested : {succeeded}\n  failed   : {len(failures)}")
    for code, reason in failures:
        print(f"  - {code}: {reason}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
