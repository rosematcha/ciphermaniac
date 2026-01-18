import { AppError, ErrorTypes } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { R2_BASE_URL } from '../constants.js';
import type { TrendsData } from '../types.js';

export async function fetchTrendsData(archetypeName: string): Promise<TrendsData | null> {
  const encodedName = encodeURIComponent(archetypeName);
  const url = `${R2_BASE_URL}/reports/Online%20-%20Last%2014%20Days/archetypes/${encodedName}/trends.json`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      if (response.status === 404) {
        logger.warn('Trends data not found', { archetypeName });
        return null;
      }
      throw new AppError(ErrorTypes.API, `HTTP ${response.status}`, null, { status: response.status, url });
    }
    return (await response.json()) as TrendsData;
  } catch (error) {
    logger.error('Failed to fetch trends data', { archetypeName, error });
    return null;
  }
}
