"""Unit tests for the archetype-art picker's pure half (no network).

The scrape is only as good as the slug-to-card match: every archetype in a
scraped format gets its tile from it, and a miss is a card that has nothing to
do with the deck sitting on the board under the deck's name. The cases below
are the real ones the formats we ship threw at it.
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))

import deck_arts  # noqa: E402


def _card(count, name, set_code, number):
    return {"count": count, "name": name, "set": set_code, "number": number}


class MatchTierTests(unittest.TestCase):
    def test_grades_how_well_a_slug_names_a_card(self):
        cases = [
            ("gardevoir", "Gardevoir ex", 2),
            # Form words the card spells differently.
            ("goodra-hisui", "Hisuian Goodra VSTAR", 2),
            ("inteleon-gmax", "Inteleon VMAX", 2),
            ("eternatus-eternamax", "Eternatus VMAX", 2),
            # Both mega spellings.
            ("lucario-mega", "Mega Lucario ex", 2),
            ("audino-mega", "M Audino-EX", 2),
            # Word order does not matter.
            ("calyrex-shadow-rider", "Shadow Rider Calyrex VMAX", 2),
            # The Lost Zone deck's Giratina is Origin Forme in the art and plain
            # "Giratina VSTAR" in print: a species-only match.
            ("giratina-origin", "Giratina VSTAR", 1),
            # A different Pokemon of the same line does not match.
            ("porygon-z", "Porygon2", 0),
            ("yanmega", "Yanma", 0),
            ("", "Gardevoir ex", 0),
        ]
        for slug, name, tier in cases:
            with self.subTest(slug=slug, name=name):
                self.assertEqual(deck_arts.match_tier(slug, name), tier)


class ThumbnailIdTests(unittest.TestCase):
    def test_pads_numbers_and_uppercases_set_codes(self):
        cases = [
            ("tm", "98", "TM/098"),
            ("SVI", "086", "SVI/086"),
            # Gallery numbers survive intact.
            ("CRZ", "GG05", "CRZ/GG05"),
        ]
        for set_code, number, expected in cases:
            with self.subTest(set_code=set_code, number=number):
                self.assertEqual(deck_arts.thumbnail_id(set_code, number), expected)


class ParsePokemonLineTests(unittest.TestCase):
    def test_reads_count_name_set_and_number(self):
        self.assertEqual(
            deck_arts.parse_pokemon_line("4 Yanmega (TM-98)"),
            {"count": 4, "name": "Yanmega", "set": "TM", "number": "98"},
        )
        # A trainer line carries no print and is skipped.
        self.assertIsNone(deck_arts.parse_pokemon_line("4 Pokémon Collector"))


class ChooseArtsTests(unittest.TestCase):
    def test_one_card_per_sprite_in_sprite_order(self):
        lists = [[_card(4, "Yanmega", "TM", "98"), _card(3, "Magnezone", "TM", "96")]]
        self.assertEqual(deck_arts.choose_arts(["magnezone", "yanmega"], lists), ["TM/096", "TM/098"])

    def test_the_printing_more_of_the_field_ran_wins(self):
        lists = [
            [_card(2, "Gardevoir ex", "SVI", "86")],
            [_card(2, "Gardevoir ex", "SVI", "86")],
            [_card(2, "Gardevoir ex", "PAF", "16")],
        ]
        self.assertEqual(deck_arts.choose_arts(["gardevoir"], lists), ["SVI/086"])

    def test_a_tie_on_play_goes_to_the_card_the_deck_is_named_after(self):
        # A V and its VMAX ride in every list together; the VMAX is the deck.
        lists = [[_card(3, "Lugia V", "SIT", "138"), _card(3, "Lugia VSTAR", "SIT", "139")]]
        self.assertEqual(deck_arts.choose_arts(["lugia"], lists), ["SIT/139"])

    def test_the_stricter_match_beats_a_more_played_loose_one(self):
        lists = [
            [_card(4, "Porygon2", "DRI", "154"), _card(2, "Porygon-Z", "MD", "100")],
            [_card(4, "Porygon2", "DRI", "154")],
        ]
        self.assertEqual(deck_arts.choose_arts(["porygon-z"], lists), ["MD/100"])

    def test_two_sprites_of_one_species_do_not_take_the_same_card(self):
        lists = [[_card(2, "Buzzwole-GX", "CIN", "57"), _card(2, "Buzzwole", "FLI", "77")]]
        self.assertEqual(deck_arts.choose_arts(["buzzwole", "buzzwole"], lists), ["CIN/057", "FLI/077"])

    def test_a_sprite_no_card_is_named_after_falls_back_to_the_field(self):
        # Regigigas Stall's Hoopa is drawn Unbound and printed plain.
        lists = [[_card(4, "Regigigas", "CIN", "84"), _card(2, "Hoopa", "SLG", "55")]]
        self.assertEqual(deck_arts.choose_arts(["blissey"], lists), ["CIN/084"])

    def test_no_decklists_means_no_art_rather_than_a_guess(self):
        self.assertEqual(deck_arts.choose_arts(["gardevoir"], []), [])

    def test_never_more_arts_than_a_tile_draws(self):
        lists = [[_card(1, "Comfey", "LOR", "79"), _card(1, "Cramorant", "LOR", "50"), _card(1, "Sableye", "LOR", "70")]]
        self.assertLessEqual(len(deck_arts.choose_arts(["comfey", "cramorant", "sableye"], lists)), deck_arts.MAX_ARTS)


if __name__ == "__main__":
    unittest.main()
