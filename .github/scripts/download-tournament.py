#!/usr/bin/env python3
"""
Tournament downloader for GitHub Actions.

Labs-first implementation that ingests Masters division data from
labs.limitlesstcg.com / mew.limitlesstcg.com endpoints and uploads reports to R2.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import sys
import tempfile
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, urlparse

import boto3
import requests
from botocore.exceptions import ClientError
from bs4 import BeautifulSoup


LIMITLESS_BASE_URL = "https://limitlesstcg.com"
LIMITLESS_LABS_BASE_URL = "https://labs.limitlesstcg.com"
LIMITLESS_MEW_BASE_URL = "https://mew.limitlesstcg.com/labs/data/tcg"
DIVISION = "MA"

LOCAL_EXPORT_DIR = os.environ.get("LOCAL_EXPORT_DIR")
CARD_TYPES_KEY = "assets/data/card-types.json"
LOCAL_CARD_TYPES_PATH = Path("public") / "assets" / "data" / "card-types.json"
CARD_SYNONYMS_KEY = "assets/card-synonyms.json"
LOCAL_CARD_SYNONYMS_PATH = Path("public") / "assets" / "card-synonyms.json"

FETCH_CONCURRENCY = int(os.environ.get("LABS_FETCH_CONCURRENCY", "20"))
HTTP_TIMEOUT = int(os.environ.get("LABS_HTTP_TIMEOUT", "20"))
HTTP_RETRIES = int(os.environ.get("LABS_HTTP_RETRIES", "4"))

# Placement-based success tags
PLACEMENT_TAG_RULES = [
    {"tag": "winner", "maxPlacing": 1, "minPlayers": 2},
    {"tag": "top2", "maxPlacing": 2, "minPlayers": 4},
    {"tag": "top4", "maxPlacing": 4, "minPlayers": 8},
    {"tag": "top8", "maxPlacing": 8, "minPlayers": 16},
    {"tag": "top16", "maxPlacing": 16, "minPlayers": 32},
]
PERCENT_TAG_RULES = [
    {"tag": "top10", "fraction": 0.1, "minPlayers": 20},
    {"tag": "top25", "fraction": 0.25, "minPlayers": 12},
    {"tag": "top50", "fraction": 0.5, "minPlayers": 8},
]

PHASE_MULTIPLIERS = {1: 1.0, 2: 1.75, 3: 3.0}
REPORT_VERSION = "3.1"

# Month mapping for date parsing
_MONTHS = {
    "january": 1,
    "february": 2,
    "march": 3,
    "april": 4,
    "may": 5,
    "june": 6,
    "july": 7,
    "august": 8,
    "september": 9,
    "october": 10,
    "november": 11,
    "december": 12,
}
_DATE_PREFIX_RE = re.compile(r"^(\d{4}-\d{2}-\d{2}),\s+")
_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_START_DATE_RE = re.compile(
    r"^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?"
    r"(?:\s*[\-–]\s*(?:(?:[A-Za-z]+)\s+)?\d{1,2}(?:st|nd|rd|th)?)?,\s*(\d{4})$"
)
ONLINE_META_NAME = "Online - Last 14 Days"


def compose_category_path(category, trainer_type=None, energy_type=None, ace_spec=False):
    base = (category or "").lower()
    if not base:
        return ""
    parts = [base]
    if base == "trainer":
        if trainer_type:
            parts.append(trainer_type.lower())
        if ace_spec:
            if "tool" not in parts and (not trainer_type or trainer_type.lower() != "tool"):
                parts.append("tool")
            parts.append("acespec")
    elif base == "energy" and energy_type:
        parts.append(energy_type.lower())
    return "/".join(parts)


def parse_bool_env(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    normalized = str(raw).strip().lower()
    if normalized in {"1", "true", "yes", "y", "on"}:
        return True
    if normalized in {"0", "false", "no", "n", "off"}:
        return False
    return default


def sanitize_for_path(text):
    return re.sub(r'[<>:"/\\|?*]', "", text)


def sanitize_for_filename(text):
    text = text.replace(" ", "_")
    return re.sub(r'[<>:"/\\|?*]', "", text)


def normalize_archetype_name(name):
    name = name.replace("_", " ")
    return " ".join(name.split())


def normalize_card_number(value: Any) -> Optional[str]:
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    match = re.match(r"^(\d+)([A-Za-z]*)$", raw)
    if not match:
        return raw.upper()
    digits, suffix = match.groups()
    return f"{digits.zfill(3)}{suffix.upper()}"


def repair_text(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    text = str(value)
    # Attempt to repair common mojibake cases for UTF-8 text decoded as latin-1.
    if "â" in text or "Ã" in text:
        try:
            repaired = text.encode("latin1").decode("utf-8")
            if repaired:
                text = repaired
        except Exception:
            pass
    return text.strip()


def build_number_variants(number):
    if number is None:
        return []
    raw = str(number).strip()
    if not raw:
        return []
    normalized = raw.upper()
    match = re.match(r"^0*(\d+)([A-Z]*)$", normalized)
    if not match:
        return [normalized]
    digits, suffix = match.groups()
    trimmed_digits = digits.lstrip("0") or "0"
    primary = f"{trimmed_digits}{suffix}"
    variants = [primary]
    padded = f"{digits}{suffix}"
    if primary != padded:
        variants.append(padded)
    return variants


def load_card_types_database(r2_client, bucket_name):
    if LOCAL_CARD_TYPES_PATH.is_file():
        try:
            data = json.loads(LOCAL_CARD_TYPES_PATH.read_text(encoding="utf-8"))
            print(f"Loaded card types database from {LOCAL_CARD_TYPES_PATH}")
            return data
        except json.JSONDecodeError:
            print(f"Warning: Failed to parse {LOCAL_CARD_TYPES_PATH}")
    if not r2_client:
        print("Card types database unavailable (no R2 client)")
        return {}
    try:
        obj = r2_client.get_object(Bucket=bucket_name, Key=CARD_TYPES_KEY)
        payload = obj["Body"].read().decode("utf-8")
        data = json.loads(payload)
        print(f"Loaded card types database from R2 ({len(data)} entries)")
        return data
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "NoSuchKey":
            print("Card types database not found in R2; continuing without enrichment")
            return {}
        raise
    except Exception as exc:
        print(f"Warning: Failed to load card types database: {exc}")
        return {}


def load_existing_canonicals(r2_client, bucket_name):
    if LOCAL_CARD_SYNONYMS_PATH.is_file():
        try:
            data = json.loads(LOCAL_CARD_SYNONYMS_PATH.read_text(encoding="utf-8"))
            print(f"Loaded existing canonicals from {LOCAL_CARD_SYNONYMS_PATH}")
            return data.get("synonyms", {}), data.get("canonicals", {})
        except json.JSONDecodeError:
            print(f"Warning: Failed to parse {LOCAL_CARD_SYNONYMS_PATH}")
    if not r2_client:
        print("Existing canonicals unavailable (no R2 client)")
        return {}, {}
    try:
        obj = r2_client.get_object(Bucket=bucket_name, Key=CARD_SYNONYMS_KEY)
        payload = obj["Body"].read().decode("utf-8")
        data = json.loads(payload)
        synonyms = data.get("synonyms", {})
        canonicals = data.get("canonicals", {})
        print(f"Loaded existing canonicals from R2 ({len(synonyms)} synonyms, {len(canonicals)} canonicals)")
        return synonyms, canonicals
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "NoSuchKey":
            print("Existing canonicals not found; will generate new ones")
            return {}, {}
        raise
    except Exception as exc:
        print(f"Warning: Failed to load existing canonicals: {exc}")
        return {}, {}


def enrich_card_entry(card, card_types_db):
    enriched = dict(card)
    set_code = enriched.get("set")
    number = enriched.get("number")
    key = f"{set_code}::{number}" if set_code and number else None
    info = card_types_db.get(key) if key else None

    if info:
        card_type = info.get("cardType")
        if card_type:
            enriched["category"] = card_type
        if card_type == "trainer" and info.get("subType"):
            enriched["trainerType"] = info["subType"]
        if card_type == "energy" and info.get("subType"):
            enriched["energyType"] = info["subType"]
        if card_type == "pokemon" and info.get("evolutionInfo"):
            enriched["evolutionInfo"] = info["evolutionInfo"]
        if info.get("fullType"):
            enriched["fullType"] = info["fullType"]
        if card_type == "trainer" and info.get("aceSpec"):
            enriched["aceSpec"] = True

    return enriched


def anonymize_name(name: str, anonymize: bool) -> str:
    if not anonymize or not name:
        return name
    digest = hashlib.sha1(name.encode("utf-8")).hexdigest()[:10]
    return f"Player-{digest}"


def request_with_retries(session, method, url, retries=HTTP_RETRIES, backoff_factor=0.5, **kwargs):
    import time

    last_exc = None
    for attempt in range(1, retries + 1):
        try:
            resp = session.request(method, url, **kwargs)
            resp.raise_for_status()
            return resp
        except requests.exceptions.RequestException as e:
            last_exc = e
            sleep_for = backoff_factor * (2 ** (attempt - 1))
            print(f"Request failed (attempt {attempt}/{retries}): {e}; retrying in {sleep_for}s...")
            time.sleep(sleep_for)
    print(f"All retries failed for {url}: {last_exc}")
    return None


def fetch_json_with_retries(session: requests.Session, url: str, timeout: int = HTTP_TIMEOUT) -> Any:
    headers = {"User-Agent": "Mozilla/5.0", "Accept": "application/json"}
    resp = request_with_retries(session, "GET", url, headers=headers, timeout=timeout)
    if not resp:
        return None
    try:
        return resp.json()
    except Exception:
        return None


def get_soup(url: str, session: requests.Session):
    headers = {"User-Agent": "Mozilla/5.0"}
    resp = request_with_retries(session, "GET", url, headers=headers, timeout=HTTP_TIMEOUT)
    if not resp:
        return None, None
    resp.encoding = "utf-8"
    return BeautifulSoup(resp.text, "html.parser"), resp.text


def parse_start_date(text: str):
    if not text:
        return None, None
    t = text.strip()
    iso = extract_start_date_from_text(t)
    return iso, t


def extract_start_date_from_text(text: Optional[str]) -> Optional[str]:
    if not text:
        return None
    t = text.strip()
    # Accept:
    # - same-month ranges: February 13-15, 2026
    # - cross-month ranges: February 27-March 1, 2026
    m = _START_DATE_RE.search(t)
    if not m:
        return None
    month_name = m.group(1).lower()
    day = int(m.group(2))
    year = int(m.group(3))
    month = _MONTHS.get(month_name)
    if not month:
        return None
    try:
        return datetime(year, month, day, tzinfo=timezone.utc).date().isoformat()
    except Exception:
        return None


def extract_date_prefix(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    match = _DATE_PREFIX_RE.match(value.strip())
    if not match:
        return None
    candidate = match.group(1)
    return candidate if is_valid_iso_date(candidate) else None


def is_valid_iso_date(value: Optional[str]) -> bool:
    if not value or not _ISO_DATE_RE.match(value):
        return False
    try:
        datetime.strptime(value, "%Y-%m-%d")
        return True
    except Exception:
        return False


def parse_iso_to_ordinal(value: Optional[str]) -> Optional[int]:
    if not is_valid_iso_date(value):
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").date().toordinal()
    except Exception:
        return None


def fetch_tournament_meta(r2_client, bucket_name: str, tournament_name: str) -> Dict[str, Any]:
    if not r2_client:
        return {}
    key = f"reports/{tournament_name}/meta.json"
    try:
        response = r2_client.get_object(Bucket=bucket_name, Key=key)
    except Exception as exc:
        no_such_key_exc = getattr(getattr(r2_client, "exceptions", object), "NoSuchKey", None)
        if no_such_key_exc and isinstance(exc, no_such_key_exc):
            return {}
        if isinstance(exc, ClientError):
            code = exc.response.get("Error", {}).get("Code")
            if code in {"NoSuchKey", "404", "NotFound"}:
                return {}
        print(f"  Warning: Could not read {key}: {exc}")
        return {}

    try:
        payload = response["Body"].read().decode("utf-8")
        parsed = json.loads(payload)
        return parsed if isinstance(parsed, dict) else {}
    except Exception as exc:
        print(f"  Warning: Invalid meta payload for {tournament_name}: {exc}")
        return {}


def derive_tournament_start_date(tournament_name: str, meta: Optional[Dict[str, Any]] = None) -> Optional[str]:
    prefixed = extract_date_prefix(tournament_name)
    if prefixed:
        return prefixed

    if isinstance(meta, dict):
        raw_start = repair_text(meta.get("startDate"))
        if is_valid_iso_date(raw_start):
            return raw_start
        raw_date = repair_text(meta.get("date"))
        parsed_from_date = extract_start_date_from_text(raw_date)
        if parsed_from_date:
            return parsed_from_date

    return None


def build_tournament_meta_map(r2_client, bucket_name: str, tournaments: List[str]) -> Dict[str, Dict[str, Any]]:
    meta_map: Dict[str, Dict[str, Any]] = {}
    for tournament_name in tournaments:
        if extract_date_prefix(tournament_name):
            continue
        meta_map[tournament_name] = fetch_tournament_meta(r2_client, bucket_name, tournament_name)
    return meta_map


def sort_tournament_names_by_recency(
    tournaments: List[str], meta_map: Optional[Dict[str, Dict[str, Any]]] = None
) -> List[str]:
    decorated = []
    for idx, tournament_name in enumerate(tournaments):
        meta = meta_map.get(tournament_name) if meta_map else None
        date_iso = derive_tournament_start_date(tournament_name, meta)
        ordinal = parse_iso_to_ordinal(date_iso)
        decorated.append(
            {
                "name": tournament_name,
                "ordinal": ordinal,
                "index": idx,
            }
        )

    decorated.sort(
        key=lambda item: (
            0 if item["ordinal"] is not None else 1,
            -(item["ordinal"] or 0),
            item["name"].lower(),
            item["name"],
            item["index"],
        )
    )
    return [item["name"] for item in decorated]


def list_report_folders(r2_client, bucket_name: str) -> List[str]:
    folders: List[str] = []
    continuation_token = None

    while True:
        params = {
            "Bucket": bucket_name,
            "Prefix": "reports/",
            "Delimiter": "/",
        }
        if continuation_token:
            params["ContinuationToken"] = continuation_token

        response = r2_client.list_objects_v2(**params)
        prefixes = response.get("CommonPrefixes") or []
        for entry in prefixes:
            prefix = entry.get("Prefix") or ""
            if not prefix.startswith("reports/"):
                continue
            folder_name = prefix[len("reports/") :].strip("/")
            if not folder_name or folder_name == ONLINE_META_NAME:
                continue
            folders.append(folder_name)

        if not response.get("IsTruncated"):
            break
        continuation_token = response.get("NextContinuationToken")

    # Preserve first occurrence order if R2 returns duplicates across pages.
    return list(dict.fromkeys(folders))


def rebuild_tournaments_json_from_reports(r2_client, bucket_name: str) -> List[str]:
    tournaments_key = "reports/tournaments.json"
    folders = list_report_folders(r2_client, bucket_name)
    if not folders:
        print("  Warning: no report folders found under reports/")
        updated: List[str] = []
    else:
        meta_map = build_tournament_meta_map(r2_client, bucket_name, folders)
        updated = sort_tournament_names_by_recency(folders, meta_map)

    print(f"  Uploading rebuilt {tournaments_key} with {len(updated)} entries...")
    r2_client.put_object(
        Bucket=bucket_name,
        Key=tournaments_key,
        Body=json.dumps(updated, indent=2),
        ContentType="application/json",
    )
    return updated


def resolve_reference_to_labs_code(input_value: str, session: requests.Session) -> Tuple[str, str, Optional[str]]:
    """
    Resolve any supported input into a labs code.

    Returns (labs_code_4_digits, source_url, limitless_tournament_url_or_none)
    """
    raw = (input_value or "").strip()
    if not raw:
        raise ValueError("Empty tournament input")

    # labs URL variants
    labs_match = re.search(r"labs\.limitlesstcg\.com/(\d{4})", raw)
    if labs_match:
        code = labs_match.group(1)
        return code, f"{LIMITLESS_LABS_BASE_URL}/{code}/standings", None

    # explicit labs code
    if re.fullmatch(r"\d{4}", raw):
        return raw, f"{LIMITLESS_LABS_BASE_URL}/{raw}/standings", None

    # Limitless tournament URL or ID
    limitlesstcg_id = None
    m = re.search(r"limitlesstcg\.com/tournaments/(\d+)", raw)
    if m:
        limitlesstcg_id = m.group(1)
    elif re.fullmatch(r"\d+", raw):
        # numeric input: first treat as limitless tournament id for compatibility.
        limitlesstcg_id = raw

    if limitlesstcg_id:
        tournament_url = f"{LIMITLESS_BASE_URL}/tournaments/{limitlesstcg_id}"
        soup, html_text = get_soup(tournament_url, session)
        if not soup and not html_text:
            raise RuntimeError(f"Failed to load {tournament_url}")

        text = html_text or ""
        link_match = re.search(r"https://labs\.limitlesstcg\.com/(\d{4})/standings", text)
        if link_match:
            code = link_match.group(1)
            return code, f"{LIMITLESS_LABS_BASE_URL}/{code}/standings", tournament_url

        raise ValueError(
            "Could not map Limitless tournament to Labs. Provide a Labs URL/code directly "
            "(e.g. https://labs.limitlesstcg.com/0054/standings or 0054)."
        )

    raise ValueError(
        "Unsupported tournament input. Provide Labs URL/code or Limitless tournament URL/ID "
        "(e.g. 0054, https://labs.limitlesstcg.com/0054/standings, "
        "https://limitlesstcg.com/tournaments/517, 517)."
    )


def fetch_labs_page_metadata(code: str, session: requests.Session) -> Dict[str, Any]:
    url = f"{LIMITLESS_LABS_BASE_URL}/{code}/standings"
    soup, _ = get_soup(url, session)
    if not soup:
        return {}

    title = soup.find("title")
    og_title = soup.find("meta", attrs={"property": "og:title"})
    tournament_name = None
    if og_title and og_title.get("content"):
        tournament_name = og_title.get("content")
    elif title and title.text:
        tournament_name = title.text
    tournament_name = repair_text(tournament_name)
    if tournament_name:
        tournament_name = re.sub(r"\s+[–-]\s+Limitless Labs$", "", tournament_name, flags=re.IGNORECASE).strip()

    date_text = None
    players = None
    country = None

    # Header line has "Month Day–Day, Year • N players"
    for div in soup.find_all("div"):
        txt = div.get_text(" ", strip=True)
        if " players" in txt and re.search(r"\d{4}", txt):
            parts = [p.strip() for p in txt.split("•") if p.strip()]
            if parts:
                date_text = repair_text(parts[0])
            for part in parts:
                m = re.search(r"(\d+)\s+players", part, re.IGNORECASE)
                if m:
                    try:
                        players = int(m.group(1))
                    except Exception:
                        players = None
            break

    # Country from flag image title/alt near header if available.
    flag = soup.find("img", attrs={"title": True})
    if flag and flag.get("title") and len(flag.get("title")) <= 3:
        country = flag.get("title")

    return {
        "name": tournament_name,
        "dateText": repair_text(date_text),
        "players": players,
        "country": country,
        "sourceUrl": url,
    }


def fetch_labs_tournament(session: requests.Session, tournament_id: int) -> Dict[str, Any]:
    url = f"{LIMITLESS_MEW_BASE_URL}/tournament?id={tournament_id}&division={DIVISION}"
    payload = fetch_json_with_retries(session, url)
    if not payload or not payload.get("ok"):
        raise RuntimeError(f"Failed to fetch tournament metadata from {url}")
    message = payload.get("message")
    if not isinstance(message, dict):
        raise RuntimeError("Invalid tournament metadata payload")
    return message


def fetch_labs_standings(session: requests.Session, tournament_id: int) -> List[Dict[str, Any]]:
    url = f"{LIMITLESS_MEW_BASE_URL}/standings?tournamentId={tournament_id}&division={DIVISION}"
    payload = fetch_json_with_retries(session, url)
    if not payload or not payload.get("ok"):
        raise RuntimeError(f"Failed to fetch standings from {url}")
    message = payload.get("message")
    if not isinstance(message, list):
        raise RuntimeError("Invalid standings payload")
    return message


def fetch_player_decklist(session: requests.Session, tournament_id: int, tp_id: int) -> Optional[Dict[str, Any]]:
    url = f"{LIMITLESS_MEW_BASE_URL}/decklist?tournamentId={tournament_id}&playerId={tp_id}"
    payload = fetch_json_with_retries(session, url)
    if not payload or payload.get("ok") is not True:
        return None
    return payload.get("message")


def fetch_player_matches(session: requests.Session, tournament_id: int, tp_id: int) -> List[Dict[str, Any]]:
    url = f"{LIMITLESS_MEW_BASE_URL}/matches?tournamentId={tournament_id}&playerId={tp_id}"
    payload = fetch_json_with_retries(session, url)
    if not payload or payload.get("ok") is not True:
        return []
    message = payload.get("message")
    if not isinstance(message, list):
        return []
    return message


def canonicalize_variant(set_code: str, number: str):
    sc = (set_code or "").upper().strip()
    num = (number or "").lstrip("0")
    num = num.zfill(3) if num else num
    return sc, num


def generate_report_json(deck_list, deck_total, _all_decks_for_variants):
    card_data = defaultdict(list)
    name_casing = {}
    uid_meta = {}
    uid_category = {}

    for deck in deck_list:
        per_deck_counts = defaultdict(int)
        per_deck_seen_meta = {}

        for card in deck.get("cards", []):
            name = card.get("name", "")
            set_code = card.get("set", "")
            number = card.get("number", "")
            sc, num = canonicalize_variant(set_code, number)
            count = int(card.get("count", 0))
            if count <= 0:
                continue

            uid = f"{name}::{sc}::{num}" if sc and num else name
            per_deck_counts[uid] += count

            meta_payload = {
                "set": sc or None,
                "number": num or None,
                "category": (card.get("category") or "").lower() or None,
                "trainerType": card.get("trainerType"),
                "energyType": card.get("energyType"),
                "aceSpec": card.get("aceSpec"),
            }
            per_deck_seen_meta[uid] = meta_payload

            info = uid_category.setdefault(uid, {})
            for field in ("category", "trainerType", "energyType", "aceSpec"):
                value = meta_payload.get(field)
                if value and field not in info:
                    info[field] = value

            if uid not in name_casing:
                name_casing[uid] = uid.split("::", 1)[0] if "::" in uid else uid

        for uid, tot in per_deck_counts.items():
            card_data[uid].append(tot)
            meta_payload = per_deck_seen_meta.get(uid, uid_meta.get(uid, {})) or {}
            if "::" in uid:
                uid_meta[uid] = meta_payload
            elif meta_payload and uid not in uid_meta:
                uid_meta[uid] = meta_payload

    sorted_card_keys = sorted(card_data.keys(), key=lambda k: len(card_data[k]), reverse=True)

    report_items = []
    for rank, uid in enumerate(sorted_card_keys, 1):
        counts_list, found_count = card_data[uid], len(card_data[uid])
        dist_counter = Counter(counts_list)

        card_obj = {
            "rank": rank,
            "name": name_casing[uid],
            "found": found_count,
            "total": deck_total,
            "pct": round((found_count / deck_total) * 100, 2) if deck_total else 0,
            "dist": [
                {
                    "copies": c,
                    "players": p,
                    "percent": round((p / found_count) * 100, 2) if found_count else 0,
                }
                for c, p in sorted(dist_counter.items())
            ],
        }

        meta = uid_meta.get(uid) or {}
        if "::" in uid:
            card_obj["set"] = meta.get("set")
            card_obj["number"] = meta.get("number")
            card_obj["uid"] = uid

        category_info = uid_category.get(uid)
        base_category = None
        trainer_type = None
        energy_type = None
        ace_spec = False

        if isinstance(category_info, dict):
            base_category = category_info.get("category") or meta.get("category")
            trainer_type = category_info.get("trainerType") or meta.get("trainerType")
            energy_type = category_info.get("energyType") or meta.get("energyType")
            ace_spec = category_info.get("aceSpec") or meta.get("aceSpec") or False
        elif category_info:
            base_category = category_info
        else:
            base_category = meta.get("category")
            trainer_type = meta.get("trainerType")
            energy_type = meta.get("energyType")
            ace_spec = meta.get("aceSpec") or False

        if trainer_type:
            card_obj["trainerType"] = trainer_type
        if energy_type:
            card_obj["energyType"] = energy_type
        if ace_spec:
            card_obj["aceSpec"] = True

        slug = compose_category_path(base_category, trainer_type, energy_type, ace_spec)
        if slug:
            card_obj["category"] = slug
        elif base_category:
            card_obj["category"] = base_category

        report_items.append(card_obj)

    return {"deckTotal": deck_total, "items": report_items}


def generate_card_index(all_decks):
    deck_total = len(all_decks)
    card_data = defaultdict(list)
    sets_map = defaultdict(set)
    name_casing = {}

    for deck in all_decks:
        per_deck_counts = defaultdict(int)
        for card in deck.get("cards", []):
            name = card.get("name", "")
            set_code = card.get("set", "")
            base_key = name.lower()
            if base_key not in name_casing:
                name_casing[base_key] = name
            per_deck_counts[base_key] += int(card.get("count", 0))
            if set_code:
                sets_map[base_key].add(set_code)

        for base_key, total_copies in per_deck_counts.items():
            card_data[base_key].append(total_copies)

    index = {}
    for base_key, counts in card_data.items():
        found = len(counts)
        dist_counter = Counter(counts)
        index[name_casing[base_key]] = {
            "found": found,
            "total": deck_total,
            "pct": round((found / deck_total) * 100, 2) if deck_total else 0.0,
            "dist": [
                {
                    "copies": c,
                    "players": p,
                    "percent": round((p / found) * 100, 2) if found else 0.0,
                }
                for c, p in sorted(dist_counter.items())
            ],
            "sets": sorted(list(sets_map[base_key])) if sets_map[base_key] else [],
        }

    return {"deckTotal": deck_total, "cards": index}


def scrape_card_print_variations(session, set_code, number):
    print(f"  Checking print variations for {set_code}/{number}...")

    number_variants = build_number_variants(number)
    if not number_variants:
        return []

    headers = {"User-Agent": "Mozilla/5.0"}
    soup = None
    for variant in number_variants:
        url = f"{LIMITLESS_BASE_URL}/cards/{set_code}/{variant}"
        resp = request_with_retries(session, "GET", url, headers=headers, timeout=HTTP_TIMEOUT, retries=2)
        if not resp:
            print(f"    Warning: Could not fetch print variations from {url}")
            continue
        soup = BeautifulSoup(resp.text, "html.parser")
        table = soup.find("table", class_="card-prints-versions")
        if table:
            break
        soup = None

    if soup is None:
        return []

    table = soup.find("table", class_="card-prints-versions")
    if not table:
        return []

    variations = []
    in_jp_section = False

    for row in table.find_all("tr"):
        th = row.find("th")
        if th and "JP. Prints" in th.get_text():
            in_jp_section = True
            continue

        if in_jp_section or th:
            continue

        cells = row.find_all("td")
        if len(cells) < 2:
            continue

        first_cell = cells[0]
        number_elem = first_cell.find("span", class_="prints-table-card-number")
        if not number_elem:
            continue

        card_num = number_elem.get_text(strip=True).lstrip("#")
        set_name_elem = first_cell.find("a")
        set_acronym = None

        if set_name_elem:
            href = set_name_elem.get("href", "")
            if href:
                match = re.search(r"/cards/([A-Z0-9]+)/\d+", href)
                if match:
                    set_acronym = match.group(1)

        if not set_acronym:
            continue

        normalized_num = card_num.zfill(3)

        price_usd = None
        price_link = cells[1].find("a", class_="card-price") if len(cells) >= 2 else None
        if price_link:
            price_text = price_link.get_text(strip=True)
            price_match = re.search(r"\$?([\d.]+)", price_text)
            if price_match:
                try:
                    price_usd = float(price_match.group(1))
                except ValueError:
                    pass

        variations.append({"set": set_acronym, "number": normalized_num, "price_usd": price_usd})

    if variations:
        print(f"    Found {len(variations)} international print(s)")

    return variations


def choose_canonical_print(variations, card_name):
    if not variations:
        return None

    standard_legal_sets = {
        "MEG",
        "MEE",
        "MEP",
        "WHT",
        "BLK",
        "DRI",
        "JTG",
        "PRE",
        "SSP",
        "SCR",
        "SFA",
        "TWM",
        "TEF",
        "PAF",
        "PAR",
        "MEW",
        "M23",
        "OBF",
        "PAL",
        "SVE",
        "SVI",
        "SVP",
    }
    promo_sets = {"SVP", "MEP", "PRE", "M23", "PAF"}

    def sort_key(var):
        set_priority = 0 if var["set"] in standard_legal_sets else 1
        promo_priority = 1 if var["set"] in promo_sets else 0
        price = var.get("price_usd") or 999999
        card_num = int(var["number"]) if str(var["number"]).isdigit() else 999999
        return (set_priority, promo_priority, price, card_num)

    sorted_variations = sorted(variations, key=sort_key)
    canonical = sorted_variations[0]

    price_str = f"${canonical.get('price_usd', 'N/A')}" if canonical.get("price_usd") else "N/A"
    print(
        f"    {card_name}: Selected {canonical['set']}~{canonical['number']} ({price_str}) "
        f"from {len(variations)} prints"
    )

    return canonical


def generate_card_synonyms(all_decks, session, existing_synonyms=None, existing_canonicals=None):
    print("\nGenerating card synonyms from print variations...")

    synonyms_dict = dict(existing_synonyms) if existing_synonyms else {}
    canonicals_dict = dict(existing_canonicals) if existing_canonicals else {}

    if existing_synonyms:
        print(f"  Loaded {len(existing_synonyms)} existing synonyms")
    if existing_canonicals:
        print(f"  Loaded {len(existing_canonicals)} existing canonicals")

    unique_cards_by_name = {}
    card_uids_by_name = {}

    for deck in all_decks:
        for card in deck.get("cards", []):
            card_name = card.get("name", "").strip()
            if not card_name:
                continue

            set_code = (card.get("set", "") or "").upper().strip()
            number = normalize_card_number(card.get("number"))

            if set_code and number:
                if card_name not in card_uids_by_name:
                    card_uids_by_name[card_name] = set()
                card_uids_by_name[card_name].add(f"{set_code}::{number}")

                if card_name not in unique_cards_by_name:
                    unique_cards_by_name[card_name] = {
                        "name": card_name,
                        "set": set_code,
                        "number": number,
                    }

    total_cards = len(unique_cards_by_name)
    current = 0

    for card_name, card_info in unique_cards_by_name.items():
        current += 1
        if current % 10 == 0 or current == total_cards:
            print(f"  Progress: {current}/{total_cards} unique cards checked")

        variations = scrape_card_print_variations(session, card_info["set"], card_info["number"])

        if not variations or len(variations) < 2:
            continue

        canonical_var = choose_canonical_print(variations, card_name)
        if not canonical_var:
            continue

        canonical_uid = f"{card_name}::{canonical_var['set']}::{canonical_var['number']}"

        for var in variations:
            variant_uid = f"{card_name}::{var['set']}::{var['number']}"
            if variant_uid != canonical_uid:
                synonyms_dict[variant_uid] = canonical_uid

        if len(card_uids_by_name.get(card_name, set())) <= 1:
            canonicals_dict[card_name] = canonical_uid

    output = {
        "synonyms": synonyms_dict,
        "canonicals": canonicals_dict,
        "metadata": {
            "generated": datetime.now(timezone.utc).isoformat(),
            "totalSynonyms": len(synonyms_dict),
            "totalCanonicals": len(canonicals_dict),
            "description": "Card synonym mappings for handling reprints and alternate versions",
        },
    }

    print(
        f"\nSynonym generation complete: {len(canonicals_dict)} unique cards "
        f"with {len(synonyms_dict)} total variants"
    )
    return output


def determine_placement_tags(placing: Any, players: Any) -> List[str]:
    place = int(placing) if isinstance(placing, (int, float)) or str(placing).isdigit() else None
    field_size = int(players) if isinstance(players, (int, float)) or str(players).isdigit() else None
    if not place or not field_size or place <= 0 or field_size <= 1:
        return []

    tags: List[str] = []

    for rule in PLACEMENT_TAG_RULES:
        if field_size >= rule["minPlayers"] and place <= rule["maxPlacing"]:
            tags.append(rule["tag"])

    for rule in PERCENT_TAG_RULES:
        if field_size < rule["minPlayers"]:
            continue
        cutoff = max(1, int((field_size * rule["fraction"] + 0.999999999)))
        if place <= cutoff:
            tags.append(rule["tag"])

    return tags


def to_card_entries(decklist: Dict[str, Any], card_types_db: Dict[str, Any]) -> List[Dict[str, Any]]:
    if not isinstance(decklist, dict):
        return []

    cards: List[Dict[str, Any]] = []
    for section_name, entries in decklist.items():
        if not isinstance(entries, list):
            continue

        section = str(section_name or "").lower().strip()
        category = "trainer"
        if section == "pokemon":
            category = "pokemon"
        elif section == "energy":
            category = "energy"

        for item in entries:
            count = int(item.get("count") or 0)
            if count <= 0:
                continue
            set_code = str(item.get("set") or "").upper().strip()
            number = normalize_card_number(item.get("number"))
            card = {
                "count": count,
                "name": str(item.get("name") or "Unknown Card").strip(),
                "set": set_code,
                "number": number,
                "category": category,
            }
            cards.append(enrich_card_entry(card, card_types_db))

    return cards


def build_deck_hash(cards: List[Dict[str, Any]]) -> str:
    canonical_card_list = sorted(
        [f"{c.get('count', 0)}x{c.get('name', '')}{c.get('set', '')}{c.get('number', '')}" for c in cards]
    )
    return hashlib.sha1(json.dumps(canonical_card_list).encode("utf-8")).hexdigest()


def extract_player_outcome(player_tp_id: int, match_row: Dict[str, Any]) -> str:
    p1_id = match_row.get("p1_id")
    p2_id = match_row.get("p2_id")
    winner = match_row.get("winner")

    if p2_id is None or p1_id is None:
        if winner == player_tp_id:
            return "bye"
        if winner == -1:
            return "unpaired"
        if winner == 0:
            return "tie"
        return "unknown"

    if winner == 0:
        return "tie"
    if winner == -1:
        return "double_loss"
    if winner == player_tp_id:
        return "win"
    if winner == p1_id or winner == p2_id:
        return "loss"
    return "unknown"


def canonical_match_key(match_row: Dict[str, Any]) -> Optional[str]:
    round_num = match_row.get("round")
    phase = match_row.get("phase") or 0
    p1_id = match_row.get("p1_id")
    p2_id = match_row.get("p2_id")

    if round_num is None or p1_id is None:
        return None

    if p2_id is None:
        return f"r{round_num}:p{phase}:solo:{p1_id}"

    lo = min(p1_id, p2_id)
    hi = max(p1_id, p2_id)
    return f"r{round_num}:p{phase}:{lo}:{hi}"


def derive_canonical_outcome(match_row: Dict[str, Any]) -> Tuple[str, Optional[str], Optional[str]]:
    p1_id = match_row.get("p1_id")
    p2_id = match_row.get("p2_id")
    winner = match_row.get("winner")

    if p2_id is None:
        if winner == p1_id:
            return "bye", "bye", None
        if winner == -1:
            return "unpaired", "unpaired", None
        if winner == 0:
            return "tie", "tie", None
        return "unknown", "unknown", None

    if winner == 0:
        return "tie", "tie", "tie"
    if winner == -1:
        return "double_loss", "double_loss", "double_loss"
    if winner == p1_id:
        return "decided", "win", "loss"
    if winner == p2_id:
        return "decided", "loss", "win"
    return "unknown", "unknown", "unknown"


def calculate_player_quality(player_row: Dict[str, Any], tournament_players: int) -> float:
    topcut = 1 if int(player_row.get("topcut") or 0) == 1 else 0
    day2 = 1 if int(player_row.get("day2") or 0) == 1 else 0
    placement = player_row.get("placement")

    tier_base = 1.0 if topcut else (0.7 if day2 else 0.4)

    placement_percentile = 0.0
    if placement is not None and str(placement).isdigit() and tournament_players > 0:
        p = int(placement)
        placement_percentile = max(0.0, min(1.0, (tournament_players - p + 1) / tournament_players))

    return tier_base + 0.3 * placement_percentile


def ensure_archetype(value: Optional[str]) -> str:
    v = (value or "").strip()
    return v if v else "Unknown"


def aggregate_matchups(
    canonical_matches: List[Dict[str, Any]],
    participants_by_tp_id: Dict[int, Dict[str, Any]],
    decks_by_tp_id: Dict[int, Dict[str, Any]],
    tournament_players: int,
):
    def init_profile(name: str):
        return {
            "name": name,
            "matchesConsidered": 0,
            "weightedMatches": 0.0,
            "byArchetypePair": {},
            "byArchetype": {},
        }

    profiles = {
        "all": init_profile("all"),
        "phaseWeighted": init_profile("phaseWeighted"),
        "qualityWeighted": init_profile("qualityWeighted"),
    }

    def add_side_totals(profile_dict, archetype: str, weight: float, result: str):
        entry = profile_dict["byArchetype"].setdefault(
            archetype,
            {
                "archetype": archetype,
                "matches": 0,
                "weightedMatches": 0.0,
                "weightedWins": 0.0,
                "weightedLosses": 0.0,
                "weightedTies": 0.0,
            },
        )
        entry["matches"] += 1
        entry["weightedMatches"] += weight
        if result == "win":
            entry["weightedWins"] += weight
        elif result == "loss":
            entry["weightedLosses"] += weight
        elif result == "tie":
            entry["weightedTies"] += weight

    for match in canonical_matches:
        p1_id = match.get("player1Id")
        p2_id = match.get("player2Id")
        if p1_id is None or p2_id is None:
            continue

        deck1 = decks_by_tp_id.get(int(p1_id))
        deck2 = decks_by_tp_id.get(int(p2_id))
        if not deck1 or not deck2:
            continue

        arch1 = ensure_archetype(deck1.get("archetype"))
        arch2 = ensure_archetype(deck2.get("archetype"))
        if arch1 == "Unknown" or arch2 == "Unknown":
            continue

        outcome = match.get("outcomeType")
        r1 = match.get("player1Result")
        r2 = match.get("player2Result")
        if outcome not in {"decided", "tie", "double_loss"}:
            continue

        phase = int(match.get("phase") or 1)
        phase_mult = PHASE_MULTIPLIERS.get(phase, 1.0)

        p1_row = participants_by_tp_id.get(int(p1_id), {})
        p2_row = participants_by_tp_id.get(int(p2_id), {})
        q1 = calculate_player_quality(p1_row, tournament_players)
        q2 = calculate_player_quality(p2_row, tournament_players)
        quality_mult = phase_mult * ((q1 + q2) / 2.0)

        weight_map = {
            "all": 1.0,
            "phaseWeighted": phase_mult,
            "qualityWeighted": quality_mult,
        }

        left_arch, right_arch = sorted([arch1, arch2])
        same_order = arch1 == left_arch

        for profile_key, weight in weight_map.items():
            profile = profiles[profile_key]
            profile["matchesConsidered"] += 1
            profile["weightedMatches"] += weight

            pair_key = f"{left_arch}||{right_arch}"
            pair_entry = profile["byArchetypePair"].setdefault(
                pair_key,
                {
                    "archetypeA": left_arch,
                    "archetypeB": right_arch,
                    "matches": 0,
                    "weightedMatches": 0.0,
                    "winsA": 0.0,
                    "winsB": 0.0,
                    "ties": 0,
                    "doubleLosses": 0,
                    "weightedWinsA": 0.0,
                    "weightedWinsB": 0.0,
                    "weightedTies": 0.0,
                },
            )
            pair_entry["matches"] += 1
            pair_entry["weightedMatches"] += weight

            left_result = r1 if same_order else r2
            right_result = r2 if same_order else r1

            if outcome == "tie":
                pair_entry["ties"] += 1
                pair_entry["winsA"] += 0.5
                pair_entry["winsB"] += 0.5
                pair_entry["weightedWinsA"] += 0.5 * weight
                pair_entry["weightedWinsB"] += 0.5 * weight
                pair_entry["weightedTies"] += weight
            elif outcome == "double_loss":
                pair_entry["doubleLosses"] += 1
            else:
                if left_result == "win":
                    pair_entry["winsA"] += 1
                    pair_entry["weightedWinsA"] += weight
                elif left_result == "loss":
                    pair_entry["winsB"] += 1
                    pair_entry["weightedWinsB"] += weight

            if r1 in {"win", "loss", "tie"}:
                add_side_totals(profile, arch1, weight, r1)
            if r2 in {"win", "loss", "tie"}:
                add_side_totals(profile, arch2, weight, r2)

    for profile in profiles.values():
        profile["weightedMatches"] = round(profile["weightedMatches"], 6)

        pair_rows = []
        for pair in profile["byArchetypePair"].values():
            wm = pair["weightedMatches"]
            pair["weightedMatches"] = round(wm, 6)
            pair["weightedWinsA"] = round(pair["weightedWinsA"], 6)
            pair["weightedWinsB"] = round(pair["weightedWinsB"], 6)
            pair["weightedTies"] = round(pair["weightedTies"], 6)
            pair["weightedWinRateA"] = round((pair["weightedWinsA"] / wm) * 100, 3) if wm > 0 else 0
            pair["weightedWinRateB"] = round((pair["weightedWinsB"] / wm) * 100, 3) if wm > 0 else 0
            pair_rows.append(pair)

        archetype_rows = []
        for arc in profile["byArchetype"].values():
            wm = arc["weightedMatches"]
            arc["weightedMatches"] = round(wm, 6)
            arc["weightedWins"] = round(arc["weightedWins"], 6)
            arc["weightedLosses"] = round(arc["weightedLosses"], 6)
            arc["weightedTies"] = round(arc["weightedTies"], 6)
            arc["weightedWinRate"] = round((arc["weightedWins"] / wm) * 100, 3) if wm > 0 else 0
            archetype_rows.append(arc)

        pair_rows.sort(key=lambda item: (-item["weightedMatches"], item["archetypeA"], item["archetypeB"]))
        archetype_rows.sort(key=lambda item: (-item["weightedMatches"], item["archetype"]))

        profile["byArchetypePair"] = pair_rows
        profile["byArchetype"] = archetype_rows

    return profiles


def build_archetype_reports(decks: List[Dict[str, Any]]):
    archetype_groups = defaultdict(list)
    archetype_casing = {}

    for deck in decks:
        norm_name = normalize_archetype_name(ensure_archetype(deck.get("archetype")))
        archetype_groups[norm_name].append(deck)
        if norm_name not in archetype_casing:
            archetype_casing[norm_name] = ensure_archetype(deck.get("archetype"))

    deck_total = len(decks)
    archetype_data_map = {}
    archetype_index_list = []

    for norm_name, deck_list in archetype_groups.items():
        proper_name = archetype_casing[norm_name]
        base_name = sanitize_for_filename(proper_name)
        cards_report = generate_report_json(deck_list, len(deck_list), decks)
        archetype_data_map[base_name] = {"cards": cards_report, "decks": deck_list}
        archetype_index_list.append(
            {
                "name": base_name,
                "label": proper_name,
                "deckCount": len(deck_list),
                "percent": round((len(deck_list) / deck_total) * 100, 4) if deck_total else 0,
                "thumbnails": [],
            }
        )

    archetype_index_list.sort(key=lambda item: (-item["deckCount"], item["label"]))
    return archetype_data_map, archetype_index_list


def upload_to_r2(r2_client, bucket_name, key, data):
    if LOCAL_EXPORT_DIR:
        local_path = Path(LOCAL_EXPORT_DIR) / key
        local_path.parent.mkdir(parents=True, exist_ok=True)
        with local_path.open("w", encoding="utf-8") as handle:
            json.dump(data, handle, indent=2)
            handle.write("\n")
        print(f"  Saved {local_path}")
        return

    print(f"  Uploading {key}...")
    r2_client.put_object(
        Bucket=bucket_name,
        Key=key,
        Body=json.dumps(data, indent=2),
        ContentType="application/json",
    )


def upload_binary_to_r2(r2_client, bucket_name, key, data: bytes, content_type: str):
    if LOCAL_EXPORT_DIR:
        local_path = Path(LOCAL_EXPORT_DIR) / key
        local_path.parent.mkdir(parents=True, exist_ok=True)
        local_path.write_bytes(data)
        print(f"  Saved {local_path}")
        return

    print(f"  Uploading {key}...")
    r2_client.put_object(
        Bucket=bucket_name,
        Key=key,
        Body=data,
        ContentType=content_type,
    )


def update_tournaments_json(r2_client, bucket_name, tournament_name):
    if LOCAL_EXPORT_DIR:
        print("Skipping tournaments.json update (local export mode)")
        return

    tournaments_key = "reports/tournaments.json"
    try:
        print(f"Downloading existing {tournaments_key}...")
        response = r2_client.get_object(Bucket=bucket_name, Key=tournaments_key)
        existing = json.loads(response["Body"].read().decode("utf-8"))
    except r2_client.exceptions.NoSuchKey:
        print(f"  {tournaments_key} not found, creating new list")
        existing = []
    except Exception as e:
        print(f"  Warning: Could not read {tournaments_key}: {e}")
        existing = []

    existing = [x for x in existing if x != tournament_name]
    updated = [tournament_name] + existing
    meta_map = build_tournament_meta_map(r2_client, bucket_name, updated)
    updated = sort_tournament_names_by_recency(updated, meta_map)

    print(f"  Uploading updated {tournaments_key}...")
    r2_client.put_object(
        Bucket=bucket_name,
        Key=tournaments_key,
        Body=json.dumps(updated, indent=2),
        ContentType="application/json",
    )
    print(f"  ✓ Added '{tournament_name}' to tournaments.json")


def build_slice_payloads(base_path: str, slice_name: str, decks: List[Dict[str, Any]], r2_client, bucket_name):
    slice_path = f"{base_path}/slices/{slice_name}"
    master = generate_report_json(decks, len(decks), decks)
    card_index = generate_card_index(decks)
    archetype_data_map, archetype_index = build_archetype_reports(decks)

    upload_to_r2(r2_client, bucket_name, f"{slice_path}/decks.json", decks)
    upload_to_r2(r2_client, bucket_name, f"{slice_path}/master.json", master)
    upload_to_r2(r2_client, bucket_name, f"{slice_path}/cardIndex.json", card_index)
    upload_to_r2(r2_client, bucket_name, f"{slice_path}/archetypes/index.json", archetype_index)

    for archetype_base, payload in archetype_data_map.items():
        upload_to_r2(r2_client, bucket_name, f"{slice_path}/archetypes/{archetype_base}/cards.json", payload["cards"])
        upload_to_r2(r2_client, bucket_name, f"{slice_path}/archetypes/{archetype_base}/decks.json", payload["decks"])


def build_card_uid(card: Dict[str, Any]) -> str:
    name = str(card.get("name") or "Unknown Card").strip()
    set_code = str(card.get("set") or "").strip().upper()
    number = normalize_card_number(card.get("number"))
    if set_code and number:
        return f"{name}::{set_code}::{number}"
    return name


def to_int(value: Any) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    text = str(value).strip()
    if not text:
        return None
    try:
        return int(float(text))
    except Exception:
        return None


def to_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if not text:
        return None
    try:
        return float(text)
    except Exception:
        return None


def bool_to_int(value: Any) -> int:
    return 1 if bool(value) else 0


def build_tournament_sqlite_bytes(
    all_decks: List[Dict[str, Any]],
    master_report: Dict[str, Any],
    participants: List[Dict[str, Any]],
    player_matches: List[Dict[str, Any]],
    canonical_matches: List[Dict[str, Any]],
    matchup_profiles: Dict[str, Any],
    metadata: Dict[str, Any],
    labs_code: str,
) -> bytes:
    db_path = None
    conn = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as handle:
            db_path = handle.name

        conn = sqlite3.connect(db_path)
        conn.execute("PRAGMA journal_mode=DELETE;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        conn.execute("PRAGMA temp_store=MEMORY;")
        cur = conn.cursor()

        cur.executescript(
            """
            CREATE TABLE decks (
              id TEXT PRIMARY KEY,
              player TEXT,
              player_id TEXT,
              country TEXT,
              placement INTEGER,
              archetype TEXT,
              archetype_id TEXT,
              tournament_id TEXT,
              made_phase2 INTEGER,
              made_topcut INTEGER
            );

            CREATE TABLE deck_cards (
              deck_id TEXT NOT NULL,
              card_uid TEXT NOT NULL,
              card_name TEXT NOT NULL,
              card_set TEXT,
              card_number TEXT,
              count INTEGER NOT NULL,
              category TEXT,
              trainer_type TEXT,
              energy_type TEXT,
              ace_spec INTEGER DEFAULT 0,
              regulation_mark TEXT
            );

            CREATE TABLE card_stats (
              card_uid TEXT PRIMARY KEY,
              card_name TEXT NOT NULL,
              card_set TEXT,
              card_number TEXT,
              category TEXT,
              trainer_type TEXT,
              energy_type TEXT,
              ace_spec INTEGER DEFAULT 0,
              rank INTEGER NOT NULL,
              found INTEGER NOT NULL,
              total INTEGER NOT NULL,
              pct REAL NOT NULL
            );

            CREATE TABLE card_distributions (
              card_uid TEXT NOT NULL,
              copies INTEGER NOT NULL,
              players INTEGER NOT NULL,
              percent REAL NOT NULL
            );

            CREATE TABLE success_tags (
              deck_id TEXT NOT NULL,
              tag TEXT NOT NULL
            );

            CREATE TABLE db_metadata (
              key TEXT PRIMARY KEY,
              value TEXT
            );

            CREATE TABLE participants (
              tp_id INTEGER PRIMARY KEY,
              player_id TEXT,
              name TEXT NOT NULL,
              country TEXT,
              placement INTEGER,
              points INTEGER,
              wins INTEGER,
              losses INTEGER,
              ties INTEGER,
              opw REAL,
              oopw REAL,
              made_phase2 INTEGER,
              made_topcut INTEGER,
              decklist_published INTEGER,
              deck_id TEXT,
              deck_name TEXT,
              icons TEXT,
              drop_round INTEGER,
              dropped INTEGER,
              dqed INTEGER,
              late INTEGER
            );

            CREATE TABLE player_matches (
              id TEXT PRIMARY KEY,
              player_id INTEGER,
              player_name TEXT,
              opponent_id INTEGER,
              opponent_name TEXT,
              opponent_country TEXT,
              opponent_archetype TEXT,
              player_archetype TEXT,
              round INTEGER,
              phase INTEGER,
              table_no INTEGER,
              completed INTEGER,
              winner_code INTEGER,
              outcome TEXT,
              made_phase2 INTEGER,
              made_topcut INTEGER
            );

            CREATE TABLE matches (
              id TEXT PRIMARY KEY,
              match_key TEXT UNIQUE,
              round INTEGER,
              phase INTEGER,
              table_no INTEGER,
              completed INTEGER,
              player1_id INTEGER,
              player2_id INTEGER,
              winner_code INTEGER,
              winner INTEGER,
              outcome_type TEXT,
              player1_result TEXT,
              player2_result TEXT,
              player1_name TEXT,
              player2_name TEXT,
              player1_country TEXT,
              player2_country TEXT,
              player1_archetype TEXT,
              player2_archetype TEXT,
              player1_made_phase2 INTEGER,
              player1_made_topcut INTEGER,
              player2_made_phase2 INTEGER,
              player2_made_topcut INTEGER
            );

            CREATE TABLE matchup_pair_profiles (
              profile_name TEXT NOT NULL,
              archetype_a TEXT NOT NULL,
              archetype_b TEXT NOT NULL,
              matches INTEGER NOT NULL,
              weighted_matches REAL NOT NULL,
              wins_a REAL NOT NULL,
              wins_b REAL NOT NULL,
              ties INTEGER NOT NULL,
              double_losses INTEGER NOT NULL,
              weighted_wins_a REAL NOT NULL,
              weighted_wins_b REAL NOT NULL,
              weighted_ties REAL NOT NULL,
              weighted_win_rate_a REAL,
              weighted_win_rate_b REAL,
              PRIMARY KEY (profile_name, archetype_a, archetype_b)
            );

            CREATE TABLE matchup_archetype_profiles (
              profile_name TEXT NOT NULL,
              archetype TEXT NOT NULL,
              matches INTEGER NOT NULL,
              weighted_matches REAL NOT NULL,
              weighted_wins REAL NOT NULL,
              weighted_losses REAL NOT NULL,
              weighted_ties REAL NOT NULL,
              weighted_win_rate REAL,
              PRIMARY KEY (profile_name, archetype)
            );

            CREATE INDEX idx_decks_archetype ON decks(archetype);
            CREATE INDEX idx_decks_placement ON decks(placement);
            CREATE INDEX idx_deck_cards_deck_id ON deck_cards(deck_id);
            CREATE INDEX idx_deck_cards_card_uid ON deck_cards(card_uid);
            CREATE INDEX idx_card_distributions_uid ON card_distributions(card_uid);
            CREATE INDEX idx_success_tags_deck_id ON success_tags(deck_id);
            CREATE INDEX idx_success_tags_tag ON success_tags(tag);
            CREATE INDEX idx_participants_placement ON participants(placement);
            CREATE INDEX idx_player_matches_player_round ON player_matches(player_id, round);
            CREATE INDEX idx_matches_round_table ON matches(round, table_no);
            """
        )

        seen_ids = set()
        for index, deck in enumerate(all_decks):
            deck_id = str(deck.get("id") or f"deck-{index}")
            if deck_id in seen_ids:
                deck_id = f"{deck_id}-{index}"
            seen_ids.add(deck_id)

            cur.execute(
                """
                INSERT INTO decks (
                  id, player, player_id, country, placement, archetype, archetype_id, tournament_id, made_phase2, made_topcut
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    deck_id,
                    deck.get("player"),
                    deck.get("playerId"),
                    deck.get("country"),
                    to_int(deck.get("placement")),
                    deck.get("archetype"),
                    deck.get("archetypeId"),
                    deck.get("tournamentId"),
                    bool_to_int(deck.get("madePhase2")),
                    bool_to_int(deck.get("madeTopCut")),
                ),
            )

            for tag in deck.get("successTags") or []:
                cur.execute("INSERT INTO success_tags (deck_id, tag) VALUES (?, ?)", (deck_id, str(tag)))

            for card in deck.get("cards") or []:
                cur.execute(
                    """
                    INSERT INTO deck_cards (
                      deck_id, card_uid, card_name, card_set, card_number, count, category, trainer_type, energy_type, ace_spec, regulation_mark
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        deck_id,
                        build_card_uid(card),
                        card.get("name"),
                        (card.get("set") or "").upper() or None,
                        normalize_card_number(card.get("number")),
                        to_int(card.get("count")) or 0,
                        card.get("category"),
                        card.get("trainerType"),
                        card.get("energyType"),
                        bool_to_int(card.get("aceSpec")),
                        card.get("regulationMark"),
                    ),
                )

        for item in master_report.get("items") or []:
            uid = item.get("uid") or build_card_uid(item)
            cur.execute(
                """
                INSERT INTO card_stats (
                  card_uid, card_name, card_set, card_number, category, trainer_type, energy_type, ace_spec, rank, found, total, pct
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    uid,
                    item.get("name"),
                    item.get("set"),
                    normalize_card_number(item.get("number")),
                    item.get("category"),
                    item.get("trainerType"),
                    item.get("energyType"),
                    bool_to_int(item.get("aceSpec")),
                    to_int(item.get("rank")) or 0,
                    to_int(item.get("found")) or 0,
                    to_int(item.get("total")) or 0,
                    to_float(item.get("pct")) or 0.0,
                ),
            )
            for dist in item.get("dist") or []:
                cur.execute(
                    "INSERT INTO card_distributions (card_uid, copies, players, percent) VALUES (?, ?, ?, ?)",
                    (
                        uid,
                        to_int(dist.get("copies")) or 0,
                        to_int(dist.get("players")) or 0,
                        to_float(dist.get("percent")) or 0.0,
                    ),
                )

        for participant in participants:
            cur.execute(
                """
                INSERT INTO participants (
                  tp_id, player_id, name, country, placement, points, wins, losses, ties, opw, oopw, made_phase2, made_topcut,
                  decklist_published, deck_id, deck_name, icons, drop_round, dropped, dqed, late
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    to_int(participant.get("tpId")) or 0,
                    str(participant.get("playerId")) if participant.get("playerId") is not None else None,
                    participant.get("name"),
                    participant.get("country"),
                    to_int(participant.get("placement")),
                    to_int(participant.get("points")),
                    to_int(participant.get("wins")),
                    to_int(participant.get("losses")),
                    to_int(participant.get("ties")),
                    to_float(participant.get("opw")),
                    to_float(participant.get("oopw")),
                    bool_to_int(participant.get("madePhase2")),
                    bool_to_int(participant.get("madeTopCut")),
                    bool_to_int(participant.get("decklistPublished")),
                    str(participant.get("deckId")) if participant.get("deckId") is not None else None,
                    participant.get("deckName"),
                    participant.get("icons"),
                    to_int(participant.get("dropRound")),
                    bool_to_int(participant.get("dropped")),
                    bool_to_int(participant.get("dqed")),
                    bool_to_int(participant.get("late")),
                ),
            )

        for player_match in player_matches:
            cur.execute(
                """
                INSERT INTO player_matches (
                  id, player_id, player_name, opponent_id, opponent_name, opponent_country, opponent_archetype, player_archetype,
                  round, phase, table_no, completed, winner_code, outcome, made_phase2, made_topcut
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    player_match.get("id"),
                    to_int(player_match.get("playerId")),
                    player_match.get("playerName"),
                    to_int(player_match.get("opponentId")),
                    player_match.get("opponentName"),
                    player_match.get("opponentCountry"),
                    player_match.get("opponentArchetype"),
                    player_match.get("playerArchetype"),
                    to_int(player_match.get("round")) or 0,
                    to_int(player_match.get("phase")),
                    to_int(player_match.get("table")),
                    bool_to_int(player_match.get("completed")),
                    to_int(player_match.get("winnerCode")),
                    player_match.get("outcome"),
                    bool_to_int(player_match.get("madePhase2")),
                    bool_to_int(player_match.get("madeTopCut")),
                ),
            )

        for match in canonical_matches:
            cur.execute(
                """
                INSERT INTO matches (
                  id, match_key, round, phase, table_no, completed, player1_id, player2_id, winner_code, winner, outcome_type,
                  player1_result, player2_result, player1_name, player2_name, player1_country, player2_country,
                  player1_archetype, player2_archetype, player1_made_phase2, player1_made_topcut, player2_made_phase2, player2_made_topcut
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    match.get("id"),
                    match.get("key"),
                    to_int(match.get("round")) or 0,
                    to_int(match.get("phase")),
                    to_int(match.get("table")),
                    bool_to_int(match.get("completed")),
                    to_int(match.get("player1Id")),
                    to_int(match.get("player2Id")),
                    to_int(match.get("winnerCode")),
                    to_int(match.get("winner")),
                    match.get("outcomeType"),
                    match.get("player1Result"),
                    match.get("player2Result"),
                    match.get("player1Name"),
                    match.get("player2Name"),
                    match.get("player1Country"),
                    match.get("player2Country"),
                    match.get("player1Archetype"),
                    match.get("player2Archetype"),
                    bool_to_int(match.get("player1MadePhase2")),
                    bool_to_int(match.get("player1MadeTopCut")),
                    bool_to_int(match.get("player2MadePhase2")),
                    bool_to_int(match.get("player2MadeTopCut")),
                ),
            )

        profiles = matchup_profiles.get("profiles") or {}
        for profile_name, profile in profiles.items():
            for pair in profile.get("byArchetypePair") or []:
                cur.execute(
                    """
                    INSERT INTO matchup_pair_profiles (
                      profile_name, archetype_a, archetype_b, matches, weighted_matches, wins_a, wins_b, ties, double_losses,
                      weighted_wins_a, weighted_wins_b, weighted_ties, weighted_win_rate_a, weighted_win_rate_b
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        profile_name,
                        pair.get("archetypeA"),
                        pair.get("archetypeB"),
                        to_int(pair.get("matches")) or 0,
                        to_float(pair.get("weightedMatches")) or 0.0,
                        to_float(pair.get("winsA")) or 0.0,
                        to_float(pair.get("winsB")) or 0.0,
                        to_int(pair.get("ties")) or 0,
                        to_int(pair.get("doubleLosses")) or 0,
                        to_float(pair.get("weightedWinsA")) or 0.0,
                        to_float(pair.get("weightedWinsB")) or 0.0,
                        to_float(pair.get("weightedTies")) or 0.0,
                        to_float(pair.get("weightedWinRateA")),
                        to_float(pair.get("weightedWinRateB")),
                    ),
                )
            for archetype_row in profile.get("byArchetype") or []:
                cur.execute(
                    """
                    INSERT INTO matchup_archetype_profiles (
                      profile_name, archetype, matches, weighted_matches, weighted_wins, weighted_losses, weighted_ties, weighted_win_rate
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        profile_name,
                        archetype_row.get("archetype"),
                        to_int(archetype_row.get("matches")) or 0,
                        to_float(archetype_row.get("weightedMatches")) or 0.0,
                        to_float(archetype_row.get("weightedWins")) or 0.0,
                        to_float(archetype_row.get("weightedLosses")) or 0.0,
                        to_float(archetype_row.get("weightedTies")) or 0.0,
                        to_float(archetype_row.get("weightedWinRate")),
                    ),
                )

        metadata_rows = [
            ("schema_version", "2.0"),
            ("report_version", str(metadata.get("reportVersion") or REPORT_VERSION)),
            ("generated_at", str(metadata.get("fetchedAt") or datetime.now(timezone.utc).isoformat())),
            ("tournament_id", str(metadata.get("tournamentId") or "")),
            ("labs_code", str(labs_code)),
            ("tournament_name", str(metadata.get("name") or "")),
            ("total_decks", str(len(all_decks))),
            ("total_participants", str(len(participants))),
            ("total_player_matches", str(len(player_matches))),
            ("total_matches", str(len(canonical_matches))),
        ]
        cur.executemany("INSERT INTO db_metadata (key, value) VALUES (?, ?)", metadata_rows)

        conn.commit()
        conn.close()
        conn = None
        data = Path(db_path).read_bytes()
        return data
    finally:
        if conn is not None:
            conn.close()
        if db_path:
            try:
                os.unlink(db_path)
            except FileNotFoundError:
                pass


def main():
    tournament_input = os.environ.get("LIMITLESS_INPUT") or os.environ.get("LIMITLESS_URL")
    anonymize = os.environ.get("ANONYMIZE", "false").lower() == "true"
    generate_tournament_synonyms = parse_bool_env("GENERATE_TOURNAMENT_SYNONYMS", False)
    write_tournament_db = parse_bool_env("WRITE_TOURNAMENT_DB", True)
    rebuild_tournaments_only = parse_bool_env("REBUILD_TOURNAMENTS_JSON_ONLY", False)

    r2_account_id = os.environ.get("R2_ACCOUNT_ID")
    r2_access_key_id = os.environ.get("R2_ACCESS_KEY_ID")
    r2_secret_access_key = os.environ.get("R2_SECRET_ACCESS_KEY")
    r2_bucket_name = os.environ.get("R2_BUCKET_NAME", "ciphermaniac-reports")

    if not tournament_input and not rebuild_tournaments_only:
        print("Error: LIMITLESS_INPUT (or LIMITLESS_URL) environment variable not set")
        sys.exit(1)

    if LOCAL_EXPORT_DIR:
        print(f"Local export mode enabled (output -> {LOCAL_EXPORT_DIR})")
        r2_client = None
    else:
        if not all([r2_account_id, r2_access_key_id, r2_secret_access_key]):
            print("Error: R2 credentials not set")
            sys.exit(1)

        r2_client = boto3.client(
            "s3",
            endpoint_url=f"https://{r2_account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=r2_access_key_id,
            aws_secret_access_key=r2_secret_access_key,
            region_name="auto",
        )

    if rebuild_tournaments_only:
        if not r2_client:
            print("Error: R2 client is required to rebuild tournaments.json")
            sys.exit(1)
        print("Rebuilding tournaments.json from existing report folders...")
        rebuilt = rebuild_tournaments_json_from_reports(r2_client, r2_bucket_name)
        print(f"✓ Rebuilt tournaments.json with {len(rebuilt)} entries")
        return

    card_types_db = load_card_types_database(r2_client, r2_bucket_name)
    existing_synonyms, existing_canonicals = {}, {}
    if generate_tournament_synonyms:
        existing_synonyms, existing_canonicals = load_existing_canonicals(r2_client, r2_bucket_name)

    session = requests.Session()

    try:
        labs_code, source_url, mapped_limitless_url = resolve_reference_to_labs_code(tournament_input, session)
    except Exception as exc:
        print(f"Error resolving tournament input '{tournament_input}': {exc}")
        sys.exit(1)

    tournament_id = int(labs_code)
    print(f"Resolved tournament input '{tournament_input}' -> Labs code {labs_code} (ID {tournament_id})")

    labs_page_meta = fetch_labs_page_metadata(labs_code, session)
    tournament_meta = fetch_labs_tournament(session, tournament_id)
    standings = fetch_labs_standings(session, tournament_id)

    # Build tournament metadata
    tournament_name = repair_text(tournament_meta.get("name")) or labs_page_meta.get("name") or f"Tournament {labs_code}"
    date_text = repair_text(tournament_meta.get("date")) or labs_page_meta.get("dateText") or ""
    tournament_name = repair_text(tournament_name) or f"Tournament {labs_code}"
    start_date_iso, start_date_text = parse_start_date(date_text)
    players_total = int(tournament_meta.get("players") or labs_page_meta.get("players") or len(standings) or 0)

    metadata = {
        "name": tournament_name,
        "sourceUrl": source_url,
        "sourceUrlInput": tournament_input,
        "sourceLimitlessUrl": mapped_limitless_url,
        "labsCode": labs_code,
        "tournamentId": tournament_id,
        "division": DIVISION,
        "date": date_text,
        "format": None,
        "players": players_total,
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "reportVersion": REPORT_VERSION,
        "startDate": start_date_iso,
        "startDateText": start_date_text,
        "country": labs_page_meta.get("country") or tournament_meta.get("country"),
        "city": tournament_meta.get("city"),
        "type": tournament_meta.get("type"),
        "updatedAt": tournament_meta.get("updated_at"),
        "completed": tournament_meta.get("completed"),
        "started": tournament_meta.get("started"),
        "playersRound1": tournament_meta.get("players_r1"),
        "decklists": tournament_meta.get("decklists"),
        "rk9Id": tournament_meta.get("rk9_id"),
        "playlatamId": tournament_meta.get("playlatam_id"),
    }

    # Build full participant table from standings
    participants = []
    standings_by_tp_id: Dict[int, Dict[str, Any]] = {}
    for row in standings:
        tp_id = row.get("tp_id")
        if tp_id is None:
            continue
        tp_id = int(tp_id)
        standings_by_tp_id[tp_id] = row
        participants.append(
            {
                "tpId": tp_id,
                "playerId": row.get("player_id"),
                "name": anonymize_name(str(row.get("name") or "Unknown Player"), anonymize),
                "country": row.get("country"),
                "placement": row.get("placement"),
                "points": row.get("points"),
                "wins": row.get("wins"),
                "losses": row.get("losses"),
                "ties": row.get("ties"),
                "opw": row.get("opw"),
                "oopw": row.get("opw2"),
                "madePhase2": int(row.get("day2") or 0) == 1,
                "madeTopCut": int(row.get("topcut") or 0) == 1,
                "decklistPublished": int(row.get("decklist") or 0) == 1,
                "deckId": row.get("deck_id"),
                "deckName": row.get("deck_name"),
                "icons": row.get("icons"),
                "dropRound": row.get("drop_round"),
                "dropped": int(row.get("dropped") or 0) == 1,
                "dqed": int(row.get("dqed") or 0) == 1,
                "late": int(row.get("late") or 0) == 1,
            }
        )

    participants.sort(key=lambda item: (item.get("placement") is None, item.get("placement") or 999999, item["name"]))

    decklist_rows = [row for row in standings if int(row.get("decklist") or 0) == 1 and row.get("tp_id") is not None]

    print(f"Fetched standings: {len(standings)} players")
    print(f"Decklist players to process: {len(decklist_rows)}")

    # Concurrently fetch decklists + matches for decklist players
    fetched_player_payloads = {}

    def fetch_player_payload(row):
        tp_id = int(row.get("tp_id"))
        decklist = fetch_player_decklist(session, tournament_id, tp_id)
        matches = fetch_player_matches(session, tournament_id, tp_id)
        return tp_id, decklist, matches

    with ThreadPoolExecutor(max_workers=max(1, FETCH_CONCURRENCY)) as executor:
        futures = {executor.submit(fetch_player_payload, row): int(row.get("tp_id")) for row in decklist_rows}
        for future in as_completed(futures):
            tp_id = futures[future]
            try:
                player_tp_id, decklist_payload, matches_payload = future.result()
                fetched_player_payloads[player_tp_id] = {
                    "decklist": decklist_payload,
                    "matches": matches_payload,
                }
            except Exception as exc:
                print(f"Warning: failed to fetch payload for tp_id={tp_id}: {exc}")
                fetched_player_payloads[tp_id] = {"decklist": None, "matches": []}

    # Build deck analytics rows and per-player matches
    all_decks = []
    decks_by_tp_id: Dict[int, Dict[str, Any]] = {}
    player_matches = []
    canonical_matches_map: Dict[str, Dict[str, Any]] = {}

    for row in decklist_rows:
        tp_id = int(row.get("tp_id"))
        payload = fetched_player_payloads.get(tp_id, {"decklist": None, "matches": []})
        decklist_payload = payload.get("decklist")
        cards = to_card_entries(decklist_payload if isinstance(decklist_payload, dict) else {}, card_types_db)

        if not cards:
            # Decklist marked published but payload missing/empty: exclude from deck analytics.
            continue

        deck_hash = build_deck_hash(cards)
        placement = row.get("placement")
        made_phase2 = int(row.get("day2") or 0) == 1
        made_topcut = int(row.get("topcut") or 0) == 1

        success_tags = determine_placement_tags(placement, players_total)
        if made_phase2 and "phase2" not in success_tags:
            success_tags.append("phase2")
        if made_topcut and "topcut" not in success_tags:
            success_tags.append("topcut")

        deck = {
            "id": deck_hash[:10],
            "deckId": row.get("deck_id"),
            "player": anonymize_name(str(row.get("name") or "Unknown Player"), anonymize),
            "playerId": str(tp_id),
            "country": row.get("country"),
            "placement": placement,
            "archetype": ensure_archetype(row.get("deck_name")),
            "archetypeId": row.get("deck_id"),
            "cards": cards,
            "deckHash": deck_hash,
            "tournamentId": str(tournament_id),
            "tournamentName": tournament_name,
            "tournamentDate": start_date_iso,
            "tournamentPlayers": players_total,
            "tournamentFormat": None,
            "tournamentPlatform": "offline",
            "tournamentOrganizer": None,
            "deckSource": "limitless-labs",
            "successTags": success_tags,
            "madePhase2": made_phase2,
            "madeTopCut": made_topcut,
            "hasDecklist": True,
        }

        all_decks.append(deck)
        decks_by_tp_id[tp_id] = deck

        for match_row in payload.get("matches") or []:
            round_num = match_row.get("round")
            if round_num is None:
                continue

            p1_id = match_row.get("p1_id")
            p2_id = match_row.get("p2_id")

            if p1_id == tp_id:
                opponent_id = p2_id
                opponent_name = match_row.get("p2_name")
                opponent_country = match_row.get("p2_country")
                opponent_deck = match_row.get("p2_deck_name") or match_row.get("p2_deck")
            elif p2_id == tp_id:
                opponent_id = p1_id
                opponent_name = match_row.get("p1_name")
                opponent_country = match_row.get("p1_country")
                opponent_deck = match_row.get("p1_deck_name") or match_row.get("p1_deck")
            else:
                opponent_id = p2_id
                opponent_name = match_row.get("p2_name")
                opponent_country = match_row.get("p2_country")
                opponent_deck = match_row.get("p2_deck_name") or match_row.get("p2_deck")

            outcome = extract_player_outcome(tp_id, match_row)

            player_match = {
                "id": f"{tp_id}:r{round_num}",
                "playerId": tp_id,
                "playerName": anonymize_name(str(row.get("name") or "Unknown Player"), anonymize),
                "opponentId": opponent_id,
                "opponentName": anonymize_name(str(opponent_name or ""), anonymize) if opponent_name else None,
                "opponentCountry": opponent_country,
                "opponentArchetype": ensure_archetype(opponent_deck) if opponent_deck else None,
                "playerArchetype": deck.get("archetype"),
                "round": round_num,
                "phase": match_row.get("phase"),
                "table": match_row.get("table"),
                "completed": int(match_row.get("completed") or 0) == 1,
                "winnerCode": match_row.get("winner"),
                "outcome": outcome,
                "madePhase2": made_phase2,
                "madeTopCut": made_topcut,
            }
            player_matches.append(player_match)

            match_key = canonical_match_key(match_row)
            if not match_key:
                continue
            if match_key not in canonical_matches_map:
                canonical_matches_map[match_key] = {
                    "key": match_key,
                    "round": match_row.get("round"),
                    "phase": match_row.get("phase"),
                    "table": match_row.get("table"),
                    "completed": int(match_row.get("completed") or 0) == 1,
                    "player1Id": match_row.get("p1_id"),
                    "player2Id": match_row.get("p2_id"),
                    "winnerCode": match_row.get("winner"),
                    "player1Name": anonymize_name(str(match_row.get("p1_name") or ""), anonymize)
                    if match_row.get("p1_name")
                    else None,
                    "player2Name": anonymize_name(str(match_row.get("p2_name") or ""), anonymize)
                    if match_row.get("p2_name")
                    else None,
                    "player1Country": match_row.get("p1_country"),
                    "player2Country": match_row.get("p2_country"),
                    "player1Archetype": ensure_archetype(match_row.get("p1_deck_name") or match_row.get("p1_deck"))
                    if match_row.get("p1_deck") or match_row.get("p1_deck_name")
                    else None,
                    "player2Archetype": ensure_archetype(match_row.get("p2_deck_name") or match_row.get("p2_deck"))
                    if match_row.get("p2_deck") or match_row.get("p2_deck_name")
                    else None,
                }

    all_decks.sort(key=lambda d: (d.get("placement") is None, d.get("placement") or 999999, d.get("player") or ""))
    player_matches.sort(key=lambda m: (m.get("round") or 0, m.get("playerId") or 0))

    # Finalize canonical matches with derived outcomes and participant flags
    canonical_matches = []
    for key, record in canonical_matches_map.items():
        outcome_type, result1, result2 = derive_canonical_outcome(
            {
                "p1_id": record.get("player1Id"),
                "p2_id": record.get("player2Id"),
                "winner": record.get("winnerCode"),
            }
        )
        p1_id = record.get("player1Id")
        p2_id = record.get("player2Id")

        p1_row = standings_by_tp_id.get(int(p1_id), {}) if p1_id is not None else {}
        p2_row = standings_by_tp_id.get(int(p2_id), {}) if p2_id is not None else {}

        canonical_matches.append(
            {
                "id": hashlib.sha1(key.encode("utf-8")).hexdigest()[:12],
                **record,
                "winner": record.get("winnerCode"),
                "outcomeType": outcome_type,
                "player1Result": result1,
                "player2Result": result2,
                "player1MadePhase2": int(p1_row.get("day2") or 0) == 1 if p1_row else None,
                "player1MadeTopCut": int(p1_row.get("topcut") or 0) == 1 if p1_row else None,
                "player2MadePhase2": int(p2_row.get("day2") or 0) == 1 if p2_row else None,
                "player2MadeTopCut": int(p2_row.get("topcut") or 0) == 1 if p2_row else None,
            }
        )

    canonical_matches.sort(key=lambda m: (m.get("round") or 0, m.get("table") or 0, m.get("key") or ""))

    profiles = aggregate_matchups(canonical_matches, standings_by_tp_id, decks_by_tp_id, players_total)
    matchup_profiles = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "tournament": {
            "id": str(tournament_id),
            "labsCode": labs_code,
            "name": tournament_name,
            "players": players_total,
            "division": DIVISION,
        },
        "phaseMultipliers": PHASE_MULTIPLIERS,
        "qualityModel": {
            "description": "qualityWeighted = phaseMultiplier * avg(playerQualityA, playerQualityB)",
            "tierBase": {"topcut": 1.0, "phase2": 0.7, "other": 0.4},
            "placementPercentileWeight": 0.3,
        },
        "profiles": profiles,
    }

    master_report = generate_report_json(all_decks, len(all_decks), all_decks)
    card_index = generate_card_index(all_decks)
    synonyms_data = None
    if generate_tournament_synonyms:
        synonyms_data = generate_card_synonyms(all_decks, session, existing_synonyms, existing_canonicals)

    archetype_data_map, archetype_index = build_archetype_reports(all_decks)

    phase2_decks = [deck for deck in all_decks if deck.get("madePhase2")]
    topcut_decks = [deck for deck in all_decks if deck.get("madeTopCut")]

    if start_date_iso and tournament_name:
        folder_name = f"{start_date_iso}, {sanitize_for_path(tournament_name)}"
    elif tournament_name:
        folder_name = sanitize_for_path(tournament_name)
    else:
        folder_name = f"Tournament {labs_code}"

    base_path = f"reports/{folder_name}"
    participants_phase2 = sum(1 for row in participants if row.get("madePhase2"))
    participants_topcut = sum(1 for row in participants if row.get("madeTopCut"))
    index_report = {
        "folder": folder_name,
        "path": base_path,
        "name": tournament_name,
        "labsCode": labs_code,
        "tournamentId": str(tournament_id),
        "date": start_date_iso or date_text,
        "playersTotal": len(participants),
        "decklistPlayers": len(all_decks),
        "playerMatches": len(player_matches),
        "canonicalMatches": len(canonical_matches),
        "archetypes": len(archetype_data_map),
        "phase2Participants": participants_phase2,
        "topcutParticipants": participants_topcut,
        "phase2Decks": len(phase2_decks),
        "topcutDecks": len(topcut_decks),
        "generatedAt": metadata.get("fetchedAt"),
        "reportVersion": metadata.get("reportVersion"),
    }

    print(f"\nUploading tournament report to {base_path}")
    upload_to_r2(r2_client, r2_bucket_name, f"{base_path}/index.json", index_report)
    upload_to_r2(r2_client, r2_bucket_name, f"{base_path}/meta.json", metadata)
    upload_to_r2(r2_client, r2_bucket_name, f"{base_path}/players.json", participants)
    upload_to_r2(r2_client, r2_bucket_name, f"{base_path}/decks.json", all_decks)
    upload_to_r2(r2_client, r2_bucket_name, f"{base_path}/playerMatches.json", player_matches)
    upload_to_r2(r2_client, r2_bucket_name, f"{base_path}/matches.json", canonical_matches)
    upload_to_r2(r2_client, r2_bucket_name, f"{base_path}/matchupProfiles.json", matchup_profiles)
    upload_to_r2(r2_client, r2_bucket_name, f"{base_path}/master.json", master_report)
    upload_to_r2(r2_client, r2_bucket_name, f"{base_path}/cardIndex.json", card_index)
    if synonyms_data is not None:
        upload_to_r2(r2_client, r2_bucket_name, f"{base_path}/synonyms.json", synonyms_data)
    upload_to_r2(r2_client, r2_bucket_name, f"{base_path}/archetypes/index.json", archetype_index)

    if write_tournament_db:
        print("  Building tournament.db...")
        sqlite_blob = build_tournament_sqlite_bytes(
            all_decks=all_decks,
            master_report=master_report,
            participants=participants,
            player_matches=player_matches,
            canonical_matches=canonical_matches,
            matchup_profiles=matchup_profiles,
            metadata=metadata,
            labs_code=labs_code,
        )
        upload_binary_to_r2(
            r2_client,
            r2_bucket_name,
            f"{base_path}/tournament.db",
            sqlite_blob,
            "application/x-sqlite3",
        )

    for archetype_base, payload in archetype_data_map.items():
        upload_to_r2(r2_client, r2_bucket_name, f"{base_path}/archetypes/{archetype_base}/cards.json", payload["cards"])
        upload_to_r2(r2_client, r2_bucket_name, f"{base_path}/archetypes/{archetype_base}/decks.json", payload["decks"])

    print("\nUploading slices...")
    build_slice_payloads(base_path, "phase2", phase2_decks, r2_client, r2_bucket_name)
    build_slice_payloads(base_path, "topcut", topcut_decks, r2_client, r2_bucket_name)

    print("\nUpdating tournaments.json...")
    update_tournaments_json(r2_client, r2_bucket_name, folder_name)

    print("\n✓ Process complete!")
    print(f"  Tournament: {folder_name}")
    print(f"  Participants: {len(participants)}")
    print(f"  Decks (analytics): {len(all_decks)}")
    print(f"  Player matches: {len(player_matches)}")
    print(f"  Canonical matches: {len(canonical_matches)}")
    print(f"  Phase2 decks: {len(phase2_decks)}")
    print(f"  Topcut decks: {len(topcut_decks)}")
    print(f"  Archetypes: {len(archetype_data_map)}")
    print(f"  Tournament DB: {'enabled' if write_tournament_db else 'disabled'}")
    print(f"  Tournament synonyms: {'enabled' if generate_tournament_synonyms else 'disabled'}")


if __name__ == "__main__":
    main()
