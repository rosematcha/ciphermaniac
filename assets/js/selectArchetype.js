// Selects the archetype to display for an event given candidate stats per archetype.
// Inputs:
// - candidates: Array of { base: string, pct?: number|null, found?: number|null, total?: number|null }
//   where:
//   - pct = percent of decks in the archetype that played the card (any copies)
//   - found = number of decks in the archetype that played the card
//   - total = total decks in the archetype for the event
// - top8Bases: Optional array of base strings that made Top 8
// Output: The chosen candidate object or null if none
export function pickArchetype(candidates, top8Bases, opts){
  if(!Array.isArray(candidates) || candidates.length === 0) {return null;}
  const valid = candidates.filter(c => c && typeof c.base === 'string');
  if(valid.length === 0) {return null;}
  const minTotal = Math.max(0, Number(opts?.minTotal) || 3); // minimum decks in archetype to consider by default
  // Score primarily by number of decks that played the card (found),
  // falling back to pct when found is unknown or ties; this favors larger samples.
  const score = (c) => {
    if(Number.isFinite(c?.found)) {return c.found;}
    // Approximate from pct*total when available; else 0
    if(Number.isFinite(c?.pct) && Number.isFinite(c?.total)){
      return Math.round((c.pct * c.total) / 100);
    }
    return 0;
  };
  const byFoundThenPctDesc = (a,b) => (score(b) - score(a)) || ((b.pct ?? -1) - (a.pct ?? -1)) || a.base.localeCompare(b.base);
  const poolFromTop8 = (()=>{
    if(Array.isArray(top8Bases) && top8Bases.length){
      const set = new Set(top8Bases);
      const sub = valid.filter(c => set.has(c.base));
      if(sub.length) {return sub;}
    }
    return valid;
  })();

  // Apply minTotal threshold; if all filtered out, fall back to original pool
  const filtered = poolFromTop8.filter(c => (Number.isFinite(c.total) ? c.total : 0) >= minTotal);
  const pool = filtered.length ? filtered : poolFromTop8;
  return pool.sort(byFoundThenPctDesc)[0];
}

export function baseToLabel(base){
  return String(base || '').replace(/_/g,' ');
}
