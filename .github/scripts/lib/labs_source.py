"""Build the loose Labs *source* record consumed by the TypeScript event CLI.

The rearchitecture keeps every domain rule (stable IDs, canonicalization,
archetype identity, success tags, match-outcome derivation) in one TypeScript
home (``shared/data``). Python's only job is to fetch from Limitless Labs and
reshape what it fetched into this loose source shape, which
``shared/data/adapters/labsSource.ts`` then turns into a validated normalized
event.

This module is pure (no I/O, no network) so it is unit-testable. It maps the
structures ``download-tournament.py`` already assembles — the participant table,
per-player card entries, and raw match rows — into the ``LabsSourceEvent`` shape.
"""

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

# Committed decklists Labs never scraped, one payload per event (see the
# provenance each payload records). Re-downloading an event merges its payload.
SUPPLEMENTAL_DECKS_DIR = Path(__file__).resolve().parents[1] / "data"
SUPPLEMENTAL_DECKS_GLOB = "*-backfill.json"
SOURCE_CARD_FIELDS = ("name", "set", "number", "count", "category", "trainerType", "energyType", "aceSpec",
                      "regulationMark")


def _match_row(raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Map one raw Labs match row to the source shape, or None if unusable."""
    round_num = raw.get("round")
    p1_id = raw.get("p1_id")
    if round_num is None or p1_id is None:
        return None
    return {
        "round": round_num,
        "phase": raw.get("phase"),
        "table": raw.get("table"),
        "completed": int(raw.get("completed") or 0) == 1,
        "p1Id": p1_id,
        "p2Id": raw.get("p2_id"),
        "winner": raw.get("winner"),
    }


def _standing(participant: Dict[str, Any]) -> Dict[str, Any]:
    """Map one assembled participant row to a source standing."""
    return {
        "tpId": participant.get("tpId"),
        "playerId": participant.get("playerId"),
        "name": participant.get("name"),
        "country": participant.get("country"),
        "placement": participant.get("placement"),
        "wins": participant.get("wins"),
        "losses": participant.get("losses"),
        "ties": participant.get("ties"),
        "points": participant.get("points"),
        "opw": participant.get("opw"),
        "oopw": participant.get("oopw"),
        "madePhase2": bool(participant.get("madePhase2")),
        "madeTopCut": bool(participant.get("madeTopCut")),
        "dropped": bool(participant.get("dropped")),
        "dqed": bool(participant.get("dqed")),
        "late": bool(participant.get("late")),
        "decklistPublished": bool(participant.get("decklistPublished")),
        "dropRound": participant.get("dropRound"),
        "icons": participant.get("icons") or [],
        # The contract's `deckId` is a content hash; the Labs deck id is separate.
        "labsDeckId": participant.get("deckId"),
        "deckName": participant.get("deckName"),
    }


def build_labs_source_event(
    labs_code: str,
    metadata: Dict[str, Any],
    participants: List[Dict[str, Any]],
    decklists_by_tp: Dict[Any, List[Dict[str, Any]]],
    match_rows: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Assemble a ``LabsSourceEvent`` dict from already-fetched Labs data.

    ``participants`` is the assembled participant table (with ``tpId``, flags,
    etc.); ``decklists_by_tp`` maps a tp id to the card entries produced by
    ``to_card_entries`` (already the source card shape); ``match_rows`` are raw
    Labs match rows. ``metadata`` is the event meta dict. No policy is applied
    here — that is the TypeScript adapter's job.
    """
    decklists: Dict[str, List[Dict[str, Any]]] = {}
    for tp_id, cards in decklists_by_tp.items():
        if cards:
            decklists[str(tp_id)] = cards

    matches: List[Dict[str, Any]] = []
    for raw in match_rows or []:
        mapped = _match_row(raw)
        if mapped is not None:
            matches.append(mapped)

    return {
        "labsCode": labs_code,
        "fetchedAt": metadata.get("fetchedAt"),
        "meta": {
            "name": metadata.get("name"),
            "date": metadata.get("startDate") or metadata.get("date"),
            "players": metadata.get("players"),
            "division": metadata.get("division"),
            "hasDay2": any(bool(p.get("madePhase2")) for p in participants),
            "country": metadata.get("country"),
            "city": metadata.get("city"),
            "eventType": metadata.get("type"),
            "updatedAt": metadata.get("updatedAt"),
            "completed": bool(metadata.get("completed")),
            "started": bool(metadata.get("started")),
            "playersRound1": metadata.get("playersRound1"),
            "decklistCount": metadata.get("decklists"),
            "rk9Id": metadata.get("rk9Id"),
            "playlatamId": metadata.get("playlatamId"),
            "sourceTournamentId": (
                str(metadata.get("tournamentId")) if metadata.get("tournamentId") is not None else None
            ),
        },
        "standings": [_standing(p) for p in participants],
        "decklists": decklists,
        "matches": matches,
    }


def supplemental_decks(folder: str, directory: Path = SUPPLEMENTAL_DECKS_DIR) -> List[Dict[str, Any]]:
    """The committed decks for the event in ``folder`` ("<date>, <name>"), or none."""
    for path in sorted(directory.glob(SUPPLEMENTAL_DECKS_GLOB)):
        payload = json.loads(path.read_text(encoding="utf-8"))
        if payload.get("event") == folder:
            return payload["decks"]
    return []


def merge_supplemental_decks(
    participants: List[Dict[str, Any]],
    decklists_by_tp: Dict[Any, List[Dict[str, Any]]],
    decks: List[Dict[str, Any]],
) -> int:
    """Give players Labs has no list for the list a supplemental deck carries.

    Each deck's ``playerId`` is the player's tp id. Labs' own list always wins,
    and a deck for a player not in the standings is ignored. Returns how many
    lists were added.
    """
    by_tp = {str(p.get("tpId")): p for p in participants}
    added = 0
    for deck in decks:
        participant = by_tp.get(str(deck.get("playerId")))
        if participant is None or decklists_by_tp.get(participant["tpId"]):
            continue
        decklists_by_tp[participant["tpId"]] = [
            {field: card[field] for field in SOURCE_CARD_FIELDS if field in card} for card in deck["cards"]
        ]
        participant.update(decklistPublished=True, deckName=deck.get("archetype"), deckId=deck.get("deckId"))
        added += 1
    return added
