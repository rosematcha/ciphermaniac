import importlib.util
import json
import unittest
from pathlib import Path


def _load_download_module():
    script_path = Path(__file__).resolve().parents[1] / "download-tournament.py"
    spec = importlib.util.spec_from_file_location("download_tournament", script_path)
    if not spec or not spec.loader:
        raise RuntimeError(f"Unable to load download-tournament module from {script_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


download_tournament = _load_download_module()


class _FakeBody:
    def __init__(self, payload: str):
        self._payload = payload

    def read(self):
        return self._payload.encode("utf-8")


class _FakeNoSuchKey(Exception):
    pass


class _FakeR2Client:
    class exceptions:
        NoSuchKey = _FakeNoSuchKey

    def __init__(self, objects):
        self._objects = dict(objects)
        self.put_calls = []
        self.deleted_keys = []

    def get_object(self, Bucket, Key):
        if Key not in self._objects:
            raise self.exceptions.NoSuchKey(Key)
        return {"Body": _FakeBody(self._objects[Key]), "ETag": f'"{Key}"'}

    def put_object(self, Bucket, Key, Body, ContentType, **kwargs):
        body_text = Body if isinstance(Body, str) else Body.decode("utf-8")
        self._objects[Key] = body_text
        self.put_calls.append(
            {
                "Bucket": Bucket,
                "Key": Key,
                "Body": body_text,
                "ContentType": ContentType,
                "kwargs": kwargs,
            }
        )

    def delete_object(self, Bucket, Key):
        self._objects.pop(Key, None)
        self.deleted_keys.append(Key)

    def list_objects_v2(self, Bucket, Prefix, Delimiter, ContinuationToken=None):
        folders = []
        for key in self._objects.keys():
            if not key.startswith("reports/"):
                continue
            remainder = key[len("reports/") :]
            if "/" not in remainder:
                continue
            folder = remainder.split("/", 1)[0]
            if folder:
                folders.append(folder)

        unique_sorted = sorted(set(folders))
        return {
            "IsTruncated": False,
            "CommonPrefixes": [{"Prefix": f"reports/{name}/"} for name in unique_sorted],
        }


class DownloadTournamentTests(unittest.TestCase):
    def test_parse_start_date_supports_cross_month_ranges(self):
        iso, raw = download_tournament.parse_start_date("February 27–March 1, 2026")
        self.assertEqual(iso, "2026-02-27")
        self.assertEqual(raw, "February 27–March 1, 2026")

        iso2, _ = download_tournament.parse_start_date("November 30–December 1, 2024")
        self.assertEqual(iso2, "2024-11-30")

        iso3, _ = download_tournament.parse_start_date("May 31–June 1, 2025")
        self.assertEqual(iso3, "2025-05-31")

    def test_sort_tournament_names_by_recency_mixed_entries(self):
        tournaments = [
            "Special Event Bologna",
            "2025-11-29, Regional Championship Stuttgart",
            "2026-02-13, International Championship London",
            "Regional Championship Stuttgart",
        ]
        meta_map = {
            "Special Event Bologna": {"date": "May 31–June 1, 2025", "startDate": None},
            "Regional Championship Stuttgart": {"date": "November 30–December 1, 2024", "startDate": None},
        }

        sorted_names = download_tournament.sort_tournament_names_by_recency(tournaments, meta_map)
        self.assertEqual(
            sorted_names,
            [
                "2026-02-13, International Championship London",
                "2025-11-29, Regional Championship Stuttgart",
                "Special Event Bologna",
                "Regional Championship Stuttgart",
            ],
        )

    def test_update_tournaments_json_uses_date_aware_ordering(self):
        existing = [
            "Special Event Bologna",
            "2026-02-13, International Championship London",
            "Regional Championship Stuttgart",
            "Regional Championship Seattle",
        ]
        objects = {
            "reports/tournaments.json": json.dumps(existing),
            "reports/Special Event Bologna/meta.json": json.dumps(
                {"date": "May 31–June 1, 2025", "startDate": None}
            ),
            "reports/Regional Championship Stuttgart/meta.json": json.dumps(
                {"date": "November 30–December 1, 2024", "startDate": None}
            ),
            "reports/Regional Championship Seattle/meta.json": json.dumps(
                {"date": "February 27–March 1, 2026", "startDate": None}
            ),
        }
        client = _FakeR2Client(objects)

        download_tournament.update_tournaments_json(
            client,
            "bucket",
            "2026-02-27, Regional Championship Seattle",
        )

        uploaded = json.loads(client._objects["reports/tournaments.json"])
        self.assertEqual(
            uploaded,
            [
                "2026-02-27, Regional Championship Seattle",
                "2026-02-13, International Championship London",
            ],
        )

    def test_dedupe_tournament_names_removes_undated_alias_when_dated_exists(self):
        tournaments = [
            "2026-02-27, Regional Championship Seattle",
            "Regional Championship Seattle",
            "2025-11-29, Regional Championship Stuttgart",
            "Regional Championship Stuttgart",
        ]
        meta_map = {
            "Regional Championship Seattle": {"date": "February 27–March 1, 2026", "startDate": None},
            "Regional Championship Stuttgart": {"date": "November 30–December 1, 2024", "startDate": None},
        }

        deduped = download_tournament.dedupe_tournament_names(tournaments, meta_map)
        self.assertEqual(
            deduped,
            [
                "2026-02-27, Regional Championship Seattle",
                "2025-11-29, Regional Championship Stuttgart",
                "Regional Championship Stuttgart",
            ],
        )

    def test_filter_dated_tournament_names_drops_undated_entries(self):
        tournaments = [
            "2026-02-27, Regional Championship Seattle",
            "Regional Championship Seattle",
            "2025-11-29, Regional Championship Stuttgart",
            "Regional Championship Stuttgart",
        ]
        filtered = download_tournament.filter_dated_tournament_names(tournaments)
        self.assertEqual(
            filtered,
            [
                "2026-02-27, Regional Championship Seattle",
                "2025-11-29, Regional Championship Stuttgart",
            ],
        )

    def test_update_tournaments_json_aborts_on_transient_read_error(self):
        # A non-NoSuchKey failure reading the index must abort without a PUT so a
        # transient R2 error can't replace the whole index with one entry (P-01).
        class _FlakyClient(_FakeR2Client):
            def get_object(self, Bucket, Key):
                if Key == "reports/tournaments.json":
                    raise RuntimeError("simulated 500 from R2")
                return super().get_object(Bucket, Key)

        client = _FlakyClient({"reports/tournaments.json": json.dumps(["Existing Event"])})
        with self.assertRaises(RuntimeError):
            download_tournament.update_tournaments_json(client, "bucket", "New Event")
        index_puts = [c for c in client.put_calls if c["Key"] == "reports/tournaments.json"]
        self.assertEqual(index_puts, [])
        # Original index left untouched.
        self.assertEqual(json.loads(client._objects["reports/tournaments.json"]), ["Existing Event"])

    def test_update_tournaments_json_uses_conditional_put(self):
        objects = {
            "reports/tournaments.json": json.dumps(["2026-02-13, International Championship London"]),
            "reports/2026-02-13, International Championship London/meta.json": json.dumps(
                {"date": "February 13–15, 2026", "startDate": "2026-02-13"}
            ),
            "reports/2026-02-27, Regional Championship Seattle/meta.json": json.dumps(
                {"date": "February 27–March 1, 2026", "startDate": "2026-02-27"}
            ),
        }
        client = _FakeR2Client(objects)
        download_tournament.update_tournaments_json(
            client, "bucket", "2026-02-27, Regional Championship Seattle"
        )
        index_put = next(c for c in client.put_calls if c["Key"] == "reports/tournaments.json")
        # An existing object → If-Match guard against a concurrent overwrite (P-07).
        self.assertEqual(index_put["kwargs"].get("IfMatch"), '"reports/tournaments.json"')

    def test_delete_from_r2_removes_key(self):
        client = _FakeR2Client({"reports/x/conversion.json": "{}"})
        download_tournament.delete_from_r2(client, "bucket", "reports/x/conversion.json")
        self.assertNotIn("reports/x/conversion.json", client._objects)
        self.assertIn("reports/x/conversion.json", client.deleted_keys)

    def test_rebuild_tournaments_json_from_reports_dry_run_does_not_upload(self):
        objects = {
            "reports/2026-02-13, International Championship London/meta.json": json.dumps(
                {"date": "February 13–15, 2026", "startDate": "2026-02-13"}
            ),
            "reports/Regional Championship Seattle/meta.json": json.dumps(
                {"date": "February 27–March 1, 2026", "startDate": None}
            ),
            "reports/tournaments.json": json.dumps([]),
        }
        client = _FakeR2Client(objects)

        rebuilt = download_tournament.rebuild_tournaments_json_from_reports(client, "bucket", dry_run=True)
        self.assertEqual(rebuilt, ["2026-02-13, International Championship London"])
        self.assertEqual(client.put_calls, [])


class CardUsageAndConversionTests(unittest.TestCase):
    def _archetype_map(self):
        # Two archetypes; the second lists Boss's Orders under a variant printing
        # that the synonyms map collapses onto the canonical MEG::114.
        return {
            "dragapult_dusknoir": {
                "cards": {
                    "deckTotal": 4,
                    "items": [
                        {
                            "name": "Boss's Orders",
                            "uid": "Boss's Orders::MEG::114",
                            "set": "MEG",
                            "number": "114",
                            "found": 3,
                            "dist": [
                                {"copies": 1, "players": 2},
                                {"copies": 2, "players": 1},
                            ],
                        }
                    ],
                }
            },
            "gardevoir": {
                "cards": {
                    "deckTotal": 2,
                    "items": [
                        {
                            "name": "Boss's Orders",
                            "uid": "Boss's Orders::SVI::100",
                            "set": "SVI",
                            "number": "100",
                            "found": 1,
                            "dist": [{"copies": 1, "players": 1}],
                        }
                    ],
                }
            },
        }

    def test_build_card_usage_index_collapses_variants_to_canonical(self):
        synonyms = {"Boss's Orders::SVI::100": "Boss's Orders::MEG::114"}
        result = download_tournament.build_card_usage_index(self._archetype_map(), synonyms, {})
        usage = result["usage"]
        # Both archetypes now key onto the canonical UID.
        self.assertIn("Boss's Orders::MEG::114", usage)
        self.assertNotIn("Boss's Orders::SVI::100", usage)
        entries = {e["slug"]: e for e in usage["Boss's Orders::MEG::114"]}
        self.assertEqual(entries["dragapult_dusknoir"]["found"], 3)
        # pct = found / deckTotal * 100 = 3/4 * 100
        self.assertEqual(entries["dragapult_dusknoir"]["pct"], 75.0)
        self.assertEqual(entries["gardevoir"]["found"], 1)
        self.assertEqual(entries["gardevoir"]["pct"], 50.0)
        # dist percents recomputed against found.
        d1 = next(d for d in entries["dragapult_dusknoir"]["dist"] if d["copies"] == 1)
        self.assertAlmostEqual(d1["percent"], round(2 / 3 * 100, 2))

    def test_build_conversion_index_buckets_by_canonical_uid(self):
        synonyms = {"Boss's Orders::SVI::100": "Boss's Orders::MEG::114"}
        decks = [
            {"madePhase2": True, "cards": [{"name": "Boss's Orders", "set": "MEG", "number": "114", "count": 1}]},
            {"madePhase2": False, "cards": [{"name": "Boss's Orders", "set": "SVI", "number": "100", "count": 2}]},
            # A deck listing the same canonical card twice counts once.
            {
                "madePhase2": True,
                "cards": [
                    {"name": "Boss's Orders", "set": "MEG", "number": "114", "count": 1},
                    {"name": "Boss's Orders", "set": "SVI", "number": "100", "count": 1},
                ],
            },
        ]
        result = download_tournament.build_conversion_index(decks, synonyms, {})
        self.assertEqual(result["day1Total"], 3)
        self.assertEqual(result["day2Total"], 2)
        card = result["cards"]["Boss's Orders::MEG::114"]
        self.assertEqual(card["day1"], 3)
        self.assertEqual(card["day2"], 2)

    def test_build_conversion_index_returns_none_without_a_cut(self):
        decks = [{"madePhase2": False, "cards": [{"name": "X", "set": "MEG", "number": "1", "count": 1}]}]
        self.assertIsNone(download_tournament.build_conversion_index(decks, {}, {}))

    def test_resolve_canonical_uid_matches_frontend_rules(self):
        synonyms = {"A::S1::002": "A::S1::001"}
        canonicals = {"BareName": "BareName::S1::009"}
        self.assertEqual(download_tournament.resolve_canonical_uid("A::S1::002", synonyms, canonicals), "A::S1::001")
        # Unknown UID is its own canonical.
        self.assertEqual(download_tournament.resolve_canonical_uid("A::S1::003", synonyms, canonicals), "A::S1::003")
        # Name-only prefers canonicals.
        self.assertEqual(download_tournament.resolve_canonical_uid("BareName", synonyms, canonicals), "BareName::S1::009")


def _print(set_code, number, price):
    return {"set": set_code, "number": number, "price_usd": price}


class ChooseCanonicalPrintTests(unittest.TestCase):
    """Real print tables scraped from Limitless, chooser expectations agreed with Reese."""

    def _choose(self, variations, card_name):
        result = download_tournament.choose_canonical_print(variations, card_name)
        self.assertIsNotNone(result)
        return (result["set"], result["number"])

    def test_pokemon_prefers_oldest_cheap_standard_print(self):
        # Dreepy: ASC 247 is a collector print; TWM is the oldest cheap legal print.
        variations = [
            _print("TWM", "128", 0.24),
            _print("PRE", "071", 0.15),
            _print("ASC", "158", 0.19),
            _print("ASC", "247", 10.68),
        ]
        self.assertEqual(self._choose(variations, "Dreepy"), ("TWM", "128"))

    def test_rotated_prints_are_excluded(self):
        # Boss's Orders: everything before MEG has rotated; ASC 256 is a secret rare.
        variations = [
            _print("SP", "251", 13.57),
            _print("RCL", "154", 1.35),
            _print("RCL", "189", 67.04),
            _print("RCL", "200", 46.56),
            _print("SHF", "058", 0.31),
            _print("BRS", "132", 0.44),
            _print("LOR", "TG24", 10.96),
            _print("PAL", "172", 0.32),
            _print("PAL", "248", 11.18),
            _print("PAL", "265", 19.95),
            _print("MEG", "114", 0.25),
            _print("ASC", "183", 0.23),
            _print("ASC", "256", 8.05),
        ]
        self.assertEqual(self._choose(variations, "Boss's Orders"), ("MEG", "114"))

    def test_single_legal_print_wins_regardless_of_age(self):
        # Pokegear 3.0: only the Black Bolt print is still standard legal.
        variations = [
            _print("HS", "096", 11.78),
            _print("UNB", "182B", 2.25),
            _print("UNB", "182A", 26.99),
            _print("UNB", "182", 0.95),
            _print("UNB", "233", 47.12),
            _print("SSH", "174", 0.34),
            _print("SVI", "186", 0.32),
            _print("BLK", "084", 0.29),
        ]
        self.assertEqual(self._choose(variations, "Pokegear 3.0"), ("BLK", "084"))

    def test_basic_energy_prefers_newest_cheap_print(self):
        # Fire Energy: gold prints (CRZ/OBF) and rotated sets drop out; the
        # newest cheap legal print (MEE) beats the SVE energy-set prints.
        variations = [
            _print("BS", "098", 0.37),
            _print("EVO", "092", 0.29),
            _print("SUM", "R", 0.17),
            _print("TEU", "R", 0.14),
            _print("SSH", "R", 0.28),
            _print("FST", "284", 6.34),
            _print("BRS", "R", None),
            _print("CRZ", "153", 3.59),
            _print("SVE", "002", 0.19),
            _print("SVE", "010", 0.11),
            _print("SVE", "018", 0.19),
            _print("OBF", "230", 3.55),
            _print("MEE", "002", 0.22),
        ]
        self.assertEqual(self._choose(variations, "Fire Energy"), ("MEE", "002"))

    def test_expensive_promo_loses_to_cheap_set_print(self):
        # Psyduck: the original Mega Promos print is priced out of reach, so
        # the accessible Ascended Heroes print is canonical despite being newer.
        variations = [
            _print("MEP", "007", 10.91),
            _print("ASC", "039", 0.26),
            _print("ASC", "226", 83.72),
        ]
        self.assertEqual(self._choose(variations, "Psyduck"), ("ASC", "039"))

    def test_promo_only_card_uses_most_accessible_promo(self):
        # Pecharunt: promo-only, so the cheap promo wins over the older one.
        variations = [
            _print("SVP", "129", 2.05),
            _print("SVP", "149", 0.76),
        ]
        self.assertEqual(self._choose(variations, "Pecharunt"), ("SVP", "149"))

    def test_reprinted_original_stays_canonical_once_affordable(self):
        # Poke Pad: the original ASC print settled back to a reasonable price,
        # so it beats the newer POR reprint; POR 113 is a collector print.
        variations = [
            _print("ASC", "198", 0.43),
            _print("POR", "081", 0.30),
            _print("POR", "113", 12.82),
        ]
        self.assertEqual(self._choose(variations, "Poke Pad"), ("ASC", "198"))

    def test_unpriced_prints_lose_to_priced_ones(self):
        variations = [
            _print("MEG", "050", None),
            _print("ASC", "010", 0.30),
        ]
        self.assertEqual(self._choose(variations, "Some Card"), ("ASC", "010"))

    def test_all_unpriced_falls_back_to_oldest_legal(self):
        variations = [
            _print("MEG", "050", None),
            _print("ASC", "010", None),
        ]
        self.assertEqual(self._choose(variations, "Some Card"), ("MEG", "050"))

    def test_fully_rotated_card_still_gets_a_canonical(self):
        variations = [
            _print("RCL", "154", 1.35),
            _print("BRS", "132", 0.44),
        ]
        self.assertEqual(self._choose(variations, "Boss's Orders"), ("BRS", "132"))


if __name__ == "__main__":
    unittest.main()
