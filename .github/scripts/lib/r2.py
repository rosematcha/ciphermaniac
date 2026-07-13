"""Shared R2 access helpers: a retrying boto3 client and typed read results.

Every Python R2 consumer routes through this module so that:

- Transient transport failures are retried transparently. botocore's adaptive
  retry mode already implements exponential backoff with jitter, so we lean on
  it rather than hand-rolling sleep loops.
- A read failure is classified — found / missing / corrupt / transport — instead
  of collapsing every error into "missing". Callers can then decide whether an
  empty result is safe (a verified 404) or must abort the run (a transport blip
  or corrupt payload), which is the difference between "first run" and "erase 90
  days of price history".

The module name is intentionally underscore-free (``r2``) so scripts with dashed
filenames can ``import r2`` after adding ``lib/`` to ``sys.path``.
"""

from __future__ import annotations

import json
from typing import Any, NamedTuple, Optional

# Error codes that unambiguously mean "the object does not exist". Anything else
# (AccessDenied, throttling, 5xx, connection resets) is a transport failure and
# must never be mistaken for absence.
_MISSING_OBJECT_CODES = ("NoSuchKey", "NotFound", "404")


class ReadResult(NamedTuple):
    """Outcome of :func:`read_json`.

    ``status`` is one of ``'found'``, ``'missing'``, ``'corrupt'`` or
    ``'transport'``. ``value`` holds the parsed JSON only when ``status`` is
    ``'found'``; ``error`` carries the original exception for every non-found
    outcome so callers can log or re-raise it.
    """

    status: str
    value: Any = None
    error: Optional[BaseException] = None


def make_r2_client(account_id, access_key_id, secret_access_key):
    """Build a boto3 S3 client for R2 with adaptive retries and sane timeouts.

    The adaptive retry mode gives us exponential backoff with jitter for both
    reads and writes without any manual sleep loops.
    """
    import boto3
    from botocore.config import Config

    return boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=access_key_id,
        aws_secret_access_key=secret_access_key,
        region_name="auto",
        config=Config(
            retries={"max_attempts": 8, "mode": "adaptive"},
            connect_timeout=10,
            read_timeout=60,
        ),
    )


def is_missing_object_error(exc) -> bool:
    """True only when ``exc`` verifiably means the object does not exist.

    Handles both the ``get_object`` shape (``Error.Code`` == ``NoSuchKey``) and
    the ``head_object`` shape (``Error.Code`` == ``404`` and/or an
    ``HTTPStatusCode`` of 404). Any exception without an S3 error payload — a
    raw ``ConnectionError`` and friends — is treated as *not* missing.
    """
    response = getattr(exc, "response", None)
    if not isinstance(response, dict):
        return False
    code = (response.get("Error") or {}).get("Code")
    if code in _MISSING_OBJECT_CODES:
        return True
    status = (response.get("ResponseMetadata") or {}).get("HTTPStatusCode")
    return status == 404


def read_json(client, bucket, key) -> ReadResult:
    """Read and parse a JSON object, classifying the outcome.

    Never raises for an expected failure — the caller inspects ``.status`` and
    decides. ``'missing'`` is returned *only* for a verifiable 404; a JSON or
    unicode decode failure is ``'corrupt'``; anything else is ``'transport'``.
    The triggering exception is always attached to ``.error``.
    """
    try:
        response = client.get_object(Bucket=bucket, Key=key)
    except Exception as exc:  # noqa: BLE001 — classification, not suppression
        if is_missing_object_error(exc):
            return ReadResult("missing", None, exc)
        return ReadResult("transport", None, exc)

    try:
        raw = response["Body"].read()
    except Exception as exc:  # noqa: BLE001 — a mid-stream read failure is transport
        return ReadResult("transport", None, exc)

    try:
        text = raw.decode("utf-8") if isinstance(raw, bytes) else raw
        value = json.loads(text)
    except (ValueError, UnicodeDecodeError) as exc:
        return ReadResult("corrupt", None, exc)

    return ReadResult("found", value, None)


def object_exists(client, bucket, key) -> bool:
    """Return whether ``key`` exists via ``head_object``.

    Raises on any non-404 error so a transport failure can never masquerade as
    absence (which would let a caller overwrite live data).
    """
    try:
        client.head_object(Bucket=bucket, Key=key)
        return True
    except Exception as exc:  # noqa: BLE001 — 404 is absence, everything else propagates
        if is_missing_object_error(exc):
            return False
        raise
