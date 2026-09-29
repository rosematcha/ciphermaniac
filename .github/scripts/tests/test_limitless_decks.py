"""Unit tests for the shared Limitless decks-table reader (no network).

The fixtures are trimmed copies of the real markup — the same attributes in the
same places — because everything here is a bet on that markup. The cases that
matter are the ones a synthetic table would not think to include: the residual
"Other" row that carries no deck link, the score cell that shares a class with
the count cell, and Expanded's set selector, which omits ``data-rotation``
entirely because Expanded does not rotate.
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))

import limitless_decks as decks  # noqa: E402


def _deck(name: str, icons, count, share: float, slug: str = "") -> decks.DeckRow:
    """A row as the parser would have produced it, slug defaulted off the name."""
    return decks.DeckRow(name=name, slug=slug or name.lower().replace(" ", "-"), icons=icons, count=count, share=share)


def _row(name: str, slugs, count: int, share: float, *, linked: bool = True, slug: str = "") -> str:
    icons = "".join(f'<img class="pokemon" src="https://r2.limitlesstcg.net/pokemon/gen9/{s}.png"/>' for s in slugs)
    href = slug or name.lower().replace(" ", "-")
    label = f'<a href="/decks/{href}?format=ex">{name}</a>' if linked else name
    return (
        f'<tr data-share="{share}" data-winrate="0.5">'
        f"<td>1</td><td>{icons}</td><td>{label}</td>"
        f'<td class="landscape-only">{count}</td><td>{share * 100:.2f}%</td>'
        f'<td class="landscape-only"><a href="/x">4 - 2 - 0</a></td><td>50.00%</td></tr>'
    )


TABLE = (
    "<p>8 tournaments, 108 players, 224 matches</p>"
    '<table class="meta"><tr><th>Deck</th></tr>'
    + _row("Greninja", ["greninja"], 17, 0.1574)
    + _row("Night March", ["joltik", "pumpkaboo"], 14, 0.1296)
    + _row("Other", ["substitute"], 17, 0.1574, linked=False)
    + "</table>"
)

SET_SELECTOR_ROTATING = (
    '<select id="set">'
    '<optgroup label="2026"><option data-set="PBL" data-rotation="2026" selected>Pitch Black</option>'
    '<option data-set="CRI" data-rotation="2026">Chaos Rising</option></optgroup>'
    '<optgroup label="2025"><option data-set="ASC" data-rotation="2025">Ascended Heroes</option></optgroup>'
    "</select>"
)

SET_SELECTOR_EXPANDED = (
    '<select id="set">'
    '<option data-set="PBL" selected>Pitch Black</option>'
    '<option data-set="CRI">Chaos Rising</option>'
    "</select>"
)


class ParseDeckRowsTests(unittest.TestCase):
    def test_reads_slug_name_icons_count_and_share(self):
        rows = decks.parse_deck_rows(TABLE)
        # "Other" carries no deck link, so it never parses as a row.
        self.assertEqual([row.name for row in rows], ["Greninja", "Night March"])
        self.assertEqual([row.slug for row in rows], ["greninja", "night-march"])
        self.assertEqual(rows[1].icons, ["joltik", "pumpkaboo"])
        # The score cell shares the count cell's class; the count is still 17.
        self.assertEqual(rows[0].count, 17)
        # A fraction: the percent cell next to it reads "15.74%"; taking that
        # instead would inflate every share by a hundred and defeat the share floor.
        self.assertAlmostEqual(rows[0].share, 0.1574)

    def test_icons_are_deduped_and_capped_at_two(self):
        cases = [
            (["a", "b", "c", "d"], ["a", "b"]),
            (["gardevoir", "gardevoir"], ["gardevoir"]),
        ]
        for slugs, expected in cases:
            with self.subTest(slugs=slugs):
                self.assertEqual(decks.parse_deck_rows(_row("Deck", slugs, 1, 0.01))[0].icons, expected)

    def test_rows_without_a_share_attribute_are_skipped(self):
        self.assertEqual(decks.parse_deck_rows('<tr><td><a href="/decks/x">X</a></td></tr>'), [])

    def test_missing_count_cell_yields_none_rather_than_zero(self):
        html = '<tr data-share="0.5"><td><a href="/decks/x">X</a></td></tr>'
        self.assertIsNone(decks.parse_deck_rows(html)[0].count)


class FieldSizeTests(unittest.TestCase):
    def test_reads_the_player_count_or_zero(self):
        cases = [
            (TABLE, 108),
            ("<p>0 tournaments, 0 players, 0 matches</p>", 0),
            ("<p>nothing here</p>", 0),
        ]
        for html, expected in cases:
            with self.subTest(expected=expected, html=html[:40]):
                self.assertEqual(decks.parse_field_size(html), expected)


class SetOptionTests(unittest.TestCase):
    def test_reads_sets_in_page_order_newest_first(self):
        cases = [
            ("rotating", SET_SELECTOR_ROTATING, [("2026", "PBL"), ("2026", "CRI"), ("2025", "ASC")]),
            # Expanded does not rotate, so its selector has no data-rotation.
            ("expanded", SET_SELECTOR_EXPANDED, [("", "PBL"), ("", "CRI")]),
            ("missing selector", "<p>no selector</p>", []),
        ]
        for label, html, expected in cases:
            with self.subTest(label):
                self.assertEqual(decks.parse_set_options(html), expected)


class AggregateTests(unittest.TestCase):
    def test_share_is_recomputed_from_summed_counts(self):
        small = [_deck("Lugia", ["lugia"], 1, 1.0)]
        large = [_deck("Lugia", ["lugia"], 1, 0.01), _deck("Mew", [], 98, 0.99)]
        merged = {row.name: row for row in decks.aggregate_rows([small, large])}
        # Averaging the two windows' percentages would call Lugia a 50% deck.
        self.assertAlmostEqual(merged["Lugia"].share, 2 / 100)
        self.assertEqual(merged["Lugia"].count, 2)

    def test_orders_by_share_then_name(self):
        page = [_deck("Beta", [], 5, 0.5), _deck("Alpha", [], 5, 0.5), _deck("Gamma", [], 9, 0.9)]
        self.assertEqual([row.name for row in decks.aggregate_rows([page])], ["Gamma", "Alpha", "Beta"])

    def test_takes_icons_from_the_first_window_that_has_them(self):
        pages = [[_deck("Lugia", [], 1, 0.5)], [_deck("Lugia", ["lugia"], 1, 0.5)]]
        self.assertEqual(decks.aggregate_rows(pages)[0].icons, ["lugia"])

    def test_countless_rows_are_dropped_rather_than_counted_as_zero(self):
        pages = [[_deck("Ghost", [], None, 0.5), _deck("Real", [], 4, 0.5)]]
        self.assertEqual([row.name for row in decks.aggregate_rows(pages)], ["Real"])

    def test_no_counts_at_all_yields_nothing_rather_than_dividing_by_zero(self):
        self.assertEqual(decks.aggregate_rows([[_deck("Ghost", [], None, 0.5)]]), [])

    def test_same_name_different_slug_stays_two_decks(self):
        # Buzzwole GX and Buzzwole FLI are both labelled "Buzzwole"; folding on
        # the label would report a deck twice as played as either really was.
        page = [
            _deck("Buzzwole", ["buzzwole"], 5, 0.5, slug="buzzwole-gx"),
            _deck("Buzzwole", ["buzzwole"], 4, 0.4, slug="buzzwole-fli"),
        ]
        merged = decks.aggregate_rows([page, page])
        self.assertEqual(len(merged), 2)
        self.assertEqual(sorted(row.count for row in merged), [8, 10])


class DisambiguateTests(unittest.TestCase):
    def test_only_colliding_names_take_a_suffix(self):
        cases = [
            ("unique names", [_deck("Greninja", [], 1, 0.5), _deck("Night March", [], 1, 0.5)],
             ["Greninja", "Night March"]),
            (
                "collisions take the slug's last segment",
                [
                    _deck("Zoroark", [], 9, 0.9),
                    _deck("Buzzwole", [], 5, 0.5, slug="buzzwole-gx"),
                    _deck("Buzzwole", [], 4, 0.4, slug="buzzwole-fli"),
                ],
                ["Zoroark", "Buzzwole (GX)", "Buzzwole (FLI)"],
            ),
            (
                "a suffix that does not separate falls back to the whole slug",
                [_deck("Mew", [], 5, 0.5, slug="mew-a-box"), _deck("Mew", [], 4, 0.4, slug="mew-b-box")],
                ["Mew (mew-a-box)", "Mew (mew-b-box)"],
            ),
        ]
        for label, rows, expected in cases:
            with self.subTest(label):
                self.assertEqual([row.name for row in decks.disambiguate_names(rows)], expected)

    def test_everything_else_about_the_row_survives(self):
        rows = [
            _deck("Buzzwole", ["buzzwole"], 5, 0.5, slug="buzzwole-gx"),
            _deck("Buzzwole", ["buzzwole"], 4, 0.4, slug="buzzwole-fli"),
        ]
        renamed = decks.disambiguate_names(rows)
        self.assertEqual([row.count for row in renamed], [5, 4])
        self.assertEqual(renamed[0].icons, ["buzzwole"])


if __name__ == "__main__":
    unittest.main()
