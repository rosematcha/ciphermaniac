#!/usr/bin/env python3
"""Group each card's printings by the artwork they show.

The synonym DB already tells us which printings are the same *card*. This
producer answers the next question — which of those printings are the same
*picture* — so a tier list over card art can offer one entry per illustration
instead of six near-identical ones.

Reads:  ``assets/card-synonyms.json`` (R2)
Writes: ``assets/card-art-groups.json`` (R2)

Incremental by design. Each card carries a signature over its printing list and
the comparison parameters; a card whose signature is unchanged reuses the
previous run's grouping untouched, so a normal run only pays for cards that
gained a printing. Retuning the comparison changes every signature and forces a
full rebuild, which is the intent.

Env (same convention as the other R2 producers):
  R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME

Usage:
  python .github/scripts/build-art-groups.py                    # build + upload
  python .github/scripts/build-art-groups.py --dry-run          # no upload
  python .github/scripts/build-art-groups.py --cards "Rare Candy,Ultra Ball"
  python .github/scripts/build-art-groups.py --explain "Rare Candy"
  python .github/scripts/build-art-groups.py --dry-run --gallery .scratch/art-review
"""

from __future__ import annotations

import argparse
import concurrent.futures as futures
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from html import escape
from pathlib import Path
from typing import Iterable, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))

import art_similarity as art  # noqa: E402
import r2 as r2lib  # noqa: E402

ARTIFACT_VERSION = 1
SYNONYMS_KEY = "assets/card-synonyms.json"
OUTPUT_KEY = "assets/card-art-groups.json"
PUBLIC_ORIGIN = "https://r2.ciphermaniac.com"

LIMITLESS_CDN = "https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci"
LIMITLESS_CARD_PAGE = "https://limitlesstcg.com/cards/{set}/{number}"
BROWSER_UA = "Mozilla/5.0 (compatible; ciphermaniac art-grouper; +https://ciphermaniac.com)"
_CARD_IMG_RE = re.compile(r'class="card shadow[^"]*"\s+src="([^"]+)"')

DEFAULT_CACHE = Path(".art-cache")
FETCH_RETRIES = 3


def log(message: str) -> None:
    print(message, flush=True)


# --------------------------------------------------------------------------
# Inputs
# --------------------------------------------------------------------------

def r2_credentials() -> Optional[dict[str, str]]:
    """The four R2 env vars, or None when any is absent."""
    names = ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME")
    values = {name: os.environ.get(name, "") for name in names}
    return values if all(values.values()) else None


def load_json_source(client, bucket: str, key: str, required: bool):
    """Read a JSON artifact, preferring the authenticated S3 path.

    CI runners cannot reach the public edge (Cloudflare bot management blocks
    datacenter IPs), and the public edge serves hours-stale JSON anyway, so the
    HTTP fallback exists only for credential-less local runs.
    """
    if client is not None:
        result = r2lib.read_json(client, bucket, key)
        if result.status == "found":
            return result.value
        if result.status == "missing":
            if required:
                raise RuntimeError(f"{key} is missing from the bucket")
            return None
        raise RuntimeError(f"failed to read {key} ({result.status})") from result.error

    import requests

    response = requests.get(f"{PUBLIC_ORIGIN}/{key}", timeout=30)
    if response.status_code == 404 and not required:
        return None
    response.raise_for_status()
    return response.json()


def clusters_from_synonyms(database: dict) -> dict[str, list[str]]:
    """Card name -> its printings as ``SET::NUMBER``, in release order.

    The synonym producer writes ``prints`` straight from Limitless's prints
    table, so its key order is release order and the first member of an art
    group is that art's first printing.
    """
    clusters: dict[str, list[str]] = {}
    for uid in database.get("prints") or {}:
        parts = uid.split("::")
        if len(parts) != 3:
            continue
        name, set_code, number = parts
        clusters.setdefault(name, []).append(f"{set_code}::{number}")
    return clusters


def signature(prints: Iterable[str]) -> str:
    """Digest of a card's printing list plus the comparison parameters."""
    payload = art.parameter_signature() + "\n" + "\n".join(prints)
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()[:16]


# --------------------------------------------------------------------------
# Card images
# --------------------------------------------------------------------------

def _bare_number(number: str) -> str:
    """``090`` -> ``90``, ``068A`` -> ``68A``. Limitless card pages are unpadded."""
    digits = re.match(r"^0*(\d+)(.*)$", number)
    return f"{digits.group(1)}{digits.group(2)}" if digits else number


def _get(session, url: str, **kwargs):
    """GET with retries, distinguishing a real 404 from a transient failure."""
    last: Optional[Exception] = None
    for attempt in range(FETCH_RETRIES):
        try:
            response = session.get(url, timeout=30, **kwargs)
        except Exception as exc:  # noqa: BLE001 — retried, then reported
            last = exc
        else:
            if response.status_code in (403, 404):
                return None
            if response.ok:
                return response
            last = RuntimeError(f"HTTP {response.status_code}")
        if attempt < FETCH_RETRIES - 1:
            import time
            time.sleep(0.5 * 2 ** attempt)
    log(f"    fetch failed {url}: {last}")
    return None


def fetch_art(session, set_code: str, number: str) -> Optional[bytes]:
    """The raw bytes of a printing's art, or None when no source has it.

    The LimitlessTCG CDN covers everything from Black & White onward. Older
    sets 403 there, and Limitless serves them from pokemontcg.io under a
    different set-id namespace (``GE`` -> ``dp4``) that only its own card page
    knows — so that page is scraped for the real URL rather than a set-id table
    being hand-maintained here.
    """
    direct = _get(session, f"{LIMITLESS_CDN}/{set_code}/{set_code}_{number}_R_EN_LG.png")
    if direct is not None:
        return direct.content
    page = _get(session, LIMITLESS_CARD_PAGE.format(set=set_code, number=_bare_number(number)),
                headers={"User-Agent": BROWSER_UA})
    if page is None:
        return None
    found = _CARD_IMG_RE.search(page.text)
    if not found:
        return None
    fallback = _get(session, found.group(1))
    return fallback.content if fallback is not None else None


def ensure_image(session, cache: Path, ref: str) -> Optional[Path]:
    """Fetch a printing's art into the cache, normalised. Returns None if absent.

    Cached as a card-sized WebP rather than the raw source: the comparison
    normalises to 460x640 anyway, so caching the decoded result means a re-run
    never re-fetches or re-decodes. The whole cache is ~350MB across every
    printing we know about.
    """
    set_code, number = ref.split("::")
    path = cache / f"{set_code}_{number}.webp"
    if path.exists():
        return path
    raw = fetch_art(session, set_code, number)
    if raw is None:
        return None

    import cv2
    import numpy as np

    decoded = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    if decoded is None:
        log(f"    undecodable image for {ref}")
        return None
    normalised = cv2.resize(decoded, (art.CARD_W, art.CARD_H), interpolation=cv2.INTER_AREA)
    path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(path), normalised, [cv2.IMWRITE_WEBP_QUALITY, 92])
    return path


def download_cluster(session, cache: Path, prints: list[str]) -> tuple[dict[str, Path], list[str]]:
    """Fetch every printing of one card. Returns ``(available, unmatched)``."""
    available: dict[str, Path] = {}
    unmatched: list[str] = []
    for ref in prints:
        path = ensure_image(session, cache, ref)
        if path is None:
            unmatched.append(ref)
        else:
            available[ref] = path
    return available, unmatched


# --------------------------------------------------------------------------
# Grouping
# --------------------------------------------------------------------------

def group_cluster(paths: dict[str, Path]) -> list[list[str]]:
    """Partition one card's downloaded printings into art groups."""
    loaded: dict[str, art.ArtBands] = {}

    def bands(ref: str) -> art.ArtBands:
        if ref not in loaded:
            loaded[ref] = art.load_bands(str(paths[ref]))
        return loaded[ref]

    return art.group_by_art(list(paths), bands)


def _group_task(payload: tuple[str, dict[str, str]]) -> tuple[str, list[list[str]]]:
    name, paths = payload
    return name, group_cluster({ref: Path(p) for ref, p in paths.items()})


def build_cards(clusters: dict[str, list[str]], previous: dict, cache: Path,
                jobs: int) -> tuple[dict[str, dict], int]:
    """Group every card, reusing unchanged results from the previous artifact."""
    import requests

    prior = previous.get("cards") or {}
    cards: dict[str, dict] = {}
    pending: list[tuple[str, dict[str, str]]] = []
    reused = 0

    session = requests.Session()
    for index, (name, prints) in enumerate(sorted(clusters.items()), start=1):
        sig = signature(prints)
        cached = prior.get(name)
        if cached and cached.get("sig") == sig:
            cards[name] = cached
            reused += 1
            continue
        log(f"  [{index}/{len(clusters)}] {name} ({len(prints)} printings)")
        available, unmatched = download_cluster(session, cache, prints)
        cards[name] = {"sig": sig, "arts": [], "unmatched": unmatched}
        if available:
            pending.append((name, {ref: str(path) for ref, path in available.items()}))

    if pending:
        log(f"  comparing {len(pending)} cards across {jobs} worker(s)")
        with futures.ProcessPoolExecutor(max_workers=jobs) as pool:
            for name, arts in pool.map(_group_task, pending):
                cards[name]["arts"] = arts
    return cards, reused


def summarise(cards: dict[str, dict]) -> dict[str, int]:
    arts = sum(len(card["arts"]) for card in cards.values())
    prints = sum(len(group) for card in cards.values() for group in card["arts"])
    unmatched = sum(len(card["unmatched"]) for card in cards.values())
    return {"cards": len(cards), "prints": prints, "arts": arts,
            "collapsed": prints - arts, "unmatched": unmatched}


# --------------------------------------------------------------------------
# Review output
# --------------------------------------------------------------------------

def write_gallery(cards: dict[str, dict], cache: Path, out: Path) -> None:
    """A static page showing every multi-print card's grouping, for eyeballing."""
    out.mkdir(parents=True, exist_ok=True)
    base = os.path.relpath(cache.resolve(), out.resolve()).replace(os.sep, "/")
    rows = []
    for name in sorted(cards):
        card = cards[name]
        if sum(len(group) for group in card["arts"]) + len(card["unmatched"]) < 2:
            continue
        groups = "".join(
            "<div class=g>" + "".join(
                f'<figure><img loading=lazy src="{base}/{ref.replace("::", "_")}.webp">'
                f"<figcaption>{ref.replace('::', ' ')}</figcaption></figure>"
                for ref in group
            ) + "</div>"
            for group in card["arts"]
        )
        missing = ("<p class=miss>no image: " + ", ".join(card["unmatched"]) + "</p>"
                   if card["unmatched"] else "")
        rows.append(f"<section><h2>{escape(name)}</h2>{groups}{missing}</section>")
    (out / "index.html").write_text(
        "<!doctype html><meta charset=utf-8><title>Art groups</title>"
        "<style>body{font:14px/1.4 system-ui;margin:24px;background:#111;color:#eee}"
        "h2{font-size:15px;margin:28px 0 8px}"
        ".g{display:flex;gap:6px;flex-wrap:wrap;background:#1d2534;border-radius:8px;"
        "padding:6px;margin-bottom:6px}"
        "figure{margin:0;width:110px}img{width:110px;border-radius:4px;display:block}"
        "figcaption{font:11px monospace;color:#9aa;padding-top:2px}"
        ".miss{color:#c88;font-size:12px}</style>" + "".join(rows),
        encoding="utf-8",
    )
    log(f"  gallery written to {out / 'index.html'}")


def explain(name: str, clusters: dict[str, list[str]], cache: Path) -> int:
    """Print every pairwise score for one card, best-separated first."""
    import requests

    prints = clusters.get(name)
    if not prints:
        log(f"no such card: {name}")
        return 1
    available, unmatched = download_cluster(requests.Session(), cache, prints)
    loaded = {ref: art.load_bands(str(path)) for ref, path in available.items()}
    log(f"{name}: {len(available)} printings" + (f", {len(unmatched)} without art" if unmatched else ""))
    for ncc, chroma, a, b in art.score_all_pairs(list(loaded), loaded.__getitem__):
        mark = "MATCH" if art.is_same_art(ncc, chroma) else "     "
        log(f"  {mark} ncc={ncc:6.3f} chroma={chroma:6.1f}  {a:10s} {b}")
    return 0


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------

def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Group card printings by artwork.")
    parser.add_argument("--dry-run", action="store_true", help="build without uploading")
    parser.add_argument("--rebuild", action="store_true",
                        help="ignore the previous artifact and regroup every card")
    parser.add_argument("--cards", help="comma-separated card names to limit the build to")
    parser.add_argument("--explain", help="print pairwise scores for one card and exit")
    parser.add_argument("--gallery", help="write a review gallery to this directory")
    parser.add_argument("--output", help="also write the artifact to this local path")
    parser.add_argument("--cache", default=str(DEFAULT_CACHE), help="card image cache directory")
    parser.add_argument("--jobs", type=int, default=max(1, (os.cpu_count() or 2)),
                        help="parallel comparison workers")
    return parser.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    args = parse_args(argv)
    credentials = r2_credentials()
    uploads = not (args.dry_run or args.explain)
    if credentials is None and uploads:
        log("Missing R2 credentials. Re-run with --dry-run to build without uploading.")
        return 1

    client = None
    bucket = ""
    if credentials is not None:
        client = r2lib.make_r2_client(credentials["R2_ACCOUNT_ID"],
                                      credentials["R2_ACCESS_KEY_ID"],
                                      credentials["R2_SECRET_ACCESS_KEY"])
        bucket = credentials["R2_BUCKET_NAME"]

    cache = Path(args.cache)
    cache.mkdir(parents=True, exist_ok=True)

    log("Loading card synonyms...")
    database = load_json_source(client, bucket, SYNONYMS_KEY, required=True)
    clusters = clusters_from_synonyms(database)
    log(f"  {len(clusters)} cards, {sum(len(v) for v in clusters.values())} printings")

    if args.explain:
        return explain(args.explain, clusters, cache)

    if args.cards:
        wanted = {name.strip() for name in args.cards.split(",") if name.strip()}
        missing = wanted - clusters.keys()
        if missing:
            log(f"unknown card(s): {', '.join(sorted(missing))}")
            return 1
        clusters = {name: clusters[name] for name in wanted}

    previous = {} if args.rebuild else (load_json_source(client, bucket, OUTPUT_KEY, required=False) or {})
    if previous.get("version") != ARTIFACT_VERSION:
        previous = {}

    cards, reused = build_cards(clusters, previous, cache, args.jobs)
    stats = summarise(cards)
    artifact = {
        "version": ARTIFACT_VERSION,
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "params": art.parameter_signature(),
        "source": {"synonymsGenerated": (database.get("metadata") or {}).get("generated")},
        "stats": stats,
        "cards": cards,
    }

    log(f"Grouped {stats['prints']} printings into {stats['arts']} distinct arts "
        f"({stats['collapsed']} collapsed, {stats['unmatched']} without art, {reused} cards reused)")

    body = json.dumps(artifact, ensure_ascii=False, separators=(",", ":"))
    if args.output:
        Path(args.output).write_text(body, encoding="utf-8")
        log(f"  wrote {args.output}")
    if args.gallery:
        write_gallery(cards, cache, Path(args.gallery))

    if not uploads:
        log("Dry run — not uploading.")
        return 0
    if args.cards:
        log("Refusing to upload a partial build (--cards was given).")
        return 1
    client.put_object(Bucket=bucket, Key=OUTPUT_KEY, Body=body.encode("utf-8"),
                      ContentType="application/json")
    log(f"Uploaded {OUTPUT_KEY}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
