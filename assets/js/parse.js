// Reads a text report and extracts entries { rank, name, found, total, pct, dist[] } and deckTotal
export function parseReport(data){
  if(data && typeof data === 'object' && Array.isArray(data.items)){
    return { deckTotal: data.deckTotal ?? null, items: data.items };
  }
  throw new Error('Expected JSON report object with an items array');
}
