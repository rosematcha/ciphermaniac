import tomllib
import unittest
from pathlib import Path


class WranglerPreviewIsolationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = Path(__file__).resolve().parents[3] / "wrangler.toml"
        with path.open("rb") as configuration:
            cls.config = tomllib.load(configuration)

    def test_preview_environment_is_active(self):
        self.assertIn("preview", self.config["env"])
        preview = self.config["env"]["preview"]
        self.assertEqual(preview["vars"]["ENVIRONMENT"], "preview")

    def test_preview_explicitly_overrides_each_storage_collection(self):
        preview = self.config["env"]["preview"]
        for collection in ("kv_namespaces", "r2_buckets", "d1_databases"):
            with self.subTest(collection=collection):
                self.assertIn(collection, preview)
                self.assertIsInstance(preview[collection], list)

    def test_preview_storage_never_reuses_production_resources(self):
        preview = self.config["env"]["preview"]
        production = self.config["env"]["production"]
        for collection, identity in (
            ("kv_namespaces", "id"),
            ("r2_buckets", "bucket_name"),
            ("d1_databases", "database_id"),
        ):
            with self.subTest(collection=collection):
                production_ids = {
                    resource[identity]
                    for environment in (self.config, production)
                    for resource in environment[collection]
                }
                preview_ids = {resource[identity] for resource in preview[collection]}
                self.assertTrue(
                    preview_ids.isdisjoint(production_ids),
                    f"Preview {collection} exposes production storage",
                )
