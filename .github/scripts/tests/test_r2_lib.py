import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))
import r2  # noqa: E402


class _Body:
    def __init__(self, payload):
        self._payload = payload

    def read(self):
        return self._payload


class _S3Error(Exception):
    """Mimics botocore.ClientError's ``.response`` payload shape."""

    def __init__(self, code=None, status=None):
        super().__init__(code or status)
        error = {}
        if code is not None:
            error["Code"] = code
        response = {"Error": error}
        if status is not None:
            response["ResponseMetadata"] = {"HTTPStatusCode": status}
        self.response = response


class _GetClient:
    def __init__(self, *, payload=None, error=None):
        self._payload = payload
        self._error = error

    def get_object(self, Bucket, Key):
        if self._error is not None:
            raise self._error
        return {"Body": _Body(self._payload)}


class _HeadClient:
    def __init__(self, error=None):
        self._error = error

    def head_object(self, Bucket, Key):
        if self._error is not None:
            raise self._error
        return {"ContentLength": 0}


class ReadJsonTest(unittest.TestCase):
    def test_found_returns_parsed_value(self):
        client = _GetClient(payload=b'{"a": 1, "b": [2, 3]}')
        result = r2.read_json(client, "bucket", "key")
        self.assertEqual(result.status, "found")
        self.assertEqual(result.value, {"a": 1, "b": [2, 3]})
        self.assertIsNone(result.error)

    def test_missing_on_verifiable_404(self):
        client = _GetClient(error=_S3Error("NoSuchKey"))
        result = r2.read_json(client, "bucket", "key")
        self.assertEqual(result.status, "missing")
        self.assertIsNone(result.value)
        self.assertIsNotNone(result.error)

    def test_corrupt_on_bad_json(self):
        client = _GetClient(payload=b"{not valid json")
        result = r2.read_json(client, "bucket", "key")
        self.assertEqual(result.status, "corrupt")
        self.assertIsNotNone(result.error)

    def test_corrupt_on_bad_unicode(self):
        client = _GetClient(payload=b"\xff\xfe not utf-8")
        result = r2.read_json(client, "bucket", "key")
        self.assertEqual(result.status, "corrupt")

    def test_transport_on_non_404_error(self):
        client = _GetClient(error=ConnectionError("connection reset"))
        result = r2.read_json(client, "bucket", "key")
        self.assertEqual(result.status, "transport")
        self.assertIsInstance(result.error, ConnectionError)

    def test_access_denied_is_transport_not_missing(self):
        client = _GetClient(error=_S3Error("AccessDenied"))
        result = r2.read_json(client, "bucket", "key")
        self.assertEqual(result.status, "transport")


class ObjectExistsTest(unittest.TestCase):
    def test_true_when_head_succeeds(self):
        self.assertTrue(r2.object_exists(_HeadClient(), "bucket", "key"))

    def test_false_on_404_code(self):
        client = _HeadClient(error=_S3Error("404", status=404))
        self.assertFalse(r2.object_exists(client, "bucket", "key"))

    def test_false_on_not_found_status_only(self):
        # A head_object 404 sometimes carries only the HTTP status, no Error.Code.
        client = _HeadClient(error=_S3Error(status=404))
        self.assertFalse(r2.object_exists(client, "bucket", "key"))

    def test_raises_on_transport(self):
        client = _HeadClient(error=ConnectionError("connection reset"))
        with self.assertRaises(ConnectionError):
            r2.object_exists(client, "bucket", "key")

    def test_raises_on_access_denied(self):
        client = _HeadClient(error=_S3Error("AccessDenied", status=403))
        with self.assertRaises(_S3Error):
            r2.object_exists(client, "bucket", "key")


class MakeR2ClientTest(unittest.TestCase):
    def test_sets_adaptive_retries_and_timeouts(self):
        client = r2.make_r2_client("acct", "key-id", "secret")
        config = client.meta.config
        # botocore normalizes max_attempts=8 (retries) to total_max_attempts=9
        # (the initial try plus 8 retries) and keeps the adaptive mode, which is
        # what gives us exponential backoff with jitter.
        self.assertEqual(config.retries["mode"], "adaptive")
        self.assertEqual(config.retries["total_max_attempts"], 9)
        self.assertEqual(config.connect_timeout, 10)
        self.assertEqual(config.read_timeout, 60)


if __name__ == "__main__":
    unittest.main()
