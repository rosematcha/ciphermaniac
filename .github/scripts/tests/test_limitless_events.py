"""Unit tests for the tournament-ranking reader (no network).

This table is the other shape a metagame arrives in, and every difference from
the ladder's is a place a silent misparse could hide: the share is text in a
cell rather than a fraction in an attribute, the deck's identity is a number,
and the name arrives in two pieces.
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))

import limitless_events as events  # noqa: E402


def _table(*rows: str) -> str:
    return "<table><tr><th>#</th><th></th><th>Deck</th><th>Points</th><th>Share</th></tr>" + "".join(rows) + "</table>"


def _row(rank: int, href: str, name: str, points: str, share: str, icons=(), tag: str = "") -> str:
    # One cell holds every sprite, as the real table does.
    sprites = "<td>" + "".join(f'<img class="pokemon" alt="{slug}">' for slug in icons) + "</td>"
    label = f'{name} <span class="annotation">{tag}</span>' if tag else name
    return f'<tr><td>{rank}</td>{sprites}<td><a href="{href}">{label}</a></td><td>{points}</td><td>{share}</td></tr>'


class ParseRankingTests(unittest.TestCase):
    def test_reads_name_id_icons_points_and_share(self):
        html = _table(_row(1, "/decks/240", "Giratina", "2278", "15.70%", ["giratina-origin"], tag="VSTAR"))
        row = events.parse_ranking_rows(html)[0]
        self.assertEqual(row.name, "Giratina")
        self.assertEqual(row.slug, "240")
        self.assertEqual(row.icons, ["giratina-origin"])
        self.assertEqual(row.count, 2278)
        # A fraction, matching the ladder's rows — the cell's percent is ours to
        # convert, not to pass through.
        self.assertAlmostEqual(row.share, 0.157)

    def test_the_header_row_is_not_a_deck(self):
        self.assertEqual(events.parse_ranking_rows(_table()), [])

    def test_a_variant_tag_is_dropped_when_the_name_stands_alone(self):
        html = _table(_row(1, "/decks/255", "Gardevoir", "2100", "14.47%", tag="ex"))
        self.assertEqual(events.parse_ranking_rows(html)[0].name, "Gardevoir")

    def test_a_variant_tag_separates_two_decks_that_would_collide(self):
        html = _table(
            _row(1, "/decks/240", "Giratina", "2278", "15.70%", tag="VSTAR"),
            _row(2, "/decks/300", "Giratina", "100", "1.00%", tag="LOST"),
        )
        self.assertEqual([r.name for r in events.parse_ranking_rows(html)], ["Giratina VSTAR", "Giratina LOST"])

    def test_at_most_two_sprites_per_row(self):
        html = _table(_row(1, "/decks/1", "Box", "10", "1.00%", ["comfey", "sableye", "cramorant"]))
        self.assertEqual(events.parse_ranking_rows(html)[0].icons, ["comfey", "sableye"])


class TopArchetypesTests(unittest.TestCase):
    def test_cuts_at_the_rank_rather_than_at_a_share(self):
        html = _table(*[_row(i, f"/decks/{i}", f"Deck {i}", "10", "0.01%") for i in range(1, 6)])
        rows = events.top_archetypes(events.parse_ranking_rows(html), 3)
        # Every row here is far under the ladder's share floor and all three are
        # kept: rank is the whole cut.
        self.assertEqual([r.name for r in rows], ["Deck 1", "Deck 2", "Deck 3"])

    def test_a_shorter_table_than_the_cut_is_not_padded(self):
        html = _table(_row(1, "/decks/1", "Only", "10", "1.00%"))
        self.assertEqual(len(events.top_archetypes(events.parse_ranking_rows(html), 22)), 1)


class ParseDeckPokemonTests(unittest.TestCase):
    HTML = """
      <div class="decklist-column">
        <div class="decklist-column-heading">Pok&eacute;mon (14.41)</div>
        <div class="decklist-card" data-set="LOR" data-number="130">
          <a class="card-link"><span class="card-count">3.03</span><span class="card-name">Giratina V</span></a>
        </div>
        <div class="decklist-card" data-set="LOR" data-number="131">
          <a class="card-link"><span class="card-count">2.99</span><span class="card-name">Giratina VSTAR</span></a>
        </div>
      </div>
      <div class="decklist-column">
        <div class="decklist-column-heading">Trainer (32.1)</div>
        <div class="decklist-card" data-set="BRS" data-number="132">
          <a class="card-link"><span class="card-count">3.00</span><span class="card-name">Boss's Orders</span></a>
        </div>
      </div>
    """

    def test_reads_the_pokemon_column_and_only_it(self):
        cards = events.parse_deck_pokemon(self.HTML)
        self.assertEqual([c["name"] for c in cards], ["Giratina V", "Giratina VSTAR"])

    def test_counts_are_averages_and_stay_fractional(self):
        self.assertEqual(events.parse_deck_pokemon(self.HTML)[0]["count"], 3.03)

    def test_a_page_with_no_pokemon_column_yields_nothing(self):
        self.assertEqual(events.parse_deck_pokemon("<div></div>"), [])


if __name__ == "__main__":
    unittest.main()
