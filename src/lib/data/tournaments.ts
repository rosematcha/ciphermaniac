import type { UpcomingPayload } from '../../../shared/upcomingTypes';
import { dataClient, type DataClient } from './client';

interface UpcomingOptions {
  client?: DataClient;
  local?: boolean;
  fetchImpl?: typeof fetch;
}

export async function fetchUpcoming({
  client = dataClient,
  local = Boolean(import.meta.env?.DEV),
  fetchImpl = fetch
}: UpcomingOptions = {}): Promise<UpcomingPayload | null> {
  try {
    if (!local) {
      const payload = await client.fetchJsonOptional<UpcomingPayload>('/upcoming.json');
      if (payload) {
        return payload;
      }
    }
    const response = await fetchImpl('/api/limitless/upcoming', { mode: 'cors' });
    return response.ok ? ((await response.json()) as UpcomingPayload) : null;
  } catch {
    return null;
  }
}
