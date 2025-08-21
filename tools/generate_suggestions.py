#!/usr/bin/env python3
"""
Generate `reports/suggestions.json` with categories including 'chopped-and-washed'.

Chopped and Washed heuristic (new):
- Accepts 0% usage as valid.
- Scores cards by absolute drop from a recent peak to the latest tournament, with recency weighting.
- Penalizes steady low-usage cards and rewards sharp crashes (Morty's Conviction-style).
- Enforces a 2-per-archetype cap.

This script is designed to run from the repo root.
"""
from pathlib import Path
import json
from datetime import datetime, timezone
from collections import defaultdict, Counter
import math

# Basic energies to exclude from suggestions
BASIC_ENERGY = {
    'Psychic Energy', 'Fire Energy', 'Lightning Energy', 'Grass Energy',
    'Darkness Energy', 'Metal Energy', 'Fighting Energy', 'Water Energy'
}

ROOT = Path(__file__).resolve().parents[1]
REPORTS = ROOT / 'reports'
TOURNAMENTS_FILE = REPORTS / 'tournaments.json'
OUT_FILE = REPORTS / 'suggestions.json'

# Configurable parameters
RECENT_WEIGHT_HALF_LIFE_DAYS = 30.0  # recency weight exponential half-life
PEAK_LOOKBACK = 999  # lookback number of tournaments to consider for peaks (use large number -> effectively all earlier events)
MIN_PEAK_PCT = 3.0  # a peak must be at least this percent to be considered 'used'
MIN_DROP_ABS = 3.0  # absolute pct drop from peak to latest to be considered
MIN_DROP_REL = 0.4  # relative drop as fraction of peak (e.g., 0.4 = 40% drop)
MAX_PER_ARCHETYPE = 2  # non-leader categories
MIN_CANDIDATES = 12
MAX_CANDIDATES = 18


def load_tournament_order():
    if not TOURNAMENTS_FILE.exists():
        return []
    return json.loads(TOURNAMENTS_FILE.read_text(encoding='utf-8'))


def load_master_for(tournament_name):
    p = REPORTS / tournament_name / 'master.json'
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding='utf-8'))
    except Exception:
        return None


def extract_pct_map(master):
    """Build a mapping of key->pct and key->display name from master.json.
    If 'uid' is present on an item, use it as the identity key (per-variant);
    otherwise fall back to the display name.
    Returns (pct_map, name_map).
    """
    pct_map = {}
    name_map = {}
    for it in master.get('items', []):
        disp = it.get('name')
        key = it.get('uid') or disp
        if not key:
            continue
        pct = float(it.get('pct', 0.0) or 0.0)
        pct_map[key] = pct
        # preserve first-seen display
        name_map.setdefault(key, disp)
    return pct_map, name_map



def tournament_metadata(tournaments):
    """Return list of tuples (tournament, date, pct_map, formatName, name_map)."""
    res = []
    for idx, t in enumerate(tournaments):
        meta = REPORTS / t / 'meta.json'
        dt = None
        fmt_name = None
        name_map = {}
        if meta.exists():
            try:
                mj = json.loads(meta.read_text(encoding='utf-8'))
                # Prefer startDate (event start), fallback to fetchedAt/date
                start = mj.get('startDate') or mj.get('fetchedAt') or mj.get('date')
                if start:
                    try:
                        dt = datetime.fromisoformat(str(start).replace('Z', '+00:00'))
                    except Exception:
                        dt = None
                fmt_name = mj.get('formatName') or mj.get('format')
            except Exception:
                dt = None

        master = load_master_for(t)
        if master:
            pct_map, name_map = extract_pct_map(master)
        else:
            pct_map, name_map = {}, {}
        # if date missing, dt stays None; caller preserves list order
        res.append((t, dt, pct_map, fmt_name, name_map))

    # Preserve tournaments.json order (expected newest-first)
    return res


def recency_weight(days_diff):
    # Exponential decay: weight = 0.5^(days / half_life)
    return 0.5 ** (days_diff / RECENT_WEIGHT_HALF_LIFE_DAYS)


def compute_chopped_and_washed(tournaments, max_limit=MAX_CANDIDATES, exclude_names=set(), cap_per_arch=MAX_PER_ARCHETYPE):
    # Build maps from tournaments.json order (newest-first)
    meta_list = tournament_metadata(tournaments)
    if not meta_list:
        return []

    # meta_list is in the same order as tournaments.json (newest-first)
    seq = [m for (_, _, m, _, __) in meta_list]
    dates = [d for (_, d, _, _, __) in meta_list]
    name_maps = [nm for (_, _, __, _, nm) in meta_list]
    N = len(seq)

    # collect card names across all events
    keys = set()
    for s in seq:
        keys.update(s.keys())

    scores = []
    now = datetime.now(timezone.utc)

    for key in keys:
        # map key->display name via the most recent available mapping
        disp = None
        for nm in name_maps:
            if key in nm:
                disp = nm[key]
                break
        name = disp or key  # display name fallback
        if key in exclude_names or name in BASIC_ENERGY:
            continue
        # latest event is index 0 (newest-first)
        latest_pct = seq[0].get(key, 0.0)
        # New rule: must not exceed 3% usage in either of the two most recent events
        second_latest_pct = seq[1].get(key, 0.0) if N > 1 else 0.0
        if (latest_pct > 3.0) or (N > 1 and second_latest_pct > 3.0):
            continue

        best_score = 0.0
        best_peak = None

        # examine older tournaments (indices 1..PEAK_LOOKBACK) for peaks
        for idx in range(1, min(N, 1 + PEAK_LOOKBACK)):
            peak_pct = seq[idx].get(key, 0.0)
            if peak_pct < MIN_PEAK_PCT:
                continue

            abs_drop = peak_pct - latest_pct
            if abs_drop <= 0:
                # card wasn't higher before; skip
                continue

            rel_drop = abs_drop / peak_pct if peak_pct > 0 else 0.0
            if abs_drop < MIN_DROP_ABS and rel_drop < MIN_DROP_REL:
                continue

            peak_date = dates[idx] if idx < len(dates) else None
            # Ensure both datetimes are comparable (make peak_date aware in UTC if naive)
            if peak_date and peak_date.tzinfo is None:
                try:
                    peak_date = peak_date.replace(tzinfo=timezone.utc)
                except Exception:
                    peak_date = None
            days_since_peak = (now - peak_date).days if peak_date else (idx * 7)
            peak_recency = recency_weight(days_since_peak)

            s = abs_drop * (1.0 + rel_drop) * (1.0 + peak_pct / 10.0)
            s *= (1.0 + peak_recency)
            if latest_pct <= 0.0:
                s *= 2.0

            if s > best_score:
                best_score = s
                best_peak = peak_pct

        if best_score <= 0.0:
            continue

        arch = find_archetype_for_name_in_reports(name, tournaments)
        scores.append({'key': key, 'name': name, 'score': best_score, 'peak': best_peak, 'latest': latest_pct, 'archetype': arch})

    # sort by descending score
    scores.sort(key=lambda x: -x['score'])

    # enforce per-archetype cap and limit to max_limit
    counts = defaultdict(int)
    out = []
    for it in scores:
        arch = it.get('archetype') or 'UNSPECIFIED'
        if counts[arch] < cap_per_arch:
            # Attempt to parse set/number from uid pattern 'Name::SET::NNN'
            set_code = None
            number = None
            parts = (it['key'] or '').split('::') if it.get('key') else []
            if len(parts) >= 3 and parts[1] and parts[2]:
                set_code, number = parts[1], parts[2]
            out.append({'name': it['name'], 'uid': it['key'], 'set': set_code, 'number': number, 'score': round(it['score'], 3), 'peak': it['peak'], 'latest': it['latest'], 'archetype': arch})
            counts[arch] += 1
        if len(out) >= max_limit:
            break

    return out


def compute_consistent_leaders(tournaments, max_limit=MAX_CANDIDATES):
    # choose top cards by average pct across tournaments (newest-first seq)
    meta_list = tournament_metadata(tournaments)
    if not meta_list:
        return []
    seq = [m for (_, _, m, _, __) in meta_list]
    name_maps = [nm for (_, _, __, _, nm) in meta_list]
    N = len(seq)
    keys = set()
    for s in seq:
        keys.update(s.keys())

    stats = []
    for key in keys:
        # resolve display
        disp = None
        for nm in name_maps:
            if key in nm:
                disp = nm[key]
                break
        name = disp or key
        if name in BASIC_ENERGY:
            continue
        vals = [seq[i].get(key, 0.0) for i in range(N)]
        avg = sum(vals) / max(1, N)
        present_count = sum(1 for v in vals if v > 0.0)
        stats.append({'name': name, 'uid': key, 'avg': avg, 'present': present_count})

    stats.sort(key=lambda x: (-x['avg'], -x['present'], x['name']))
    out = []
    for s in stats[:max_limit]:
        set_code = number = None
        parts = (s['uid'] or '').split('::') if s.get('uid') else []
        if len(parts) >= 3 and parts[1] and parts[2]:
            set_code, number = parts[1], parts[2]
        out.append({'name': s['name'], 'uid': s['uid'], 'set': set_code, 'number': number})
    return out


def compute_on_the_rise(tournaments, exclude_names=set(), max_limit=MAX_CANDIDATES, cap_per_arch=MAX_PER_ARCHETYPE):
    meta_list = tournament_metadata(tournaments)
    if not meta_list:
        return []
    seq = [m for (_, _, m, _, __) in meta_list]
    name_maps = [nm for (_, _, __, _, nm) in meta_list]
    N = len(seq)
    keys = set()
    for s in seq:
        keys.update(s.keys())

    cand = []
    for key in keys:
        # resolve display
        disp = None
        for nm in name_maps:
            if key in nm:
                disp = nm[key]
                break
        name = disp or key
        if key in exclude_names or name in BASIC_ENERGY:
            continue
        # latest is index 0
        latest = seq[0].get(key, 0.0)
        older = [seq[i].get(key, 0.0) for i in range(1, N)] if N>1 else []
        older_mean = (sum(older)/len(older)) if older else 0.0
        # Guard: ignore cards with exclusively 0% in all prior events (likely newly legal)
        if older and all((v or 0.0) <= 0.0 for v in older):
            continue
        delta = latest - older_mean
        # require a meaningful breakout
        if latest >= 3.0 and (delta >= 3.0 or latest >= older_mean * 1.6):
            arch = find_archetype_for_name_in_reports(name, tournaments) or 'UNSPECIFIED'
            set_code = number = None
            parts = (key or '').split('::') if key else []
            if len(parts) >= 3 and parts[1] and parts[2]:
                set_code, number = parts[1], parts[2]
            cand.append({'name': name, 'uid': key, 'set': set_code, 'number': number, 'score': delta, 'latest': latest, 'older_mean': older_mean, 'archetype': arch})

    cand.sort(key=lambda x: (-x['score'], -x['latest'], x['name']))
    # Enforce per-archetype cap (2) for on-the-rise
    out = []
    counts = defaultdict(int)
    for c in cand:
        arch = c.get('archetype') or 'UNSPECIFIED'
        if counts[arch] >= cap_per_arch:
            continue
        out.append({'name': c['name'], 'uid': c['uid'], 'set': c.get('set'), 'number': c.get('number'), 'archetype': arch})
        counts[arch] += 1
        if len(out) >= max_limit:
            break
    return out


def compute_that_day2d(tournaments, exclude_names=set(), max_limit=MAX_CANDIDATES, cap_per_arch=MAX_PER_ARCHETYPE):
    # find cards with a prior peak (not latest) and low latest, enforce one per archetype
    meta_list = tournament_metadata(tournaments)
    if not meta_list:
        return []
    seq = [m for (_, _, m, _, __) in meta_list]
    name_maps = [nm for (_, _, __, _, nm) in meta_list]
    N = len(seq)
    keys = set()
    for s in seq:
        keys.update(s.keys())

    candidates = []
    for key in keys:
        # resolve display
        disp = None
        for nm in name_maps:
            if key in nm:
                disp = nm[key]
                break
        name = disp or key
        if key in exclude_names or name in BASIC_ENERGY:
            continue
        # Rule: must not have >3% usage in any of the last 10 tournaments
        window = min(N, 10)
        if any((seq[i].get(key, 0.0) or 0.0) > 3.0 for i in range(window)):
            continue
        latest = seq[0].get(key, 0.0)
        # find max and its index among older events
        max_pct = 0.0
        max_idx = None
        for idx in range(1, N):
            p = seq[idx].get(key, 0.0)
            if p > max_pct:
                max_pct = p
                max_idx = idx
        if max_idx is None:
            continue
        # require peak to be significant and latest to be low
        if max_pct >= 6.0 and latest <= 2.0:
            drop = max_pct - latest
            set_code = number = None
            parts = (key or '').split('::') if key else []
            if len(parts) >= 3 and parts[1] and parts[2]:
                set_code, number = parts[1], parts[2]
            candidates.append({'name': name, 'uid': key, 'set': set_code, 'number': number, 'score': drop, 'peak': max_pct, 'latest': latest})

    candidates.sort(key=lambda x: (-x['score'], -x['peak'], x['name']))

    out = []
    counts = defaultdict(int)
    for c in candidates:
        arch = find_archetype_for_name_in_reports(c['name'], tournaments) or 'UNSPECIFIED'
        # enforce per-archetype cap for that-day2d
        if counts[arch] >= cap_per_arch:
            continue
        out.append({'name': c['name'], 'uid': c.get('uid'), 'set': c.get('set'), 'number': c.get('number'), 'archetype': arch})
        counts[arch] += 1
        if len(out) >= max_limit:
            break

    return out


def find_archetype_for_name_in_reports(name, tournaments):
    # Heuristic: scan each tournament decks.json for the first deck that contains the card
    # and return its archetype. If not found, return None.
    for t in tournaments:
        decks = REPORTS / t / 'decks.json'
        if not decks.exists():
            continue
        try:
            arr = json.loads(decks.read_text(encoding='utf-8'))
        except Exception:
            continue
        for d in arr:
            cards = d.get('cards') or []
            for c in cards:
                if c.get('name') == name:
                    return d.get('archetype') or None
    return None


def _normalize_rotation_prefix(fmt_name: str):
    """Normalize a formatName to a rotation family prefix, e.g., 'Scarlet & Violet'."""
    if not fmt_name:
        return None
    s = str(fmt_name)
    # Normalize separators and ampersand/and
    s = s.replace('—', '-').replace('–', '-').replace(' and ', ' & ')
    head = s.split('-', 1)[0].strip()
    return head or None

def filter_tournaments_by_rotation(tournaments):
    """If there are >=3 events in the current rotation family (prefix of formatName),
    filter out events from prior rotations.
    Input tournaments expected newest-first.
    """
    meta = tournament_metadata(tournaments)
    # Determine current rotation prefix from the first tournament with a format name
    current_prefix = None
    for _, _, _, fmt, __ in meta:
        current_prefix = _normalize_rotation_prefix(fmt)
        if current_prefix:
            break
    if not current_prefix:
        return tournaments
    # Count how many events in current rotation
    count_current = sum(1 for _, _, _, fmt, __ in meta if _normalize_rotation_prefix(fmt) == current_prefix)
    if count_current < 3:
        return tournaments
    # Keep only those in current rotation
    kept = [t for (t, _, _, fmt, __) in meta if _normalize_rotation_prefix(fmt) == current_prefix]
    return kept


def generate_all():
    tournaments = load_tournament_order()
    # Apply rotation-aware filtering when we have enough events in current rotation
    tournaments = filter_tournaments_by_rotation(tournaments)
    # Compute each category so we always produce meaningful output
    # Respect tournaments.json ordering (newest-first)
    leaders = compute_consistent_leaders(tournaments, max_limit=MAX_CANDIDATES)
    leader_keys = set([(c.get('uid') or c['name']) for c in leaders])

    on_the_rise = compute_on_the_rise(tournaments, exclude_names=leader_keys, max_limit=MAX_CANDIDATES, cap_per_arch=MAX_PER_ARCHETYPE)
    if len(on_the_rise) < MIN_CANDIDATES:
        # Relax per-arch cap gradually to try to reach the minimum
        for cap in (3, 4):
            on_the_rise = compute_on_the_rise(tournaments, exclude_names=leader_keys, max_limit=MAX_CANDIDATES, cap_per_arch=cap)
            if len(on_the_rise) >= MIN_CANDIDATES:
                break
    rise_keys = set([(c.get('uid') or c['name']) for c in on_the_rise])

    # chopped should avoid leaders and on the rise; compute with exclusions and relax cap if needed
    chopped = compute_chopped_and_washed(tournaments, max_limit=MAX_CANDIDATES, exclude_names=leader_keys.union(rise_keys), cap_per_arch=MAX_PER_ARCHETYPE)
    if len(chopped) < MIN_CANDIDATES:
        for cap in (3, 4):
            chopped = compute_chopped_and_washed(tournaments, max_limit=MAX_CANDIDATES, exclude_names=leader_keys.union(rise_keys), cap_per_arch=cap)
            if len(chopped) >= MIN_CANDIDATES:
                break
    chopped_keys = set([(c.get('uid') or c['name']) for c in chopped])
    # ensure 2-per-archetype and cap to 12 already enforced by compute_chopped_and_washed

    # That Day 2'd? should exclude leaders and on_the_rise
    that_day2d = compute_that_day2d(tournaments, exclude_names=leader_keys.union(rise_keys).union(chopped_keys), max_limit=MAX_CANDIDATES, cap_per_arch=MAX_PER_ARCHETYPE)
    if len(that_day2d) < MIN_CANDIDATES:
        for cap in (3, 4):
            that_day2d = compute_that_day2d(tournaments, exclude_names=leader_keys.union(rise_keys).union(chopped_keys), max_limit=MAX_CANDIDATES, cap_per_arch=cap)
            if len(that_day2d) >= MIN_CANDIDATES:
                break

    categories = [
    {'id': 'consistent-leaders', 'title': 'Consistent Leaders', 'items': leaders[:MAX_CANDIDATES]},
    {'id': 'on-the-rise', 'title': 'On The Rise', 'items': on_the_rise[:MAX_CANDIDATES]},
    {'id': 'chopped-and-washed', 'title': 'Chopped and Washed', 'items': chopped[:MAX_CANDIDATES]},
    {'id': 'that-day2d', 'title': "That Day 2'd?", 'items': that_day2d[:MAX_CANDIDATES]},
    ]

    output = {
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'source': 'generate_suggestions.py',
        'categories': categories
    }

    OUT_FILE.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f"Wrote {OUT_FILE}")


if __name__ == '__main__':
    generate_all()

