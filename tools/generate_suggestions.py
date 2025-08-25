#!/usr/bin/env python3
"""
Generate `reports/suggestions.json` with categories including 'chopped-and-washed'.

Optimized version with improved performance and better data structures.

Chopped and Washed heuristic:
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
from typing import Dict, List, Tuple, Optional, Set
from dataclasses import dataclass

# Basic energies to exclude from suggestions
BASIC_ENERGY = frozenset({
    'Psychic Energy', 'Fire Energy', 'Lightning Energy', 'Grass Energy',
    'Darkness Energy', 'Metal Energy', 'Fighting Energy', 'Water Energy'
})

ROOT = Path(__file__).resolve().parents[1]
REPORTS = ROOT / 'reports'
TOURNAMENTS_FILE = REPORTS / 'tournaments.json'
OUT_FILE = REPORTS / 'suggestions.json'

# Enhanced quality parameters
RECENT_WEIGHT_HALF_LIFE_DAYS = 30.0  # recency weight exponential half-life
PEAK_LOOKBACK = 999  # lookback number of tournaments to consider for peaks

# Consistent Leaders - for truly reliable staples
MIN_LEADER_APPEARANCE_PCT = 0.6  # must appear in 60%+ of tournaments
MIN_LEADER_AVG_PCT = 4.0  # minimum average usage to be considered a leader
LEADER_RECENCY_WEIGHT = 0.1  # slight boost for recent performance

# On The Rise - for genuine emerging trends
MIN_RISE_CURRENT_PCT = 5.0  # must have meaningful current usage
MIN_RISE_DELTA_ABS = 4.0  # significant absolute increase required
MIN_RISE_DELTA_REL = 1.5  # 150% relative increase (2% to 5% = 150% growth)
MIN_RISE_TOURNAMENTS = 3  # need data from multiple tournaments for trend

# Chopped and Washed - for genuine former staples that crashed
MIN_CHOPPED_PEAK_PCT = 6.0  # must have been genuinely popular
MIN_CHOPPED_DROP_ABS = 5.0  # significant absolute drop required
MIN_CHOPPED_DROP_REL = 0.6  # 60% relative drop minimum
MIN_SUSTAINED_PEAK_TOURNAMENTS = 2  # peak must be sustained across multiple tournaments
MAX_CHOPPED_RECENT_PCT = 2.0  # must be low in recent tournaments

# That Day 2'd - for experimental one-offs that disappeared
MAX_DAY2D_TOTAL_APPEARANCES = 2  # appeared in very few tournaments total (1-2 max)
MAX_DAY2D_PEAK_USAGE = 1.5  # never had high sustained play (excludes legitimate archetypes)  
MAX_DAY2D_TOTAL_USAGE_SUM = 3.0  # total usage across all appearances should be very low
MIN_DAY2D_MIN_APPEARANCE = 0.3  # must have appeared meaningfully (not just noise)
MAX_DAY2D_RECENT_PCT = 0.1  # must be completely gone now
DAY2D_LOOKBACK_TOURNAMENTS = 20  # look back further for true one-offs
MAX_DAY2D_MEANINGFUL_TOURNAMENTS = 2  # appeared meaningfully in at most 2 tournaments

# General parameters
MAX_PER_ARCHETYPE = 2  # non-leader categories
MIN_CANDIDATES = 12
MAX_CANDIDATES = 18

@dataclass
class TournamentData:
    """Structured tournament data for efficient processing."""
    name: str
    date: Optional[datetime]
    pct_map: Dict[str, float]
    format_name: Optional[str]
    name_map: Dict[str, str]

@dataclass
class CardData:
    """Card information with parsed components."""
    key: str
    name: str
    set_code: Optional[str] = None
    number: Optional[str] = None
    archetype: Optional[str] = None


class TournamentDataLoader:
    """Optimized tournament data loader with caching and batch operations."""
    
    def __init__(self):
        self._archetype_cache: Dict[str, Optional[str]] = {}
        self._tournament_data_cache: Optional[List[TournamentData]] = None
    
    def load_tournament_order(self) -> List[str]:
        """Load tournament order from tournaments.json."""
        if not TOURNAMENTS_FILE.exists():
            return []
        try:
            return json.loads(TOURNAMENTS_FILE.read_text(encoding='utf-8'))
        except Exception:
            return []
    
    def _load_master_for(self, tournament_name: str) -> Optional[dict]:
        """Load master.json for a tournament."""
        path = REPORTS / tournament_name / 'master.json'
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text(encoding='utf-8'))
        except Exception:
            return None
    
    def _extract_pct_map(self, master: dict) -> Tuple[Dict[str, float], Dict[str, str]]:
        """Extract percentage and name mappings from master.json."""
        pct_map = {}
        name_map = {}
        for item in master.get('items', []):
            display_name = item.get('name')
            key = item.get('uid') or display_name
            if not key:
                continue
            
            pct = float(item.get('pct', 0.0) or 0.0)
            pct_map[key] = pct
            name_map.setdefault(key, display_name)
        
        return pct_map, name_map
    
    def _load_tournament_metadata(self, tournament: str) -> TournamentData:
        """Load metadata for a single tournament."""
        meta_path = REPORTS / tournament / 'meta.json'
        date = None
        format_name = None
        
        if meta_path.exists():
            try:
                meta = json.loads(meta_path.read_text(encoding='utf-8'))
                start_date_str = meta.get('startDate') or meta.get('fetchedAt') or meta.get('date')
                if start_date_str:
                    try:
                        date = datetime.fromisoformat(str(start_date_str).replace('Z', '+00:00'))
                    except Exception:
                        pass
                format_name = meta.get('formatName') or meta.get('format')
            except Exception:
                pass
        
        master = self._load_master_for(tournament)
        if master:
            pct_map, name_map = self._extract_pct_map(master)
        else:
            pct_map, name_map = {}, {}
        
        return TournamentData(tournament, date, pct_map, format_name, name_map)
    
    def load_all_tournament_data(self, tournaments: List[str]) -> List[TournamentData]:
        """Load all tournament data efficiently with caching."""
        if self._tournament_data_cache is None:
            self._tournament_data_cache = [
                self._load_tournament_metadata(t) for t in tournaments
            ]
        return self._tournament_data_cache
    
    def find_archetype_for_card(self, card_name: str, tournaments: List[str]) -> Optional[str]:
        """Find archetype for a card with caching."""
        if card_name in self._archetype_cache:
            return self._archetype_cache[card_name]
        
        # Search through tournaments for the card
        for tournament in tournaments:
            decks_path = REPORTS / tournament / 'decks.json'
            if not decks_path.exists():
                continue
            
            try:
                decks = json.loads(decks_path.read_text(encoding='utf-8'))
                for deck in decks:
                    for card in deck.get('cards', []):
                        if card.get('name') == card_name:
                            archetype = deck.get('archetype')
                            self._archetype_cache[card_name] = archetype
                            return archetype
            except Exception:
                continue
        
        self._archetype_cache[card_name] = None
        return None


class CardAnalyzer:
    """Optimized card analysis with shared data structures."""
    
    def __init__(self, loader: TournamentDataLoader):
        self.loader = loader
        self._all_cards_cache: Optional[Set[str]] = None
    
    def _parse_card_uid(self, uid: str) -> Tuple[Optional[str], Optional[str]]:
        """Parse set code and number from uid format 'Name::SET::NNN'."""
        parts = uid.split('::') if uid else []
        if len(parts) >= 3 and parts[1] and parts[2]:
            return parts[1], parts[2]
        return None, None
    
    def _get_display_name(self, key: str, tournament_data: List[TournamentData]) -> str:
        """Get display name for a card key from tournament data."""
        for data in tournament_data:
            if key in data.name_map:
                return data.name_map[key]
        return key
    
    def _get_all_card_keys(self, tournament_data: List[TournamentData]) -> Set[str]:
        """Get all unique card keys across tournaments."""
        if self._all_cards_cache is None:
            keys = set()
            for data in tournament_data:
                keys.update(data.pct_map.keys())
            self._all_cards_cache = keys
        return self._all_cards_cache
    
    def _create_card_data(self, key: str, name: str, tournaments: List[str]) -> CardData:
        """Create CardData object with parsed components."""
        set_code, number = self._parse_card_uid(key)
        archetype = self.loader.find_archetype_for_card(name, tournaments)
        return CardData(key, name, set_code, number, archetype)
    
    def _recency_weight(self, days_diff: float) -> float:
        """Calculate recency weight using exponential decay."""
        return 0.5 ** (days_diff / RECENT_WEIGHT_HALF_LIFE_DAYS)


    def compute_chopped_and_washed(self, tournament_data: List[TournamentData], 
                                   tournaments: List[str], exclude_names: Set[str] = None, 
                                   max_limit: int = MAX_CANDIDATES, 
                                   cap_per_arch: int = MAX_PER_ARCHETYPE) -> List[dict]:
        """Enhanced computation of cards that were genuine staples but crashed hard."""
        if not tournament_data:
            return []
        
        exclude_names = exclude_names or set()
        card_keys = self._get_all_card_keys(tournament_data)
        candidates = []
        now = datetime.now(timezone.utc)
        
        for key in card_keys:
            name = self._get_display_name(key, tournament_data)
            
            if key in exclude_names or name in BASIC_ENERGY:
                continue
            
            # Quality Filter 1: Must be low in recent tournaments
            latest_pct = tournament_data[0].pct_map.get(key, 0.0)
            second_latest_pct = tournament_data[1].pct_map.get(key, 0.0) if len(tournament_data) > 1 else 0.0
            
            if latest_pct > MAX_CHOPPED_RECENT_PCT or second_latest_pct > MAX_CHOPPED_RECENT_PCT:
                continue
            
            # Find the best sustained peak period
            best_crash_score = 0.0
            best_peak_info = None
            
            # Look for sustained peaks in tournament history
            for peak_start_idx in range(1, min(len(tournament_data), 1 + PEAK_LOOKBACK)):
                peak_pct = tournament_data[peak_start_idx].pct_map.get(key, 0.0)
                
                # Quality Filter 2: Peak must be genuinely significant
                if peak_pct < MIN_CHOPPED_PEAK_PCT:
                    continue
                
                # Check if this peak was sustained across multiple tournaments
                sustained_tournaments = 1
                sustained_sum = peak_pct
                
                for sustain_idx in range(peak_start_idx + 1, 
                                       min(len(tournament_data), peak_start_idx + MIN_SUSTAINED_PEAK_TOURNAMENTS + 2)):
                    sustain_pct = tournament_data[sustain_idx].pct_map.get(key, 0.0)
                    if sustain_pct >= MIN_CHOPPED_PEAK_PCT * 0.7:  # Within 30% of peak threshold
                        sustained_tournaments += 1
                        sustained_sum += sustain_pct
                    else:
                        break
                
                # Quality Filter 3: Must have been sustained success, not just a spike
                if sustained_tournaments < MIN_SUSTAINED_PEAK_TOURNAMENTS:
                    continue
                
                sustained_avg = sustained_sum / sustained_tournaments
                
                # Quality Filter 4: Significant drop requirements
                abs_drop = sustained_avg - latest_pct
                if abs_drop < MIN_CHOPPED_DROP_ABS:
                    continue
                
                rel_drop = abs_drop / sustained_avg
                if rel_drop < MIN_CHOPPED_DROP_REL:
                    continue
                
                # Calculate crash quality score
                # Factors: magnitude of drop, steepness, sustained peak quality, recency
                peak_date = tournament_data[peak_start_idx].date
                if peak_date and peak_date.tzinfo is None:
                    peak_date = peak_date.replace(tzinfo=timezone.utc)
                
                days_since_peak = (now - peak_date).days if peak_date else (peak_start_idx * 7)
                peak_recency = self._recency_weight(days_since_peak)
                
                # Steepness: how quickly did it fall?
                tournaments_to_fall = peak_start_idx  # How many tournaments from peak to now
                steepness_factor = abs_drop / max(tournaments_to_fall, 1)
                
                # Quality score combines multiple factors
                crash_score = (
                    abs_drop * 2.0 +  # Magnitude of drop
                    (rel_drop * sustained_avg) +  # Relative drop weighted by peak importance
                    (steepness_factor * 3.0) +  # How steep the crash was
                    (sustained_tournaments * 2.0) +  # Reward sustained peaks
                    (peak_recency * 5.0)  # Recent crashes more relevant
                )
                
                # Bonus for complete crash (went to 0%)
                if latest_pct <= 0.0:
                    crash_score *= 1.5
                
                if crash_score > best_crash_score:
                    best_crash_score = crash_score
                    best_peak_info = {
                        'peak_pct': sustained_avg,
                        'peak_tournaments': sustained_tournaments,
                        'abs_drop': abs_drop,
                        'rel_drop': rel_drop,
                        'steepness': steepness_factor
                    }
            
            if best_crash_score <= 0.0 or best_peak_info is None:
                continue
            
            card_data = self._create_card_data(key, name, tournaments)
            candidates.append({
                'key': key,
                'name': name,
                'crash_score': best_crash_score,
                'latest': latest_pct,
                'archetype': card_data.archetype or 'UNSPECIFIED',
                'set': card_data.set_code,
                'number': card_data.number,
                **best_peak_info
            })
        
        # Sort by crash score (best crashes first)
        candidates.sort(key=lambda x: (-x['crash_score'], -x['abs_drop'], x['name']))
        
        # Apply per-archetype caps
        counts = defaultdict(int)
        result = []
        
        for candidate in candidates:
            arch = candidate['archetype']
            if counts[arch] < cap_per_arch and len(result) < max_limit:
                result.append({
                    'name': candidate['name'],
                    'uid': candidate['key'],
                    'set': candidate['set'],
                    'number': candidate['number'],
                    'archetype': arch,
                    'peak_usage': round(candidate['peak_pct'], 1),
                    'current_usage': round(candidate['latest'], 1),
                    'drop_amount': round(candidate['abs_drop'], 1),
                    'crash_severity': round(candidate['rel_drop'], 2),
                    'sustained_peak': candidate['peak_tournaments']
                })
                counts[arch] += 1
        
        return result


    def compute_consistent_leaders(self, tournament_data: List[TournamentData], 
                                  tournaments: List[str], max_limit: int = MAX_CANDIDATES) -> List[dict]:
        """Enhanced computation of truly reliable staple cards."""
        if not tournament_data:
            return []
        
        card_keys = self._get_all_card_keys(tournament_data)
        stats = []
        total_tournaments = len(tournament_data)
        
        for key in card_keys:
            name = self._get_display_name(key, tournament_data)
            
            if name in BASIC_ENERGY:
                continue
            
            # Get usage data across tournaments
            values = [data.pct_map.get(key, 0.0) for data in tournament_data]
            present_count = sum(1 for v in values if v > 0.0)
            
            # Quality Filter 1: Must appear in significant portion of tournaments
            appearance_rate = present_count / total_tournaments
            if appearance_rate < MIN_LEADER_APPEARANCE_PCT:
                continue
            
            # Calculate weighted average with slight recency bias
            weighted_sum = 0.0
            weight_sum = 0.0
            
            for i, value in enumerate(values):
                # More recent tournaments get slightly higher weight
                weight = 1.0 + (LEADER_RECENCY_WEIGHT * (total_tournaments - i) / total_tournaments)
                weighted_sum += value * weight
                weight_sum += weight
            
            weighted_avg = weighted_sum / weight_sum
            
            # Quality Filter 2: Must have meaningful average usage
            if weighted_avg < MIN_LEADER_AVG_PCT:
                continue
            
            # Calculate consistency (lower variance = more consistent)
            mean_usage = sum(values) / len(values)
            variance = sum((v - mean_usage) ** 2 for v in values) / len(values)
            consistency_score = 1.0 / (1.0 + variance)  # Higher score = more consistent
            
            # Overall quality score combines average, consistency, and appearance rate
            quality_score = weighted_avg * consistency_score * appearance_rate
            
            stats.append({
                'name': name,
                'uid': key,
                'avg': weighted_avg,
                'consistency': consistency_score,
                'appearance_rate': appearance_rate,
                'quality_score': quality_score,
                'present': present_count
            })
        
        # Sort by quality score (combines all factors)
        stats.sort(key=lambda x: (-x['quality_score'], -x['avg'], x['name']))
        
        result = []
        for item in stats[:max_limit]:
            set_code, number = self._parse_card_uid(item['uid'])
            result.append({
                'name': item['name'],
                'uid': item['uid'],
                'set': set_code,
                'number': number,
                'avg_usage': round(item['avg'], 1),
                'consistency': round(item['consistency'], 2),
                'appearance_rate': round(item['appearance_rate'], 2)
            })
        
        return result
    
    def compute_on_the_rise(self, tournament_data: List[TournamentData], tournaments: List[str],
                           exclude_names: Set[str] = None, max_limit: int = MAX_CANDIDATES,
                           cap_per_arch: int = MAX_PER_ARCHETYPE) -> List[dict]:
        """Enhanced computation of cards with genuine rising momentum."""
        if not tournament_data or len(tournament_data) < MIN_RISE_TOURNAMENTS:
            return []
        
        exclude_names = exclude_names or set()
        card_keys = self._get_all_card_keys(tournament_data)
        candidates = []
        
        for key in card_keys:
            name = self._get_display_name(key, tournament_data)
            
            if key in exclude_names or name in BASIC_ENERGY:
                continue
            
            # Get usage progression (newest to oldest)
            values = [data.pct_map.get(key, 0.0) for data in tournament_data]
            
            # Quality Filter 1: Must have meaningful current usage
            latest = values[0]
            if latest < MIN_RISE_CURRENT_PCT:
                continue
            
            # Skip newly legal cards (all zeros in history)
            older_values = values[1:]
            if older_values and all(v <= 0.0 for v in older_values):
                continue
            
            # Calculate baseline (weighted average of older tournaments)
            if len(older_values) < 2:  # Need sufficient history
                continue
            
            # Recent past (tournaments 1-3) vs distant past (4+) for momentum
            recent_past = older_values[:2] if len(older_values) >= 2 else older_values
            distant_past = older_values[2:] if len(older_values) > 2 else []
            
            recent_avg = sum(recent_past) / len(recent_past)
            distant_avg = sum(distant_past) / len(distant_past) if distant_past else recent_avg
            
            # Quality Filter 2: Significant absolute increase
            delta_abs = latest - recent_avg
            if delta_abs < MIN_RISE_DELTA_ABS:
                continue
            
            # Quality Filter 3: Significant relative increase
            if recent_avg > 0:
                delta_rel = latest / recent_avg
                if delta_rel < MIN_RISE_DELTA_REL:
                    continue
            else:
                # If coming from 0%, must be substantial emergence
                if latest < MIN_RISE_CURRENT_PCT * 1.5:
                    continue
                delta_rel = float('inf')  # Represent infinite growth
            
            # Calculate momentum score
            # Factors: absolute growth, relative growth, acceleration
            momentum_score = delta_abs * min(delta_rel, 5.0)  # Cap rel growth at 5x
            
            # Bonus for acceleration (recent trend > distant trend)
            if distant_past and recent_avg > distant_avg:
                acceleration_bonus = (recent_avg - distant_avg) / max(distant_avg, 1.0)
                momentum_score *= (1.0 + min(acceleration_bonus, 1.0))
            
            # Bonus for consistency in rise (not just one-tournament spike)
            if len(recent_past) >= 2:
                recent_trend = recent_past[0] - recent_past[1]  # Is it still rising?
                if recent_trend > 0:
                    momentum_score *= 1.2
            
            card_data = self._create_card_data(key, name, tournaments)
            candidates.append({
                'name': name,
                'uid': key,
                'set': card_data.set_code,
                'number': card_data.number,
                'momentum_score': momentum_score,
                'latest': latest,
                'recent_avg': recent_avg,
                'delta_abs': delta_abs,
                'delta_rel': min(delta_rel, 10.0) if delta_rel != float('inf') else 10.0,
                'archetype': card_data.archetype or 'UNSPECIFIED'
            })
        
        # Sort by momentum score
        candidates.sort(key=lambda x: (-x['momentum_score'], -x['latest'], x['name']))
        
        # Apply per-archetype caps
        result = []
        counts = defaultdict(int)
        
        for candidate in candidates:
            arch = candidate['archetype']
            if counts[arch] < cap_per_arch and len(result) < max_limit:
                result.append({
                    'name': candidate['name'],
                    'uid': candidate['uid'],
                    'set': candidate['set'],
                    'number': candidate['number'],
                    'archetype': arch,
                    'current_usage': round(candidate['latest'], 1),
                    'momentum_score': round(candidate['momentum_score'], 2),
                    'growth_factor': round(candidate['delta_rel'], 1)
                })
                counts[arch] += 1
        
        return result
    
    def compute_that_day2d(self, all_tournaments: List[str], exclude_names: Set[str] = None, 
                          max_limit: int = MAX_CANDIDATES,
                          cap_per_arch: int = MAX_PER_ARCHETYPE) -> List[dict]:
        """Enhanced computation of experimental one-offs that disappeared."""
        # For "That Day 2'd?", we need to look at ALL tournaments, not just current rotation
        # Load extended historical data directly from all tournaments
        extended_data = self.loader.load_all_tournament_data(all_tournaments[:DAY2D_LOOKBACK_TOURNAMENTS])
        
        if not extended_data:
            return []
        
        exclude_names = exclude_names or set()
        card_keys = self._get_all_card_keys(extended_data)
        candidates = []
        
        for key in card_keys:
            name = self._get_display_name(key, extended_data)
            
            if key in exclude_names or name in BASIC_ENERGY:
                continue
            
            # Get all usage data across extended tournament history
            all_usage = [data.pct_map.get(key, 0.0) for data in extended_data]
            
            # Quality Filter 1: Must be essentially gone now (recent tournaments)
            recent_usage = all_usage[:3]  # Last 3 tournaments
            if any(usage > MAX_DAY2D_RECENT_PCT for usage in recent_usage):
                continue
            
            # Quality Filter 2: Must never have been a legitimate archetype
            max_usage = max(all_usage)
            if max_usage > MAX_DAY2D_PEAK_USAGE:
                continue  # Exclude cards that ever had significant play
            
            # Quality Filter 3: Count meaningful appearances (not just 0.1% noise)
            meaningful_appearances = [usage for usage in all_usage if usage >= MIN_DAY2D_MIN_APPEARANCE]
            total_appearances = len([usage for usage in all_usage if usage > 0])
            meaningful_tournaments = len(meaningful_appearances)
            
            if total_appearances > MAX_DAY2D_TOTAL_APPEARANCES:
                continue
            
            if meaningful_tournaments > MAX_DAY2D_MEANINGFUL_TOURNAMENTS:
                continue  # Too many meaningful showings = legitimate archetype
            
            if len(meaningful_appearances) == 0:
                continue
            
            # Quality Filter 4: Total usage across ALL appearances should be very low
            total_usage_sum = sum(all_usage)
            if total_usage_sum > MAX_DAY2D_TOTAL_USAGE_SUM:
                continue
            
            # Find the peak appearance
            max_idx = all_usage.index(max_usage)
            
            if max_usage < MIN_DAY2D_MIN_APPEARANCE:
                continue
            
            # Quality Filter 5: Must be truly experimental, not consistent archetype
            # Check if card appeared in too many tournaments (even at low percentages)
            non_zero_count = sum(1 for usage in all_usage if usage > 0)
            if non_zero_count > 4:  # Appeared in more than 4 tournaments = consistent contender
                continue
            
            # Quality Filter 4: Analyze the "experimental" nature
            # Check if appearances were truly isolated (not consecutive tournaments)
            appearance_indices = [i for i, usage in enumerate(all_usage) if usage >= MIN_DAY2D_MIN_APPEARANCE]
            
            # Count consecutive appearance streaks (bad for "one-off" nature)
            consecutive_streaks = 0
            if len(appearance_indices) > 1:
                for i in range(len(appearance_indices) - 1):
                    if appearance_indices[i+1] - appearance_indices[i] == 1:
                        consecutive_streaks += 1
            
            # Penalty for consecutive appearances (less "experimental one-off" like)
            isolation_bonus = 1.0 - (consecutive_streaks * 0.3)
            
            # Quality Filter 5: Should have gaps between appearances
            if len(appearance_indices) > 1:
                # Calculate average gap between appearances
                gaps = [appearance_indices[i+1] - appearance_indices[i] for i in range(len(appearance_indices) - 1)]
                avg_gap = sum(gaps) / len(gaps) if gaps else 0
                
                # Prefer cards with larger gaps between appearances
                if avg_gap < 2:  # Too consistent, not experimental enough
                    continue
            
            # Calculate "experimental one-off" score
            # Factors: rarity of appearance, isolation, recency of disappearance
            
            # Rarity score: lower total usage = higher score
            rarity_score = (MAX_DAY2D_TOTAL_USAGE_SUM - total_usage_sum) / MAX_DAY2D_TOTAL_USAGE_SUM
            
            # Disappearance score: how completely did it vanish?
            recent_total = sum(recent_usage)
            disappearance_score = 1.0 - (recent_total / max(total_usage_sum, 0.1))
            
            # Experimental score: few appearances, well spaced, then gone
            experimental_score = (
                rarity_score * 20.0 +           # Reward rarity
                disappearance_score * 15.0 +    # Reward complete disappearance  
                isolation_bonus * 10.0 +        # Reward isolated appearances
                max_usage * 5.0 +               # Some weight for peak usage
                (len(extended_data) - max_idx) * 2.0  # Slight bonus for older peaks
            )
            
            # Bonus if peak was in an established archetype (more interesting as failed experiment)
            card_data = self._create_card_data(key, name, all_tournaments)
            archetype = card_data.archetype
            
            # Check if this appeared in a well-known archetype
            established_archetypes = {
                'Charizard Pidgeot', 'Dragapult Dusknoir', 'Terapagos Noctowl', 
                'Gholdengo', 'Gardevoir', 'Roaring Moon'
            }
            
            if archetype and any(est_arch in archetype for est_arch in established_archetypes):
                experimental_score *= 1.3  # Bonus for failed experiments in established decks
            
            candidates.append({
                'name': name,
                'uid': key,
                'set': card_data.set_code,
                'number': card_data.number,
                'archetype': archetype or 'UNSPECIFIED',
                'experimental_score': experimental_score,
                'peak_usage': max_usage,
                'total_appearances': total_appearances,
                'total_usage_sum': total_usage_sum,
                'tournaments_since_peak': max_idx,
                'rarity_score': rarity_score,
                'disappearance_score': disappearance_score
            })
        
        # Sort by experimental score
        candidates.sort(key=lambda x: (-x['experimental_score'], -x['peak_usage'], x['name']))
        
        # Apply per-archetype caps
        result = []
        counts = defaultdict(int)
        
        for candidate in candidates:
            arch = candidate['archetype']
            if counts[arch] < cap_per_arch and len(result) < max_limit:
                result.append({
                    'name': candidate['name'],
                    'uid': candidate['uid'],
                    'set': candidate['set'],
                    'number': candidate['number'],
                    'archetype': arch,
                    'peak_usage': round(candidate['peak_usage'], 1),
                    'total_appearances': candidate['total_appearances'],
                    'total_usage': round(candidate['total_usage_sum'], 1),
                    'tournaments_since_peak': candidate['tournaments_since_peak'],
                    'experimental_score': round(candidate['experimental_score'], 2)
                })
                counts[arch] += 1
        
        return result


class RotationFilter:
    """Utility class for filtering tournaments by rotation."""
    
    @staticmethod
    def _normalize_rotation_prefix(format_name: str) -> Optional[str]:
        """Normalize a formatName to a rotation family prefix."""
        if not format_name:
            return None
        
        normalized = str(format_name)
        # Normalize separators and ampersand/and
        normalized = normalized.replace('—', '-').replace('–', '-').replace(' and ', ' & ')
        prefix = normalized.split('-', 1)[0].strip()
        return prefix or None
    
    @staticmethod
    def filter_by_current_rotation(tournament_data: List[TournamentData]) -> List[TournamentData]:
        """Filter tournaments to current rotation if >=3 events available."""
        if not tournament_data:
            return tournament_data
        
        # Find current rotation prefix
        current_prefix = None
        for data in tournament_data:
            current_prefix = RotationFilter._normalize_rotation_prefix(data.format_name)
            if current_prefix:
                break
        
        if not current_prefix:
            return tournament_data
        
        # Count events in current rotation
        current_rotation_events = [
            data for data in tournament_data 
            if RotationFilter._normalize_rotation_prefix(data.format_name) == current_prefix
        ]
        
        # Return filtered list if we have enough events, otherwise return all
        return current_rotation_events if len(current_rotation_events) >= 3 else tournament_data


def generate_suggestions():
    """Main function to generate card suggestions with optimized algorithms."""
    # Initialize components
    loader = TournamentDataLoader()
    analyzer = CardAnalyzer(loader)
    
    # Load tournament data
    tournaments = loader.load_tournament_order()
    if not tournaments:
        print("No tournaments found")
        return
    
    tournament_data = loader.load_all_tournament_data(tournaments)
    
    # Apply rotation filtering
    tournament_data = RotationFilter.filter_by_current_rotation(tournament_data)
    filtered_tournaments = [data.name for data in tournament_data]
    
    print(f"Processing {len(tournament_data)} tournaments...")
    
    # Compute categories with optimized algorithms
    leaders = analyzer.compute_consistent_leaders(tournament_data, filtered_tournaments, MAX_CANDIDATES)
    leader_keys = {c.get('uid') or c['name'] for c in leaders}
    
    # Compute "On The Rise" with exclusions and fallback caps
    on_the_rise = analyzer.compute_on_the_rise(
        tournament_data, filtered_tournaments, leader_keys, MAX_CANDIDATES, MAX_PER_ARCHETYPE
    )
    
    if len(on_the_rise) < MIN_CANDIDATES:
        for cap in (3, 4):
            on_the_rise = analyzer.compute_on_the_rise(
                tournament_data, filtered_tournaments, leader_keys, MAX_CANDIDATES, cap
            )
            if len(on_the_rise) >= MIN_CANDIDATES:
                break
    
    rise_keys = {c.get('uid') or c['name'] for c in on_the_rise}
    
    # Compute "Chopped and Washed" with exclusions
    chopped = analyzer.compute_chopped_and_washed(
        tournament_data, filtered_tournaments, leader_keys | rise_keys, MAX_CANDIDATES, MAX_PER_ARCHETYPE
    )
    
    if len(chopped) < MIN_CANDIDATES:
        for cap in (3, 4):
            chopped = analyzer.compute_chopped_and_washed(
                tournament_data, filtered_tournaments, leader_keys | rise_keys, MAX_CANDIDATES, cap
            )
            if len(chopped) >= MIN_CANDIDATES:
                break
    
    chopped_keys = {c.get('uid') or c['name'] for c in chopped}
    
    # Compute "That Day 2'd?" with exclusions - use ALL tournaments for historical context
    that_day2d = analyzer.compute_that_day2d(
        tournaments, leader_keys | rise_keys | chopped_keys, 
        MAX_CANDIDATES, MAX_PER_ARCHETYPE
    )
    
    if len(that_day2d) < MIN_CANDIDATES:
        for cap in (3, 4):
            that_day2d = analyzer.compute_that_day2d(
                tournaments, leader_keys | rise_keys | chopped_keys,
                MAX_CANDIDATES, cap
            )
            if len(that_day2d) >= MIN_CANDIDATES:
                break
    
    # Create output structure
    categories = [
        {'id': 'consistent-leaders', 'title': 'Consistent Leaders', 'items': leaders[:MAX_CANDIDATES]},
        {'id': 'on-the-rise', 'title': 'On The Rise', 'items': on_the_rise[:MAX_CANDIDATES]},
        {'id': 'chopped-and-washed', 'title': 'Chopped and Washed', 'items': chopped[:MAX_CANDIDATES]},
        {'id': 'that-day2d', 'title': "That Day 2'd?", 'items': that_day2d[:MAX_CANDIDATES]},
    ]
    
    output = {
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'source': 'generate_suggestions.py (optimized)',
        'categories': categories
    }
    
    # Write output
    OUT_FILE.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding='utf-8')
    
    # Print summary
    print(f"Generated suggestions:")
    for category in categories:
        print(f"  {category['title']}: {len(category['items'])} items")
    print(f"Output written to: {OUT_FILE}")


if __name__ == '__main__':
    generate_suggestions()

