"""One-off repair: add the RK9-sourced decklists Limitless Labs never scraped.

Limitless publishes a Labs event as soon as standings exist, so the 2026 World
Championship landed with 797 players but only 774 decklists — the 23 missing
players were almost all Japanese, whose lists RK9 carries but Labs did not pick
up. This merges a pre-resolved payload (see data/worlds-2026-rk9-backfill.json,
which records its own provenance) into the event's `decks.json` and marks the
matching rows in `players.json` as published.

It writes ONLY those two files. Every derived artifact — master.json,
archetypes/, cardUsage — is regenerated from them by the release build, so
there is nothing else to keep in sync here.

This is a repair script, not pipeline tooling: it refuses to run against an
event that does not look exactly like the one it was built for, and it is safe
to delete once the backfill has shipped.

Usage: DRY_RUN=false python .github/scripts/backfill-worlds-decks.py
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from lib.r2 import make_r2_client, read_json  # noqa: E402

PAYLOAD_PATH = Path(__file__).parent / "data" / "worlds-2026-rk9-backfill.json"

# The event must match this shape before anything is written. A backfill is only
# correct against the exact state it was computed from: if the event has already
# grown decks (Labs caught up, or this ran once), re-merging would double-count.
EXPECTED_EXISTING_DECKS = 774
EXPECTED_PLAYERS = 797


def load_payload() -> dict:
    payload = json.loads(PAYLOAD_PATH.read_text(encoding="utf-8"))
    for deck in payload["decks"]:
        total = sum(card["count"] for card in deck["cards"])
        if total != 60:
            raise SystemExit(f"payload deck {deck['playerId']} has {total} cards, expected 60")
    return payload


def check_preconditions(decks: list, players: list, incoming: list) -> None:
    """Refuse to write unless the event is in exactly the expected pre-state."""
    if len(decks) != EXPECTED_EXISTING_DECKS:
        raise SystemExit(
            f"refusing to write: event has {len(decks)} decks, expected {EXPECTED_EXISTING_DECKS}. "
            "The backfill may already have run, or Labs has since scraped these lists."
        )
    if len(players) != EXPECTED_PLAYERS:
        raise SystemExit(f"refusing to write: event has {len(players)} players, expected {EXPECTED_PLAYERS}")

    existing = {str(d.get("playerId")) for d in decks}
    collisions = sorted(str(d["playerId"]) for d in incoming if str(d["playerId"]) in existing)
    if collisions:
        raise SystemExit(f"refusing to write: {len(collisions)} incoming player(s) already have a deck: {collisions[:5]}")

    known = {str(p.get("tpId")) for p in players}
    unknown = sorted(str(d["playerId"]) for d in incoming if str(d["playerId"]) not in known)
    if unknown:
        raise SystemExit(f"refusing to write: {len(unknown)} incoming player(s) are not in the standings: {unknown[:5]}")


def merge(decks: list, players: list, incoming: list) -> tuple[list, list, int]:
    merged = sorted(decks + incoming, key=lambda d: d["placement"] if d.get("placement") else 99999)
    by_tp = {str(d["playerId"]): d for d in incoming}
    touched = 0
    for player in players:
        deck = by_tp.get(str(player.get("tpId")))
        if not deck:
            continue
        player["decklistPublished"] = True
        player["deckName"] = deck["archetype"]
        player["deckId"] = deck["deckId"]
        touched += 1
    return merged, players, touched


def main() -> None:
    dry_run = os.environ.get("DRY_RUN", "true").lower() != "false"
    bucket = os.environ["R2_BUCKET_NAME"]
    client = make_r2_client(
        os.environ["R2_ACCOUNT_ID"], os.environ["R2_ACCESS_KEY_ID"], os.environ["R2_SECRET_ACCESS_KEY"]
    )

    payload = load_payload()
    base = f"reports/{payload['event']}"
    incoming = payload["decks"]

    reads = {name: read_json(client, bucket, f"{base}/{name}.json") for name in ("decks", "players")}
    for name, result in reads.items():
        if result.status != "found":
            raise SystemExit(f"could not read {base}/{name}.json: {result.status} ({result.error})")

    decks, players = reads["decks"].value, reads["players"].value
    check_preconditions(decks, players, incoming)
    merged_decks, merged_players, touched = merge(decks, players, incoming)

    print(f"[backfill] event   : {payload['event']}")
    print(f"[backfill] decks   : {len(decks)} -> {len(merged_decks)} (+{len(incoming)})")
    print(f"[backfill] players : {touched} row(s) marked decklistPublished")
    for deck in sorted(incoming, key=lambda d: d["placement"]):
        print(f"[backfill]   {deck['placement']:>4}  {deck['player']:<24} {deck['archetype']}")

    if dry_run:
        print("[backfill] DRY RUN — nothing written (set DRY_RUN=false to publish)")
        return

    for name, body in (("decks", merged_decks), ("players", merged_players)):
        client.put_object(
            Bucket=bucket,
            Key=f"{base}/{name}.json",
            Body=json.dumps(body, ensure_ascii=False).encode("utf-8"),
            ContentType="application/json",
        )
        print(f"[backfill] wrote {base}/{name}.json")
    print("[backfill] done — run (Data) Publish Data Release to regenerate derived artifacts")


if __name__ == "__main__":
    main()
