"""Decide whether two card printings show the same artwork.

A reprint cluster (every printing of "Rare Candy", say) mixes genuinely
different illustrations with near-identical ones that differ only in the set
symbol and collector number. A tier list built over the raw cluster asks you to
rank the same picture six times; this module collapses those into one entry.

The comparison runs on the *art band* — the upper strip of the card — because
matching whole cards matches the shared frame instead: two unrelated Items from
the same era score higher on full-card feature matching than two printings of
the same illustration from different eras do.

Two prints are the same art when both hold:

``structure``
    A similarity transform (scale + translation) aligns one card's art onto the
    other, and the aligned pixels correlate. Structure alone is deliberately
    not enough — a gold-etched secret rare is the same drawing.
``colour``
    The aligned pixels agree in Lab chroma. This is what keeps the gold, black
    and recoloured-background variants as separate entries, matching how a
    collector reads them: same drawing, different art.

Alignment is proposed twice and verified once. ORB + RANSAC handles prints that
were re-cropped or re-framed (promo reprints of a full art); a multi-scale
template sweep handles smooth, blurry, low-texture art where ORB finds almost
no corners (pre-2011 scans). Whichever proposal verifies better wins.
"""

from __future__ import annotations

import itertools
from typing import Callable, Optional, Sequence

import cv2
import numpy as np

# Every card is normalised to this size first: sources range from the 460x640
# LimitlessTCG CDN renders to 734x1024 pokemontcg.io scans.
CARD_W, CARD_H = 460, 640

# The band A contributes its template from, and the (larger) band of B that is
# searched. B's band is deliberately taller so a print whose illustration sits
# lower — a re-cropped promo — is still reachable.
TPL_BAND = (0.10, 0.50, 0.08, 0.92)
SRC_BAND = (0.02, 0.60, 0.02, 0.98)
BAND_W = 288

SCALES = np.linspace(0.65, 1.55, 25)
TPL_FRAC = 0.45
VERIFY_FRAC = 0.86

# A transform outside this scale range is not "the same art at a different
# framing", it is a zoomed detail — a distinct presentation worth its own entry.
MIN_TRANSFORM_SCALE, MAX_TRANSFORM_SCALE = 0.6, 1.7
# Below this share of the verification window overlapping, the correlation is
# measured on too few pixels to trust.
MIN_COVERAGE = 0.55

#: Aligned-pixel correlation at or above which two prints show the same drawing.
NCC_THRESHOLD = 0.90
#: Median Lab chroma distance at or below which they also share a colourway.
CHROMA_THRESHOLD = 20.0

_ORB_FEATURES = 2000
_LOWE_RATIO = 0.78
_RANSAC_PX = 3.0
_MIN_ORB_MATCHES = 10
_MIN_ORB_INLIERS = 8


def parameter_signature() -> str:
    """Stable digest of every tunable, so cached results invalidate on a retune."""
    parts = (
        CARD_W, CARD_H, TPL_BAND, SRC_BAND, BAND_W, TPL_FRAC, VERIFY_FRAC,
        len(SCALES), float(SCALES[0]), float(SCALES[-1]),
        MIN_TRANSFORM_SCALE, MAX_TRANSFORM_SCALE, MIN_COVERAGE,
        NCC_THRESHOLD, CHROMA_THRESHOLD, _LOWE_RATIO,
    )
    return "|".join(str(p) for p in parts)


def _band(card: np.ndarray, box: Sequence[float]) -> np.ndarray:
    y0, y1, x0, x1 = box
    crop = card[int(y0 * CARD_H):int(y1 * CARD_H), int(x0 * CARD_W):int(x1 * CARD_W)]
    height = int(round(BAND_W * crop.shape[0] / crop.shape[1]))
    return cv2.resize(crop, (BAND_W, height), interpolation=cv2.INTER_AREA)


def _grey(band: np.ndarray) -> np.ndarray:
    return cv2.GaussianBlur(cv2.cvtColor(band, cv2.COLOR_BGR2GRAY), (3, 3), 0)


class ArtBands:
    """One card's art band, pre-processed for every comparison it takes part in.

    The scale pyramid and ORB descriptors are built lazily but exactly once,
    because within a reprint cluster each card is compared against every other.
    """

    __slots__ = ("tpl", "src", "tpl_grey", "src_grey", "tpl_lab", "src_lab",
                 "_pyramid", "_keypoints", "_descriptors", "_orb_done")

    def __init__(self, card_bgr: np.ndarray) -> None:
        card = cv2.resize(card_bgr, (CARD_W, CARD_H), interpolation=cv2.INTER_AREA)
        self.tpl = _band(card, TPL_BAND)
        self.src = _band(card, SRC_BAND)
        self.tpl_grey = _grey(self.tpl)
        self.src_grey = _grey(self.src)
        self.tpl_lab = cv2.cvtColor(self.tpl, cv2.COLOR_BGR2LAB).astype(np.float32)
        self.src_lab = cv2.cvtColor(self.src, cv2.COLOR_BGR2LAB).astype(np.float32)
        self._pyramid: Optional[list[tuple[float, np.ndarray]]] = None
        self._keypoints: Sequence = ()
        self._descriptors = None
        self._orb_done = False

    @property
    def pyramid(self) -> list[tuple[float, np.ndarray]]:
        """Scaled copies of the search band, reused across every pair."""
        if self._pyramid is None:
            self._pyramid = [
                (float(s), cv2.resize(self.src_grey, (0, 0), fx=s, fy=s,
                                      interpolation=cv2.INTER_AREA))
                for s in SCALES
            ]
        return self._pyramid

    def _detect(self) -> None:
        if not self._orb_done:
            orb = cv2.ORB_create(nfeatures=_ORB_FEATURES)
            self._keypoints, self._descriptors = orb.detectAndCompute(self.src_grey, None)
            self._orb_done = True

    @property
    def keypoints(self) -> Sequence:
        self._detect()
        return self._keypoints

    @property
    def descriptors(self):
        self._detect()
        return self._descriptors


def load_bands(path: str) -> ArtBands:
    """Read a card image from disk into its comparison bands."""
    card = cv2.imread(path, cv2.IMREAD_COLOR)
    if card is None:
        raise ValueError(f"unreadable card image: {path}")
    return ArtBands(card)


def _patch_box(shape: Sequence[int], frac: float = TPL_FRAC) -> tuple[int, int, int, int]:
    height, width = shape[0], shape[1]
    ph, pw = int(height * frac), int(width * frac)
    return (width - pw) // 2, (height - ph) // 2, pw, ph


def propose_by_template(a: ArtBands, b: ArtBands) -> Optional[np.ndarray]:
    """Sweep A's centre patch over scaled copies of B's search band.

    Slow but indifferent to texture, which is what pre-2011 scans need.
    """
    x, y, pw, ph = _patch_box(a.tpl_grey.shape)
    patch = a.tpl_grey[y:y + ph, x:x + pw]
    best: Optional[tuple[float, float, tuple[int, int]]] = None
    for scale, scaled in b.pyramid:
        if scaled.shape[0] <= ph or scaled.shape[1] <= pw:
            continue
        _, peak, _, at = cv2.minMaxLoc(cv2.matchTemplate(scaled, patch, cv2.TM_CCOEFF_NORMED))
        if best is None or peak > best[0]:
            best = (float(peak), scale, at)
    if best is None:
        return None
    _, scale, at = best
    return np.array([[1 / scale, 0.0, (at[0] - x) / scale],
                     [0.0, 1 / scale, (at[1] - y) / scale]], np.float32)


def _tpl_to_src_offset() -> tuple[np.ndarray, float]:
    """Map a point in the template band's frame to the search band's frame."""
    src_scale = BAND_W / ((SRC_BAND[3] - SRC_BAND[2]) * CARD_W)
    tpl_scale = BAND_W / ((TPL_BAND[3] - TPL_BAND[2]) * CARD_W)
    offset = np.array([(TPL_BAND[2] - SRC_BAND[2]) * CARD_W * src_scale,
                       (TPL_BAND[0] - SRC_BAND[0]) * CARD_H * src_scale], np.float32)
    return offset, tpl_scale / src_scale


def propose_by_features(a: ArtBands, b: ArtBands) -> Optional[np.ndarray]:
    """Fit a similarity transform to RANSAC-filtered ORB correspondences.

    Fast, and unbothered by large re-crops — but it needs corners, so it goes
    quiet on smooth illustrations.
    """
    da, db = a.descriptors, b.descriptors
    if da is None or db is None or len(da) < _MIN_ORB_MATCHES or len(db) < _MIN_ORB_MATCHES:
        return None
    matcher = cv2.BFMatcher(cv2.NORM_HAMMING)
    pairs = matcher.knnMatch(da, db, k=2)
    good = [p[0] for p in pairs if len(p) == 2 and p[0].distance < _LOWE_RATIO * p[1].distance]
    if len(good) < _MIN_ORB_MATCHES:
        return None
    offset, rescale = _tpl_to_src_offset()
    src = np.float32([(np.float32(a.keypoints[g.queryIdx].pt) - offset) * rescale
                      for g in good]).reshape(-1, 1, 2)
    dst = np.float32([b.keypoints[g.trainIdx].pt for g in good]).reshape(-1, 1, 2)
    transform, inliers = cv2.estimateAffinePartial2D(
        src, dst, method=cv2.RANSAC, ransacReprojThreshold=_RANSAC_PX
    )
    if transform is None or inliers is None or int(inliers.sum()) < _MIN_ORB_INLIERS:
        return None
    return transform.astype(np.float32)


def verify(a: ArtBands, b: ArtBands, transform: Optional[np.ndarray]) -> tuple[float, float]:
    """Score a proposed alignment. Returns ``(correlation, chroma distance)``.

    A rejected alignment scores ``(0.0, inf)`` so it always loses to a real one.
    """
    if transform is None:
        return 0.0, float("inf")
    scale = float(np.hypot(transform[0, 0], transform[0, 1]))
    if not MIN_TRANSFORM_SCALE <= scale <= MAX_TRANSFORM_SCALE:
        return 0.0, float("inf")

    height, width = a.tpl_grey.shape
    inverse = cv2.invertAffineTransform(transform)
    warped_grey = cv2.warpAffine(b.src_grey, inverse, (width, height), flags=cv2.INTER_LINEAR)
    warped_lab = cv2.warpAffine(b.src_lab, inverse, (width, height), flags=cv2.INTER_LINEAR)
    covered = cv2.warpAffine(np.ones(b.src_grey.shape, np.uint8), inverse, (width, height),
                             flags=cv2.INTER_NEAREST)

    x, y, pw, ph = _patch_box(a.tpl_grey.shape, VERIFY_FRAC)
    window = (slice(y, y + ph), slice(x, x + pw))
    mask = covered[window].astype(bool)
    if mask.mean() < MIN_COVERAGE:
        return 0.0, float("inf")

    left = a.tpl_grey[window][mask].astype(np.float32)
    right = warped_grey[window][mask].astype(np.float32)
    left -= left.mean()
    right -= right.mean()
    denominator = float(np.sqrt((left * left).sum() * (right * right).sum()))
    correlation = float((left * right).sum() / denominator) if denominator > 0 else 0.0

    chroma = np.sqrt(((a.tpl_lab[window][mask][:, 1:] - warped_lab[window][mask][:, 1:]) ** 2).sum(axis=1))
    return correlation, float(np.median(chroma))


def _directional(a: ArtBands, b: ArtBands) -> tuple[float, float]:
    """Best verified alignment of A onto B.

    Features run first because they are an order of magnitude cheaper than the
    scale sweep; the sweep only runs when they fail to settle the question.
    """
    best = verify(a, b, propose_by_features(a, b))
    if is_same_art(*best):
        return best
    return max(best, verify(a, b, propose_by_template(a, b)), key=lambda r: r[0])


def compare(a: ArtBands, b: ArtBands) -> tuple[float, float]:
    """Symmetric art similarity: ``(correlation, chroma distance)``.

    Both directions are scored and the pessimistic result is kept, so a print
    whose art is a *detail* of another's does not pass on the strength of the
    one direction where the detail happens to fit.
    """
    forward = _directional(a, b)
    backward = _directional(b, a)
    return min(forward[0], backward[0]), max(forward[1], backward[1])


def is_same_art(correlation: float, chroma: float) -> bool:
    """Same drawing *and* same colourway."""
    return correlation >= NCC_THRESHOLD and chroma <= CHROMA_THRESHOLD


def group_by_art(keys: Sequence[str], bands: Callable[[str], ArtBands]) -> list[list[str]]:
    """Partition printings into groups that show the same art.

    Grouping is transitive (union-find): if A matches B and B matches C, all
    three are one art even when A and C sit either side of the threshold.
    Input order is preserved — both within each group and between groups — so
    the caller's release ordering survives and the first member of a group is
    its earliest printing.
    """
    parent = {key: key for key in keys}

    def root(key: str) -> str:
        while parent[key] != key:
            parent[key] = parent[parent[key]]
            key = parent[key]
        return key

    for left, right in itertools.combinations(keys, 2):
        if root(left) == root(right):
            continue
        if is_same_art(*compare(bands(left), bands(right))):
            parent[root(left)] = root(right)

    groups: dict[str, list[str]] = {}
    for key in keys:
        groups.setdefault(root(key), []).append(key)
    return list(groups.values())


def score_all_pairs(keys: Sequence[str],
                    bands: Callable[[str], ArtBands]) -> list[tuple[float, float, str, str]]:
    """Every pairwise score, strongest match first. For tuning and review."""
    scored = [(*compare(bands(a), bands(b)), a, b) for a, b in itertools.combinations(keys, 2)]
    return sorted(scored, reverse=True)
