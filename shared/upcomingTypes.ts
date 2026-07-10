/**
 * Shared shapes for the Limitless upcoming-tournaments scraper payload.
 *
 * Consumed by the frontend data layer (src/lib/data.ts) and the Pages Function
 * that produces it (functions/api/limitless/upcoming.ts). Kept isomorphic so
 * both sides agree on the schema.
 */

export interface UpcomingEvent {
  date: string;
  country: string;
  name: string;
  format: string;
  type: 'regional' | 'international' | 'special' | 'worlds' | 'other';
  limitlessUrl?: string;
  externalUrl?: string;
}

export interface UpcomingPayload {
  refreshedAt: string;
  source: string;
  events: UpcomingEvent[];
  /**
   * Set when the scraper saw a non-empty upstream table but extracted zero
   * events — a signal the Limitless markup likely changed and the parser needs
   * updating. The UI surfaces it instead of silently rendering "no events".
   */
  parseWarning?: string;
}
