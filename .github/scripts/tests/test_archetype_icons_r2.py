import importlib.util
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import requests

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
spec = importlib.util.spec_from_file_location("archetype_icons_r2", SCRIPTS / "scrape-archetype-icons.py")
icons = importlib.util.module_from_spec(spec)
spec.loader.exec_module(icons)


class ArchetypeIconsR2Tests(unittest.TestCase):
    def test_missing_database_is_empty(self):
        with patch.object(icons.requests, "get", return_value=Mock(status_code=404)):
            self.assertEqual(icons.load_existing(), {})

    def test_failure_does_not_discard_existing_database(self):
        with patch.object(icons.requests, "get", side_effect=requests.Timeout):
            with self.assertRaises(requests.Timeout):
                icons.load_existing()

    def test_invalid_database_is_rejected(self):
        response = Mock(status_code=200)
        response.json.return_value = []
        with patch.object(icons.requests, "get", return_value=response):
            with self.assertRaises(ValueError):
                icons.load_existing()

    def test_publishes_expected_object(self):
        values = {"R2_ACCOUNT_ID": "account", "R2_ACCESS_KEY_ID": "key",
                  "R2_SECRET_ACCESS_KEY": "secret", "R2_BUCKET_NAME": "bucket"}
        with patch.dict(icons.os.environ, values), patch.object(icons, "make_r2_client") as factory:
            icons.publish_icons({"Synthetic Deck": ["synthetic"]})
            arguments = factory.return_value.put_object.call_args.kwargs
            self.assertEqual(arguments["Key"], "assets/archetype-icons.json")
            self.assertEqual(arguments["Bucket"], "bucket")
            self.assertEqual(json.loads(arguments["Body"]), {"Synthetic Deck": ["synthetic"]})

    def test_invalid_publication_never_creates_a_client(self):
        with patch.object(icons, "make_r2_client") as factory:
            for invalid in [{}, {"Deck": ["../bad"]}, {"Deck": []}, {"Deck": "slug"}]:
                with self.assertRaises(ValueError):
                    icons.publish_icons(invalid)
            factory.assert_not_called()
