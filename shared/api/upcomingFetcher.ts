import { detectParseBreakage, parseUpcoming } from './upcomingParser';
import type { UpcomingPayload } from '../upcomingTypes';

const UPCOMING_URL = 'https://limitlesstcg.com/tournaments/upcoming?game=PTCG';

export async function scrapeUpcoming(fetchImpl: typeof fetch = fetch): Promise<UpcomingPayload> {
  const response = await fetchImpl(UPCOMING_URL, {
    signal: AbortSignal.timeout(30_000),
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Ciphermaniac/1.0; +https://ciphermaniac.com)',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });
  if (!response.ok) {
    throw new Error(`Upstream ${response.status}`);
  }
  const result = parseUpcoming(await response.text());
  const parseWarning =
    detectParseBreakage(result) ?? (result.rowsSeen === 0 ? 'Upcoming page has no table rows.' : undefined);
  return {
    refreshedAt: new Date().toISOString(),
    source: UPCOMING_URL,
    events: result.events,
    ...(parseWarning ? { parseWarning } : {})
  };
}
