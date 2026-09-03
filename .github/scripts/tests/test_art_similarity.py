"""Tests for the card-art comparison used to collapse duplicate printings.

The fixtures are synthetic cards rather than real scans: a seeded block-noise
"illustration" pasted into the art band of a blank card. That keeps the suite
offline and deterministic while still exercising the real code path — the same
resize, band crop, ORB/template proposal and dense verification a Rare Candy
printing goes through.
"""

import importlib.util
import sys
import unittest
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))

import art_similarity as art  # noqa: E402


def _load_build_module():
    script_path = Path(__file__).resolve().parents[1] / "build-art-groups.py"
    spec = importlib.util.spec_from_file_location("build_art_groups", script_path)
    if not spec or not spec.loader:
        raise RuntimeError(f"Unable to load build-art-groups module from {script_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


build = _load_build_module()

# Where a synthetic illustration is pasted. Comfortably inside the art band the
# comparison crops, so a modest offset still leaves the drawing fully visible.
ART_BOX = (48, 70, 364, 220)  # x, y, w, h


def illustration(seed: int, width: int, height: int) -> np.ndarray:
    """A seeded, smoothly-interpolated block pattern — plenty of corners."""
    rng = np.random.default_rng(seed)
    blocks = rng.integers(0, 256, (9, 12, 3), dtype=np.uint8)
    return cv2.resize(blocks, (width, height), interpolation=cv2.INTER_LINEAR)


def card(seed: int, offset=(0, 0), zoom: float = 1.0, recolour: bool = False) -> np.ndarray:
    """A blank card carrying one seeded illustration in its art band."""
    x, y, w, h = ART_BOX
    drawn = illustration(seed, int(w * zoom), int(h * zoom))
    if recolour:
        # Invert Lab chroma: identical luminance (so structure still matches
        # perfectly) with a wholly different colourway — a gold secret rare.
        lab = cv2.cvtColor(drawn, cv2.COLOR_BGR2LAB).astype(np.int16)
        lab[:, :, 1:] = 255 - lab[:, :, 1:]
        drawn = cv2.cvtColor(lab.astype(np.uint8), cv2.COLOR_LAB2BGR)

    canvas = np.full((art.CARD_H, art.CARD_W, 3), 235, np.uint8)
    top, left = y + offset[1], x + offset[0]
    fit = drawn[:art.CARD_H - top, :art.CARD_W - left]
    canvas[top:top + fit.shape[0], left:left + fit.shape[1]] = fit
    return canvas


def bands(seed: int, **kwargs) -> art.ArtBands:
    return art.ArtBands(card(seed, **kwargs))


class SameArtTest(unittest.TestCase):
    def test_identical_printings_match(self):
        ncc, chroma = art.compare(bands(1), bands(1))
        self.assertGreaterEqual(ncc, art.NCC_THRESHOLD)
        self.assertTrue(art.is_same_art(ncc, chroma))

    def test_shifted_printing_still_matches(self):
        # Reprints re-position the illustration by a few percent of the card.
        ncc, chroma = art.compare(bands(2), bands(2, offset=(14, 10)))
        self.assertTrue(art.is_same_art(ncc, chroma), f"ncc={ncc} chroma={chroma}")

    def test_rescaled_printing_still_matches(self):
        # A promo reprint of the same illustration, framed slightly tighter.
        ncc, chroma = art.compare(bands(3), bands(3, zoom=1.12))
        self.assertTrue(art.is_same_art(ncc, chroma), f"ncc={ncc} chroma={chroma}")

    def test_different_illustrations_do_not_match(self):
        ncc, chroma = art.compare(bands(4), bands(5))
        self.assertLess(ncc, art.NCC_THRESHOLD)
        self.assertFalse(art.is_same_art(ncc, chroma))


class ColourwayTest(unittest.TestCase):
    def test_recolour_keeps_structure_but_is_not_the_same_art(self):
        # The gold/black/alternate-background variants: one drawing, two arts.
        ncc, chroma = art.compare(bands(6), bands(6, recolour=True))
        self.assertGreaterEqual(ncc, art.NCC_THRESHOLD, "structure should still align")
        self.assertGreater(chroma, art.CHROMA_THRESHOLD, "colourway should differ")
        self.assertFalse(art.is_same_art(ncc, chroma))

    def test_threshold_predicate_needs_both_halves(self):
        self.assertTrue(art.is_same_art(art.NCC_THRESHOLD, art.CHROMA_THRESHOLD))
        self.assertFalse(art.is_same_art(art.NCC_THRESHOLD - 0.01, 0.0))
        self.assertFalse(art.is_same_art(1.0, art.CHROMA_THRESHOLD + 0.01))


class GroupingTest(unittest.TestCase):
    def setUp(self):
        # Two arts across five printings, deliberately interleaved so a bug
        # that groups by adjacency rather than by content would show.
        self.cards = {
            "AAA::001": bands(7),
            "BBB::002": bands(8),
            "CCC::003": bands(7, offset=(10, 6)),
            "DDD::004": bands(8, zoom=1.08),
            "EEE::005": bands(7, zoom=0.94),
        }

    def test_groups_printings_that_share_art(self):
        groups = art.group_by_art(list(self.cards), self.cards.__getitem__)
        self.assertEqual(
            sorted(sorted(g) for g in groups),
            [["AAA::001", "CCC::003", "EEE::005"], ["BBB::002", "DDD::004"]],
        )

    def test_preserves_input_order_within_and_between_groups(self):
        groups = art.group_by_art(list(self.cards), self.cards.__getitem__)
        self.assertEqual(groups[0], ["AAA::001", "CCC::003", "EEE::005"])
        self.assertEqual(groups[1], ["BBB::002", "DDD::004"])

    def test_single_printing_is_its_own_group(self):
        self.assertEqual(art.group_by_art(["X::1"], {"X::1": bands(9)}.__getitem__), [["X::1"]])

    def test_scores_every_pair(self):
        scored = art.score_all_pairs(list(self.cards), self.cards.__getitem__)
        self.assertEqual(len(scored), 10)
        self.assertEqual(scored, sorted(scored, reverse=True))


class ParameterSignatureTest(unittest.TestCase):
    def test_is_stable_across_calls(self):
        self.assertEqual(art.parameter_signature(), art.parameter_signature())

    def test_changes_when_a_threshold_is_retuned(self):
        before = art.parameter_signature()
        original = art.NCC_THRESHOLD
        try:
            art.NCC_THRESHOLD = original + 0.01
            self.assertNotEqual(art.parameter_signature(), before)
        finally:
            art.NCC_THRESHOLD = original
        self.assertEqual(art.parameter_signature(), before)


class ClustersFromSynonymsTest(unittest.TestCase):
    def test_groups_prints_by_reprint_cluster_in_release_order(self):
        database = {
            "prints": {
                "Rare Candy::SVI::191": 0.1,
                "Ultra Ball::DEX::102": 0.5,
                "Rare Candy::PAF::089": 0.2,
            },
            "synonyms": {"Rare Candy::PAF::089": "Rare Candy::SVI::191"},
        }
        self.assertEqual(
            build.clusters_from_synonyms(database),
            {
                "Rare Candy::SVI::191": {"name": "Rare Candy", "prints": ["SVI::191", "PAF::089"]},
                "Ultra Ball::DEX::102": {"name": "Ultra Ball", "prints": ["DEX::102"]},
            },
        )

    def test_splits_one_name_that_covers_two_different_cards(self):
        # The Obsidian Flames Charizard ex and the 151 one share a name and
        # nothing else; ranking their art together is the bug this prevents.
        database = {
            "prints": {
                "Charizard ex::OBF::125": 1.0,
                "Charizard ex::PAF::054": 1.0,
                "Charizard ex::MEW::006": 1.0,
                "Charizard ex::MEW::183": 1.0,
            },
            "synonyms": {
                "Charizard ex::PAF::054": "Charizard ex::OBF::125",
                "Charizard ex::MEW::183": "Charizard ex::MEW::006",
            },
        }
        self.assertEqual(
            build.clusters_from_synonyms(database),
            {
                "Charizard ex::OBF::125": {"name": "Charizard ex", "prints": ["OBF::125", "PAF::054"]},
                "Charizard ex::MEW::006": {"name": "Charizard ex", "prints": ["MEW::006", "MEW::183"]},
            },
        )

    def test_keys_on_the_earliest_print_not_the_rolling_canonical(self):
        # Canonicals move when prices and legality do. Keying on one would
        # rebuild every grouping and break every shared tier list with it.
        database = {
            "prints": {"Rare Candy::SVI::191": 0.1, "Rare Candy::PAF::089": 0.2},
            "synonyms": {"Rare Candy::SVI::191": "Rare Candy::PAF::089"},
        }
        self.assertEqual(list(build.clusters_from_synonyms(database)), ["Rare Candy::SVI::191"])

    def test_a_print_with_no_synonym_edge_is_its_own_cluster(self):
        database = {"prints": {"Iono::PAL::185": 1.0}, "synonyms": {}}
        self.assertEqual(
            build.clusters_from_synonyms(database),
            {"Iono::PAL::185": {"name": "Iono", "prints": ["PAL::185"]}},
        )

    def test_follows_a_synonym_chain_to_one_cluster(self):
        database = {
            "prints": {"Boss's Orders::RCL::154": 1.0, "Boss's Orders::SHF::058": 1.0,
                       "Boss's Orders::BRS::132": 1.0},
            "synonyms": {"Boss's Orders::SHF::058": "Boss's Orders::BRS::132",
                         "Boss's Orders::BRS::132": "Boss's Orders::RCL::154"},
        }
        self.assertEqual(
            build.clusters_from_synonyms(database),
            {"Boss's Orders::RCL::154": {
                "name": "Boss's Orders",
                "prints": ["RCL::154", "SHF::058", "BRS::132"],
            }},
        )

    def test_a_cyclic_synonym_map_terminates(self):
        database = {
            "prints": {"Potion::A::001": 1.0, "Potion::B::002": 1.0},
            "synonyms": {"Potion::A::001": "Potion::B::002", "Potion::B::002": "Potion::A::001"},
        }
        clusters = build.clusters_from_synonyms(database)
        self.assertEqual(sum(len(c["prints"]) for c in clusters.values()), 2)

    def test_skips_malformed_uids_and_missing_prints(self):
        self.assertEqual(build.clusters_from_synonyms({}), {})
        self.assertEqual(build.clusters_from_synonyms({"prints": {"Rare Candy": 1}}), {})


class SelectByNameTest(unittest.TestCase):
    CLUSTERS = {
        "Charizard ex::OBF::125": {"name": "Charizard ex", "prints": ["OBF::125"]},
        "Charizard ex::MEW::006": {"name": "Charizard ex", "prints": ["MEW::006"]},
        "Iono::PAL::185": {"name": "Iono", "prints": ["PAL::185"]},
    }

    def test_one_name_selects_every_cluster_under_it(self):
        self.assertEqual(
            sorted(build.select_by_name(self.CLUSTERS, {"Charizard ex"})),
            ["Charizard ex::MEW::006", "Charizard ex::OBF::125"],
        )

    def test_an_unknown_name_selects_nothing(self):
        self.assertEqual(build.select_by_name(self.CLUSTERS, {"Pidgey"}), {})


class SignatureTest(unittest.TestCase):
    def test_depends_on_the_printing_list(self):
        self.assertEqual(build.signature(["A::1", "B::2"]), build.signature(["A::1", "B::2"]))
        self.assertNotEqual(build.signature(["A::1"]), build.signature(["A::1", "B::2"]))

    def test_is_order_sensitive_so_a_reordered_cluster_rebuilds(self):
        # Order carries the release sequence, which picks each group's
        # representative — a reshuffle is a real change.
        self.assertNotEqual(build.signature(["A::1", "B::2"]), build.signature(["B::2", "A::1"]))


class BareNumberTest(unittest.TestCase):
    def test_strips_the_cdn_zero_padding(self):
        self.assertEqual(build._bare_number("090"), "90")
        self.assertEqual(build._bare_number("007"), "7")
        self.assertEqual(build._bare_number("191"), "191")

    def test_keeps_trailing_letters(self):
        self.assertEqual(build._bare_number("068A"), "68A")

    def test_passes_through_unparseable_numbers(self):
        self.assertEqual(build._bare_number("TG24"), "TG24")


class SummariseTest(unittest.TestCase):
    def test_counts_prints_arts_and_collapsed_duplicates(self):
        cards = {
            "Rare Candy::UL::082": {"arts": [["SVI::191", "PAF::089"], ["UL::082"]], "unmatched": []},
            "Ultra Ball::DEX::102": {"arts": [["DEX::102"]], "unmatched": ["XX::999"]},
        }
        self.assertEqual(
            build.summarise(cards),
            {"cards": 2, "prints": 4, "arts": 3, "collapsed": 1, "unmatched": 1},
        )


if __name__ == "__main__":
    unittest.main()
